#!/usr/bin/env node
/**
 * Generates the game's tree list from EZ-Tree presets.
 *
 *   npm run trees:generate
 *
 * For every species it grows a few seeded variants with the real EZ-Tree
 * generator, measures them (height, canopy, trunk radius, triangles) and
 * derives gameplay stats from the measured wood: how many chops it takes,
 * how many points it is worth and how far the noise of chopping carries.
 * Output: src/game/trees/catalog.json (committed; the game reads it at runtime
 * and regrows the exact same trees from preset + seed).
 */
import { register } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

register('./ez-tree-loader.mjs', pathToFileURL(fileURLToPath(import.meta.url)));

const THREE = await import('three');
const { Tree, TreePreset } = await import('../src/lib/ez-tree/index.js');

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, 'src/game/trees/catalog.json');

const VARIANTS_PER_TREE = 3;
const VARIANTS_PER_BUSH = 2;

// Species the game uses. `height` is the target height in metres of the first
// variant; the other variants keep the same scale so seed variety shows.
// `value` is a wood-price multiplier (hardwood > softwood).
// `weights` = spawn weight per biome.
const SPECIES = [
  { id: 'pine-s',  preset: 'Pine Small',   name: 'Thông non',        nameEn: 'Young Pine',   height: 6,  value: 0.8, weights: { pine: 6, broadleaf: 1 } },
  { id: 'pine-m',  preset: 'Pine Medium',  name: 'Thông',            nameEn: 'Pine',         height: 11, value: 0.8, weights: { pine: 5, broadleaf: 1 } },
  { id: 'pine-l',  preset: 'Pine Large',   name: 'Thông cổ thụ',     nameEn: 'Ancient Pine', height: 16, value: 0.9, weights: { pine: 2, broadleaf: 0.3 } },
  { id: 'aspen-s', preset: 'Aspen Small',  name: 'Dương non',        nameEn: 'Young Aspen',  height: 6,  value: 0.7, weights: { pine: 1, broadleaf: 4 } },
  { id: 'aspen-m', preset: 'Aspen Medium', name: 'Dương lá rung',    nameEn: 'Aspen',        height: 11, value: 0.7, weights: { pine: 1, broadleaf: 3 } },
  { id: 'aspen-l', preset: 'Aspen Large',  name: 'Dương cổ thụ',     nameEn: 'Ancient Aspen',height: 16, value: 0.8, weights: { pine: 0.3, broadleaf: 1.2 } },
  { id: 'ash-s',   preset: 'Ash Small',    name: 'Tần bì non',       nameEn: 'Young Ash',    height: 6.5,value: 1.0, weights: { pine: 0.5, broadleaf: 4 } },
  { id: 'ash-m',   preset: 'Ash Medium',   name: 'Tần bì',           nameEn: 'Ash',          height: 12, value: 1.0, weights: { pine: 0.3, broadleaf: 2.5 } },
  { id: 'ash-l',   preset: 'Ash Large',    name: 'Tần bì cổ thụ',    nameEn: 'Ancient Ash',  height: 15, value: 1.1, weights: { pine: 0.1, broadleaf: 1 } },
  { id: 'oak-s',   preset: 'Oak Small',    name: 'Sồi non',          nameEn: 'Young Oak',    height: 6.5,value: 1.4, weights: { pine: 0.3, broadleaf: 3 } },
  { id: 'oak-m',   preset: 'Oak Medium',   name: 'Sồi',              nameEn: 'Oak',          height: 11, value: 1.5, weights: { pine: 0.2, broadleaf: 1.6 } },
  { id: 'oak-l',   preset: 'Oak Large',    name: 'Sồi cổ thụ (gỗ quý)', nameEn: 'Ancient Oak', height: 15, value: 1.8, weights: { pine: 0.05, broadleaf: 0.5 } },
];

const BUSHES = [
  { id: 'bush-1', preset: 'Bush 1', name: 'Bụi rậm', nameEn: 'Thicket', height: 2.2, weights: { pine: 1, broadleaf: 1 } },
  { id: 'bush-2', preset: 'Bush 2', name: 'Bụi cây', nameEn: 'Shrub',   height: 2.0, weights: { pine: 1, broadleaf: 1 } },
  { id: 'bush-3', preset: 'Bush 3', name: 'Bụi thấp', nameEn: 'Low bush', height: 1.8, weights: { pine: 1, broadleaf: 1 } },
];

/** Deterministic seed list per species (variant 0 = the preset's own seed). */
function seedsFor(presetSeed, index, count) {
  const seeds = [presetSeed];
  let h = (presetSeed * 2654435761 + index * 40503) >>> 0;
  while (seeds.length < count) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    seeds.push(((h ^ (h >>> 16)) >>> 0) % 65536);
  }
  return seeds;
}

function grow(preset, seed) {
  const tree = new Tree();
  tree.options.copy(structuredClone(TreePreset[preset]));
  tree.options.seed = seed;
  tree.generate();
  const box = new THREE.Box3().setFromObject(tree);
  const size = new THREE.Vector3();
  box.getSize(size);
  const tri = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
  return {
    height: box.max.y,
    canopy: Math.max(size.x, size.z) / 2,
    trunkRadius: tree.options.branch.radius[0],
    tris: Math.round(tri(tree.branchesMesh.geometry) + tri(tree.leavesMesh.geometry)),
  };
}

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

function gameStats(heightM, trunkR, value) {
  const volume = Math.PI * trunkR * trunkR * heightM; // m³ of trunk
  const hp = Math.max(2, Math.min(12, Math.round(1.5 + heightM * 0.22 + trunkR * 9)));
  // Reward grows faster than effort, hardwood pays a premium.
  const points = Math.round((Math.pow(hp, 1.6) * 4 * value) / 5) * 5;
  const noise = Math.round(9 + hp * 1.6); // metres a chop is heard
  return { volume: r2(volume), hp, points, noise };
}

const catalog = { generatedBy: 'scripts/generate-tree-catalog.mjs', ezTreeVersion: '2.0.0', species: [] };

SPECIES.forEach((sp, i) => {
  const preset = TreePreset[sp.preset];
  if (!preset) throw new Error(`Unknown preset ${sp.preset}`);
  const seeds = seedsFor(preset.seed, i, VARIANTS_PER_TREE);
  const first = grow(sp.preset, seeds[0]);
  const scale = sp.height / first.height;
  const variants = seeds.map((seed, v) => {
    const m = v === 0 ? first : grow(sp.preset, seed);
    const h = m.height * scale;
    const trunk = Math.max(0.08, m.trunkRadius * scale);
    return {
      seed,
      height: r1(h),
      canopyRadius: r1(m.canopy * scale),
      trunkRadius: r3(trunk),
      tris: m.tris,
      ...gameStats(h, trunk, sp.value),
    };
  });
  catalog.species.push({
    id: sp.id, kind: 'tree', preset: sp.preset, name: sp.name, nameEn: sp.nameEn,
    leaf: preset.leaves.type, bark: preset.bark.type, evergreen: preset.type === 'evergreen',
    scale: r3(scale), value: sp.value, weights: sp.weights, variants,
  });
  console.log(`${sp.name.padEnd(22)} x${variants.length}  h=${variants.map((v) => v.height).join('/')}m  hp=${variants.map((v) => v.hp).join('/')}  pts=${variants.map((v) => v.points).join('/')}`);
});

BUSHES.forEach((b, i) => {
  const preset = TreePreset[b.preset];
  const seeds = seedsFor(preset.seed, 100 + i, VARIANTS_PER_BUSH);
  const first = grow(b.preset, seeds[0]);
  const scale = b.height / first.height;
  const variants = seeds.map((seed, v) => {
    const m = v === 0 ? first : grow(b.preset, seed);
    return { seed, height: r1(m.height * scale), canopyRadius: r1(m.canopy * scale), trunkRadius: 0, tris: m.tris, volume: 0, hp: 0, points: 0, noise: 0 };
  });
  catalog.species.push({
    id: b.id, kind: 'bush', preset: b.preset, name: b.name, nameEn: b.nameEn,
    leaf: preset.leaves.type, bark: preset.bark.type, evergreen: preset.type === 'evergreen',
    scale: r3(scale), value: 0, weights: b.weights, variants,
  });
  console.log(`${b.name.padEnd(22)} x${variants.length}  h=${variants.map((v) => v.height).join('/')}m  (hiding spot)`);
});

await writeFile(OUT, JSON.stringify(catalog, null, 2) + '\n');
console.log(`\nWrote ${catalog.species.length} species / ${catalog.species.reduce((n, s) => n + s.variants.length, 0)} variants -> ${path.relative(root, OUT)}`);
