// Bilingual support: dictionaries, language detection, localized share text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vi } from '../src/i18n/vi.ts';
import { en } from '../src/i18n/en.ts';
import { fromAcceptLanguage, pickLang, translate, translatePlain } from '../src/i18n/index.ts';
import { decodePayload, encodePayload, formatDuration, formatScore, shareDescription, shareTitle, type SharePayload } from '../src/game/logic/share.ts';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('English has exactly the Vietnamese keys and only known {placeholders}', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(vi).sort());
  for (const k of Object.keys(vi) as (keyof typeof vi)[]) {
    assert.ok(en[k].trim().length > 0, `empty en string: ${k}`);
    // A translation may drop a variable (e.g. "A ranger…" for n = 1) but never invent one.
    for (const ph of placeholders(en[k])) assert.ok(placeholders(vi[k]).includes(ph), `unknown {${ph}} in en: ${k}`);
  }
});

test('translate fills variables and strips markup in plain mode', () => {
  assert.equal(translate('en', 'menu.best', { score: '1,200' }), 'Your best: 1,200');
  assert.equal(translatePlain('vi', 'menu.challenge', { from: 'An', score: 50 }), 'An thách bạn vượt 50 điểm!');
  assert.equal(translatePlain('en', 'howto.desk2').includes('[['), false);
});

test('language detection', () => {
  assert.equal(fromAcceptLanguage('en-US,en;q=0.9,vi;q=0.8'), 'en');
  assert.equal(fromAcceptLanguage('fr-FR, vi;q=0.7, en;q=0.5'), 'vi');
  assert.equal(fromAcceptLanguage('fr-FR'), null);
  assert.equal(pickLang(undefined, 'EN'), 'en');
  assert.equal(pickLang('de', null), 'vi');
});

test('numbers and durations follow the language', () => {
  assert.equal(formatScore(12345, 'vi'), '12.345');
  assert.equal(formatScore(12345, 'en'), '12,345');
  assert.equal(formatDuration(125, 'en'), '2 min 05 s');
  assert.equal(formatDuration(45, 'vi'), '45 giây');
});

test('share links keep their language; old links default to Vietnamese', () => {
  const p: SharePayload = { v: 1, n: 'Ann', s: 2350, f: 18, t: 140, c: 4, r: 1, d: 1790000000, l: 'en' };
  const back = decodePayload(encodePayload(p))!;
  assert.equal(back.l, 'en');
  assert.equal(shareTitle(back), 'Ann scored 2,350 in Chop & Run!');
  assert.match(shareDescription(back), /^Felled 18 trees .* 2 min 20 s/);
  // A link created before the language field existed (8-element array).
  const legacy = Buffer.from(JSON.stringify([1, 'Bình', 100, 2, 30, 1, 0, 0])).toString('base64url');
  const old = decodePayload(legacy)!;
  assert.equal(old.l, 'vi');
  assert.equal(shareTitle(old), 'Bình đạt 100 điểm trong Chặt & Chạy!');
  // Anonymous players get a name in the card's language.
  assert.equal(decodePayload(encodePayload({ ...p, n: '' }))!.n, 'Anonymous Lumberjack');
});
