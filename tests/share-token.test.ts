// Server-side signing of share links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShareToken, verifyShareToken } from '../src/server/shareToken.ts';
import type { SharePayload } from '../src/game/logic/share.ts';

const p: SharePayload = { v: 1, n: 'Lâm Tặc', s: 980, f: 9, t: 70, c: 3, r: 0, d: 1790000000, l: 'en' };

test('signed token verifies and round-trips', () => {
  const token = createShareToken(p);
  assert.deepEqual(verifyShareToken(token), p);
});

test('tampered score or signature is rejected', () => {
  const token = createShareToken(p);
  const [data, sig] = token.split('.');
  const forged = createShareToken({ ...p, s: 99999 }).split('.')[0];
  assert.equal(verifyShareToken(`${forged}.${sig}`), null);
  assert.equal(verifyShareToken(`${data}.${sig.slice(0, -1)}A`), null);
  assert.equal(verifyShareToken('garbage'), null);
  assert.equal(verifyShareToken(undefined), null);
});
