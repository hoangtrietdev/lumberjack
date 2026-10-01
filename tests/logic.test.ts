// Unit tests for the pure game logic. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { hash3, mulberry32, pickWeighted, valueNoise } from '../src/game/logic/rng.ts';
import { CHUNK_SIZE, SAFE_RADIUS, generateChunk, worldToChunk, type SpeciesLite } from '../src/game/logic/worldgen.ts';
import { COMBO_WINDOW, comboMultiplier, difficulty, fellTree, heatLevel, newScore, totalScore, addHeat, coolHeat } from '../src/game/logic/rules.ts';
import { decodePayload, encodePayload, isPlausible, normalizePayload, sanitizeName, type SharePayload } from '../src/game/logic/share.ts';

const catalog = JSON.parse(readFileSync(new URL('../src/game/trees/catalog.json', import.meta.url), 'utf8'));
const species: SpeciesLite[] = catalog.species;

test('rng is deterministic and in range', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 100; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
  assert.equal(hash3(1, 2, 3, 4), hash3(1, 2, 3, 4));
  assert.notEqual(hash3(1, 2, 3, 4), hash3(2, 1, 3, 4));
  for (let i = 0; i < 50; i++) {
    const n = valueNoise(i * 3.7, i * -1.3, 20, 9);
    assert.ok(n >= 0 && n <= 1);
  }
});

test('pickWeighted respects weights', () => {
  assert.equal(pickWeighted([0, 1, 0], 0.5), 1);
  assert.equal(pickWeighted([1, 1], 0.25), 0);
  assert.equal(pickWeighted([1, 1], 0.75), 1);
  assert.equal(pickWeighted([0, 0], 0.5), -1);
});

test('catalog: every species has variants and sane stats', () => {
  assert.ok(species.length >= 12);
  for (const s of catalog.species) {
    assert.ok(s.variants.length > 0, s.id);
    for (const v of s.variants) {
      assert.ok(v.seed >= 0, `${s.id} seed`);
      if (s.kind === 'tree') {
        assert.ok(v.hp >= 2 && v.points > 0 && v.noise > 0 && v.trunkRadius > 0, s.id);
      }
    }
  }
});

test('chunks are deterministic, inside bounds, and keep the spawn clear', () => {
  const a = generateChunk(0, 0, 1234, species);
  const b = generateChunk(0, 0, 1234, species);
  assert.deepEqual(a.trees, b.trees);
  for (const cx of [-1, 0]) {
    for (const cz of [-1, 0]) {
      const c = generateChunk(cx, cz, 1234, species);
      for (const t of [...c.trees, ...c.bushes]) {
        assert.ok(Math.hypot(t.x, t.z) >= SAFE_RADIUS, 'spawn area must be empty');
        assert.deepEqual(worldToChunk(t.x, t.z), [cx, cz]);
        assert.equal(species[t.species].kind, c.trees.includes(t) ? 'tree' : 'bush');
      }
    }
  }
  // A forest, not a desert: a 5x5 area should have plenty of trees.
  let count = 0;
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) count += generateChunk(i, j, 99, species).trees.length;
  assert.ok(count > 25 * 8, `too few trees: ${count}`);
  assert.ok(count < 25 * (CHUNK_SIZE / 4) ** 2, 'too many trees');
});

test('tree ids are unique across chunks', () => {
  const ids = new Set<string>();
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    for (const t of generateChunk(i, j, 5, species).trees) {
      assert.ok(!ids.has(t.id));
      ids.add(t.id);
    }
  }
});

test('combo chain multiplies points and breaks after the window', () => {
  let s = newScore();
  let r = fellTree(s, 100, 10);
  assert.equal(r.gained, 100);
  s = r.state;
  r = fellTree(s, 100, 10 + COMBO_WINDOW - 1);
  assert.equal(r.multiplier, 1.5);
  assert.equal(r.gained, 150);
  s = r.state;
  r = fellTree(s, 100, 100);
  assert.equal(r.multiplier, 1);
  assert.equal(r.state.bestChain, 2);
  assert.equal(r.state.felled, 3);
  assert.equal(comboMultiplier(50), 5);
  assert.equal(totalScore(r.state, 61.9), 350 + 61);
});

test('heat and difficulty ramp up', () => {
  let h = 0;
  h = addHeat(h, 45);
  assert.equal(heatLevel(h), 2);
  assert.equal(addHeat(90, 50), 100);
  assert.ok(coolHeat(50, 1, true) < coolHeat(50, 1, false));
  const early = difficulty(0, 0);
  const late = difficulty(300, 80);
  assert.equal(early.maxRangers, 1);
  assert.ok(late.maxRangers > early.maxRangers);
  assert.ok(late.runSpeed > early.runSpeed);
  assert.ok(late.spawnEvery < early.spawnEvery);
});

test('share payload round-trips (with Vietnamese name) and rejects junk', () => {
  const p: SharePayload = { v: 1, n: 'Tiều Phu Đẹp Trai', s: 1234, f: 12, t: 95, c: 3, r: 1, d: 1790000000, l: 'vi' };
  const enc = encodePayload(p);
  assert.match(enc, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodePayload(enc), p);
  assert.equal(decodePayload('!!!'), null);
  assert.equal(decodePayload('bm90LWpzb24'), null);
  assert.equal(sanitizeName('  <b>Hi</b>\n there  '), 'bHi/b there');
  assert.equal(sanitizeName('x'.repeat(50)).length, 20);
  assert.equal(normalizePayload({ n: 'a', s: -1, f: 0, t: 0, c: 0 }), null);
});

test('plausibility check catches edited scores', () => {
  const ok: SharePayload = { v: 1, n: 'A', s: 2000, f: 20, t: 120, c: 4, r: 1, d: 0, l: 'en' };
  assert.ok(isPlausible(ok));
  assert.ok(!isPlausible({ ...ok, s: 9_999_999 }));
  assert.ok(!isPlausible({ ...ok, f: 500 }));
  assert.ok(!isPlausible({ ...ok, c: 21 }));
});

test('a high score makes the manhunt harder even when quiet', async () => {
  const { difficulty: diff, bountyTier, scorePressure } = await import('../src/game/logic/rules.ts');
  const poor = diff(120, 0, 0);
  const rich = diff(120, 0, 2500);
  assert.ok(rich.maxRangers > poor.maxRangers);
  assert.ok(rich.runSpeed > poor.runSpeed && rich.sightRange > poor.sightRange);
  assert.ok(rich.pressure > poor.pressure && rich.pursuitMemory > poor.pursuitMemory);
  assert.ok(rich.spawnMin < poor.spawnMin, 'rangers spawn closer');
  assert.equal(poor.tipEvery, Infinity);
  assert.ok(Number.isFinite(rich.tipEvery) && rich.tipError < 16 && rich.tipRangers >= 2);
  assert.equal(bountyTier(499), 0);
  assert.equal(bountyTier(1500), 3);
  assert.equal(scorePressure(99999), 1);
  // Rangers stay catchable-but-escapable: never far faster than a sprint.
  assert.ok(diff(9999, 100, 99999).runSpeed <= 7.9);
});

test('leaf shader patch applies instanceMatrix to EZ-Tree leaves', async () => {
  const { patchLeafInstancing, EZ_TREE_PROJECT_LINE, EZ_TREE_WIND_LINE } = await import('../src/game/engine/leafShader.ts');
  // The lines we patch must still exist in the vendored EZ-Tree source.
  const src = readFileSync(new URL('../src/lib/ez-tree/tree.js', import.meta.url), 'utf8');
  assert.ok(src.includes(EZ_TREE_PROJECT_LINE) && src.includes(EZ_TREE_WIND_LINE));
  const vs = `void main(){ vec4 mvPosition = vec4(transformed, 1.0);\n${EZ_TREE_WIND_LINE}\n${EZ_TREE_PROJECT_LINE}\n}`;
  const out = patchLeafInstancing(vs);
  assert.ok(out.indexOf('instanceMatrix * mvPosition') < out.indexOf(EZ_TREE_PROJECT_LINE));
  assert.equal(patchLeafInstancing(out), out, 'idempotent');
});
