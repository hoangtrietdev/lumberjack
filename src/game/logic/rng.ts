// Small deterministic random helpers shared by world generation and tests.
// Pure functions only: no three.js, no DOM.

/** 32-bit integer hash of up to three integers + salt. */
export function hash3(x: number, y: number, z: number, salt = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = (h + Math.imul(z | 0, 2147483647) + Math.imul(salt | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return h >>> 0;
}

/** Mulberry32 PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Smooth 2D value noise in [0, 1]. `scale` is the feature size in world units. */
export function valueNoise(x: number, z: number, scale: number, seed: number): number {
  const fx = x / scale;
  const fz = z / scale;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = smooth(fx - ix);
  const tz = smooth(fz - iz);
  const r = (a: number, b: number) => hash3(a, b, 0, seed) / 4294967296;
  const a = r(ix, iz);
  const b = r(ix + 1, iz);
  const c = r(ix, iz + 1);
  const d = r(ix + 1, iz + 1);
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

/** Picks an index from a weight list using u in [0,1). Returns -1 if all weights are 0. */
export function pickWeighted(weights: number[], u: number): number {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) return -1;
  let t = u * total;
  for (let i = 0; i < weights.length; i++) {
    t -= Math.max(0, weights[i]);
    if (t < 0) return i;
  }
  return weights.length - 1;
}
