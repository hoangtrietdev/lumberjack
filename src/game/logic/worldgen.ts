// Deterministic, endless forest layout. A chunk always produces the same
// content for the same (cx, cz, worldSeed), so the world can be streamed in
// and out around the player without storing anything except what was felled.
import { hash3, mulberry32, pickWeighted, valueNoise } from './rng.ts';

export const CHUNK_SIZE = 28; // metres
export const CELL_SIZE = 4; // jittered grid cell inside a chunk
export const SAFE_RADIUS = 7; // nothing spawns this close to the start point

export interface SpeciesLite {
  kind: 'tree' | 'bush';
  weights: { pine: number; broadleaf: number };
  variants: { length: number } | unknown[];
}

export interface PlacedTree {
  id: string;
  x: number;
  z: number;
  species: number;
  variant: number;
  rotation: number;
  scale: number;
}

export interface PlacedRock {
  x: number;
  z: number;
  model: number;
  rotation: number;
  size: number;
}

export interface ChunkContent {
  cx: number;
  cz: number;
  trees: PlacedTree[];
  bushes: PlacedTree[];
  rocks: PlacedRock[];
  /** Grass clump positions (x, z, rotation, scale) packed for instancing. */
  grass: Float32Array;
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export function worldToChunk(x: number, z: number): [number, number] {
  return [Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)];
}

/** 0 = pine forest, 1 = broadleaf forest (smoothly blended). */
export function biomeAt(x: number, z: number, seed: number): number {
  return valueNoise(x, z, 90, seed ^ 0x9e3779b9);
}

/** 0 = clearing, 1 = dense forest. */
export function densityAt(x: number, z: number, seed: number): number {
  const n = 0.65 * valueNoise(x, z, 45, seed + 17) + 0.35 * valueNoise(x, z, 14, seed + 91);
  return n;
}

export function generateChunk(cx: number, cz: number, worldSeed: number, species: SpeciesLite[]): ChunkContent {
  const rand = mulberry32(hash3(cx, cz, 7, worldSeed));
  const trees: PlacedTree[] = [];
  const bushes: PlacedTree[] = [];
  const rocks: PlacedRock[] = [];
  const grass: number[] = [];

  const treeIdx = species.map((s, i) => (s.kind === 'tree' ? i : -1)).filter((i) => i >= 0);
  const bushIdx = species.map((s, i) => (s.kind === 'bush' ? i : -1)).filter((i) => i >= 0);

  const cells = CHUNK_SIZE / CELL_SIZE;
  const ox = cx * CHUNK_SIZE;
  const oz = cz * CHUNK_SIZE;
  let n = 0;

  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const x = ox + (i + 0.15 + rand() * 0.7) * CELL_SIZE;
      const z = oz + (j + 0.15 + rand() * 0.7) * CELL_SIZE;
      const roll = rand();
      const pickU = rand();
      const varU = rand();
      const rot = rand() * Math.PI * 2;
      const scaleJitter = 0.9 + rand() * 0.2;

      if (Math.hypot(x, z) < SAFE_RADIUS) continue;

      const density = densityAt(x, z, worldSeed);
      const biome = biomeAt(x, z, worldSeed);
      const treeChance = 0.12 + 0.5 * Math.max(0, density - 0.25) / 0.75;

      if (roll < treeChance) {
        const weights = treeIdx.map((k) => species[k].weights.pine * (1 - biome) + species[k].weights.broadleaf * biome);
        const k = treeIdx[pickWeighted(weights, pickU)];
        const count = (species[k].variants as unknown[]).length;
        trees.push({ id: `${cx},${cz},${n++}`, x, z, species: k, variant: Math.floor(varU * count), rotation: rot, scale: scaleJitter });
      } else if (roll < treeChance + 0.13) {
        const k = bushIdx[Math.floor(pickU * bushIdx.length)];
        const count = (species[k].variants as unknown[]).length;
        bushes.push({ id: `${cx},${cz},b${n++}`, x, z, species: k, variant: Math.floor(varU * count), rotation: rot, scale: 0.85 + rand() * 0.4 });
      } else if (roll < treeChance + 0.155) {
        rocks.push({ x, z, model: Math.floor(pickU * 3), rotation: rot, size: 0.7 + varU * 1.3 });
      }
    }
  }

  // Grass clumps, denser in clearings where light reaches the ground.
  const grassCount = 70;
  for (let g = 0; g < grassCount; g++) {
    const x = ox + rand() * CHUNK_SIZE;
    const z = oz + rand() * CHUNK_SIZE;
    const keep = rand();
    const rot = rand() * Math.PI * 2;
    const s = 0.7 + rand() * 0.7;
    if (keep > 1.1 - densityAt(x, z, worldSeed) * 0.6) continue;
    grass.push(x, z, rot, s);
  }

  return { cx, cz, trees, bushes, rocks, grass: new Float32Array(grass) };
}
