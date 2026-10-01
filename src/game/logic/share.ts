// Share payload: what a high-score link carries. Encoded as base64url JSON so
// the server can render Open Graph tags and an image without a database.
// Signing lives in src/server/shareToken.ts (server only).
import { getLang, localeOf, normalizeLang, translate, type Lang } from '../../i18n/index.ts';

export interface SharePayload {
  v: 1;
  n: string; // player name
  s: number; // score
  f: number; // trees felled
  t: number; // seconds survived
  c: number; // best combo chain
  r: number; // rare (ancient) trees felled
  d: number; // unix time (seconds) the run ended
  l: Lang; // language of the share card / Open Graph text
}

export const NAME_MAX = 20;

export function sanitizeName(name: unknown): string {
  if (typeof name !== 'string') return '';
  // Strip control chars and angle brackets, collapse whitespace.
  const clean = name.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(clean).slice(0, NAME_MAX).join('');
}

const int = (v: unknown, max: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(max, Math.floor(n));
};

/** Validates and normalises an untrusted object into a payload (or null). */
export function normalizePayload(o: unknown): SharePayload | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const s = int(r.s, 10_000_000);
  const f = int(r.f, 100_000);
  const t = int(r.t, 86_400 * 7);
  const c = int(r.c, 1000);
  const rare = int(r.r ?? 0, 100_000);
  const d = int(r.d ?? 0, 4_102_444_800);
  if (s === null || f === null || t === null || c === null || rare === null || d === null) return null;
  const l = normalizeLang(r.l) ?? 'vi';
  return { v: 1, n: sanitizeName(r.n) || translate(l, 'share.anonymous'), s, f, t, c, r: rare, d, l };
}

/**
 * Rough sanity check so obviously edited scores are rejected. Points can only
 * come from survival time (1/s) and felled trees (max ~240 * 5x combo each),
 * and a tree takes at least ~1.5 s to fell.
 */
export function isPlausible(p: SharePayload): boolean {
  if (p.f > p.t / 1.5 + 1) return false;
  if (p.s > p.t + p.f * 240 * 5 + 10) return false;
  if (p.c > p.f) return false;
  if (p.r > p.f) return false;
  return true;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodePayload(p: SharePayload): string {
  const compact = [p.v, p.n, p.s, p.f, p.t, p.c, p.r, p.d, p.l];
  return toBase64Url(new TextEncoder().encode(JSON.stringify(compact)));
}

export function decodePayload(s: string): SharePayload | null {
  if (!/^[A-Za-z0-9_-]{4,400}$/.test(s)) return null;
  try {
    const arr = JSON.parse(new TextDecoder().decode(fromBase64Url(s)));
    if (!Array.isArray(arr) || arr[0] !== 1) return null;
    // Index 8 (language) was added later; older links default to Vietnamese.
    const [, n, sc, f, t, c, r, d, l] = arr;
    return normalizePayload({ n, s: sc, f, t, c, r, d, l });
  } catch {
    return null;
  }
}

export function formatDuration(sec: number, lang: Lang = getLang()): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? translate(lang, 'time.min', { m, s: s.toString().padStart(2, '0') }) : translate(lang, 'time.sec', { s });
}

export function formatScore(n: number, lang: Lang = getLang()): string {
  return n.toLocaleString(localeOf(lang));
}

/** Open Graph title, in the language the link was shared in. */
export function shareTitle(p: SharePayload): string {
  return translate(p.l, 'share.title', { name: p.n, score: formatScore(p.s, p.l) });
}

export function shareDescription(p: SharePayload): string {
  return translate(p.l, 'share.desc', { felled: p.f, time: formatDuration(p.t, p.l) });
}
