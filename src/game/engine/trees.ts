import { yieldToBrowser } from './yield';
import { patchLeafInstancing } from './leafShader';
import * as THREE from 'three';
import { Tree, TreePreset } from '@/lib/ez-tree/index.js';
import type { TreeSpecies } from '../trees/catalog';
import type { Assets } from './assets';

/**
 * Grows every catalog variant once with EZ-Tree (at three levels of detail)
 * and keeps the geometry/materials as templates. The forest itself is drawn
 * with one InstancedMesh per (variant, LOD, part), so hundreds of trees cost
 * only a few dozen draw calls.
 */

export const LOD_DISTANCES = [0, 15, 32, 52];
const LOD_LEVELS = [
  { distance: LOD_DISTANCES[0], detail: {} },
  { distance: LOD_DISTANCES[1], detail: { sectionStride: 3, segmentFactor: 0.75, leafStride: 2, leafScale: 1.25 } },
  { distance: LOD_DISTANCES[2], detail: { sectionStride: 6, segmentFactor: 0.4, leafStride: 2, leafScale: 1.35, billboard: 'single' } },
  { distance: LOD_DISTANCES[3], detail: { sectionStride: 10, segmentFactor: 0.3, leafStride: 4, leafScale: 1.9, billboard: 'single' } },
];

/**
 * Foliage tints per species (multiplied with the EZ-Tree leaf texture):
 * aspen golden, ash lime, oak deep green, pine blue-green, bushes lush green,
 * and the precious ancient oak in autumn amber so it stands out.
 */
const LEAF_TINTS: Record<string, string> = {
  pine: '#bfe3c8',
  aspen: '#fff0a0',
  ash: '#e6ffb8',
  oak: '#b9dc95',
  'oak-l': '#ffc070',
  'bush-1': '#c8ff9a',
  'bush-2': '#b5f5a0',
  'bush-3': '#d8ff8a',
};

/** One wind clock shared by every leaf material (normal and see-through). */
export const WIND_TIME = { value: 0 };

/**
 * Wraps EZ-Tree's leaf shader hook:
 * - shares one wind clock between all leaf materials;
 * - fixes instancing: EZ-Tree replaces <project_vertex> with its own wind code
 *   that never applies `instanceMatrix`, so with InstancedMesh every leaf was
 *   drawn at the world origin, unscaled (bare trees everywhere, plus a giant
 *   cloud of leaves at the spawn point). Shadows used three's own depth shader,
 *   which is why the foliage shadows were still in the right place.
 */
function shareWindClock(m: THREE.MeshStandardMaterial) {
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    base.call(m, shader, renderer);
    if (shader.uniforms.uTime) shader.uniforms.uTime = WIND_TIME;
    shader.vertexShader = patchLeafInstancing(shader.vertexShader);
  };
}


export interface VariantTemplate {
  species: number;
  variant: number;
  levels: { branches: THREE.BufferGeometry; leaves: THREE.BufferGeometry }[];
  bark: THREE.MeshStandardMaterial;
  leaf: THREE.MeshStandardMaterial;
}

type TreeLike = THREE.Group & {
  options: { copy(o: unknown): void; seed: number; bark: { type: string; textureScale: { y: number }; maps: Record<string, THREE.Texture | null> }; leaves: { type: string; map: THREE.Texture | null } };
  generateLODs(levels: unknown[]): void;
  lod: THREE.LOD;
};

export class TreeLibrary {
  templates: VariantTemplate[][] = []; // [species][variant]
  private textureClones = new Map<string, THREE.Texture>();

  constructor(private catalog: TreeSpecies[], private assets: Assets) {}

  private barkTex(type: string, key: 'color' | 'normal' | 'roughness', scaleY: number): THREE.Texture | null {
    const maps = this.assets.bark[type] ?? this.assets.bark.Bark001;
    if (!maps) return null;
    // EZ-Tree writes texture.repeat.y from bark.textureScale, so each scale
    // needs its own Texture object (they still share the uploaded image).
    const id = `${type}:${key}:${scaleY}`;
    let t = this.textureClones.get(id);
    if (!t) {
      t = maps[key].clone();
      this.textureClones.set(id, t);
    }
    return t;
  }

  async build(onProgress: (p: number) => void, shouldYield = true): Promise<void> {
    const total = this.catalog.reduce((n, s) => n + s.variants.length, 0);
    let done = 0;
    for (let si = 0; si < this.catalog.length; si++) {
      const sp = this.catalog[si];
      const row: VariantTemplate[] = [];
      for (let vi = 0; vi < sp.variants.length; vi++) {
        row.push(this.grow(si, vi));
        done++;
        onProgress(done / total);
        if (shouldYield) await yieldToBrowser();
      }
      this.templates.push(row);
    }
  }

  /** Builds one standalone, full-detail EZ-Tree group (used by the catalog page). */
  growPreview(si: number, vi: number): THREE.Group {
    const tpl = this.templates[si]?.[vi] ?? this.grow(si, vi);
    const g = new THREE.Group();
    const b = new THREE.Mesh(tpl.levels[0].branches, tpl.bark);
    const l = new THREE.Mesh(tpl.levels[0].leaves, tpl.leaf);
    b.castShadow = l.castShadow = true;
    b.receiveShadow = l.receiveShadow = true;
    g.add(b, l);
    g.scale.setScalar(this.catalog[si].scale);
    return g;
  }

  private grow(si: number, vi: number): VariantTemplate {
    const sp = this.catalog[si];
    const tree = new Tree() as unknown as TreeLike;
    tree.options.copy(structuredClone((TreePreset as Record<string, unknown>)[sp.preset]));
    tree.options.seed = sp.variants[vi].seed;
    const scaleY = tree.options.bark.textureScale.y;
    tree.options.bark.maps = {
      color: this.barkTex(tree.options.bark.type, 'color', scaleY),
      normal: this.barkTex(tree.options.bark.type, 'normal', scaleY),
      roughness: this.barkTex(tree.options.bark.type, 'roughness', scaleY),
      ao: null,
    };
    tree.options.leaves.map = this.assets.leaves[tree.options.leaves.type] ?? null;
    tree.generateLODs(LOD_LEVELS);

    const levels = tree.lod.levels.map((lv) => {
      const [b, l] = lv.object.children as THREE.Mesh[];
      return { branches: b.geometry, leaves: l.geometry };
    });
    const first = tree.lod.levels[0].object.children as THREE.Mesh[];
    const bark = first[0].material as THREE.MeshStandardMaterial;
    const leaf = first[1].material as THREE.MeshStandardMaterial;
    shareWindClock(leaf);
    // Give each species its own foliage colour so they are easy to tell apart.
    const tint = LEAF_TINTS[sp.id] ?? LEAF_TINTS[sp.leaf];
    if (tint) leaf.color.multiply(new THREE.Color(tint));
    return { species: si, variant: vi, levels, bark, leaf };
  }

  /** Advances the leaf wind animation (one shared uniform). */
  setTime(t: number) {
    WIND_TIME.value = t;
  }
}

/** A standing tree (or bush) that the instancer draws. */
export interface TreeInstance {
  species: number;
  variant: number;
  matrix: THREE.Matrix4;
  /** Bounding sphere center/radius used for CPU frustum culling. */
  cx: number;
  cy: number;
  cz: number;
  radius: number;
  /** Crown radius and height in metres (for camera see-through). */
  canopy: number;
  height: number;
  /** Optional temporary matrix override (e.g. shaking while being chopped). */
  override?: THREE.Matrix4 | null;
}

interface Bucket {
  meshes: [THREE.InstancedMesh, THREE.InstancedMesh];
  count: number;
  tpl: VariantTemplate;
  li: number;
  ghost: boolean;
}

/**
 * Screen-door transparency so trees between the camera and the player don't
 * hide the action. Shadows still use the normal depth material.
 */
function makeGhost(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const g = m.clone();
  const base = m.onBeforeCompile;
  g.onBeforeCompile = (shader, renderer) => {
    // Keep the wind animation (leaf material) by chaining the original hook.
    if (base) base.call(m, shader, renderer);
    if (shader.uniforms.uTime) shader.uniforms.uTime = WIND_TIME;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        float ghostB2(vec2 a) { return 2.0 * a.x + 3.0 * a.y - 4.0 * a.x * a.y; }
        float ghostBayer(vec2 p) {
          vec2 q = floor(mod(p, 4.0));
          return (4.0 * ghostB2(mod(q, 2.0)) + ghostB2(floor(q * 0.5)) + 0.5) / 16.0;
        }`,
      )
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n if (ghostBayer(gl_FragCoord.xy) > 0.2) discard;');
  };
  g.customProgramCacheKey = () => `ghost-${m.name}`;
  return g;
}

export class TreeInstancer {
  readonly group = new THREE.Group();
  private buckets: Bucket[][][] = []; // [species][variant][lod]
  private ghosts: Bucket[][] = []; // [species][variant] (LOD 0, see-through)
  private ghostMats = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  castShadows = true;
  maxDistance = 90;
  /** Multiplies the LOD switch distances (lower = cheaper). */
  lodScale = 1;

  constructor(private lib: TreeLibrary) {
    this.group.name = 'TreeInstancer';
    lib.templates.forEach((row, si) => {
      this.buckets[si] = row.map((tpl) => tpl.levels.map((_, li) => this.makeBucket(tpl, li, 32, false)));
      this.ghosts[si] = row.map((tpl) => this.makeBucket(tpl, 0, 4, true));
    });
  }

  private ghostOf(m: THREE.MeshStandardMaterial) {
    let g = this.ghostMats.get(m);
    if (!g) {
      g = makeGhost(m);
      this.ghostMats.set(m, g);
    }
    return g;
  }

  private makeBucket(tpl: VariantTemplate, li: number, capacity: number, ghost: boolean): Bucket {
    const lv = tpl.levels[li];
    const b = new THREE.InstancedMesh(lv.branches, ghost ? this.ghostOf(tpl.bark) : tpl.bark, capacity);
    const l = new THREE.InstancedMesh(lv.leaves, ghost ? this.ghostOf(tpl.leaf) : tpl.leaf, capacity);
    for (const m of [b, l]) {
      m.count = 0;
      m.frustumCulled = false; // culled per instance on the CPU instead
      m.castShadow = this.castShadows;
      m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }
    return { meshes: [b, l], count: 0, tpl, li, ghost };
  }

  /** Doubles a bucket's capacity, keeping the matrices written so far. */
  private enlarge(old: Bucket): Bucket {
    const cap = old.meshes[0].instanceMatrix.count * 2;
    const next = this.makeBucket(old.tpl, old.li, cap, old.ghost);
    next.meshes.forEach((m, i) => (m.instanceMatrix.array as Float32Array).set(old.meshes[i].instanceMatrix.array.subarray(0, old.count * 16)));
    next.count = old.count;
    for (const m of old.meshes) {
      this.group.remove(m);
      m.dispose();
    }
    return next;
  }

  setShadows(on: boolean) {
    this.castShadows = on;
    this.group.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) o.castShadow = on;
    });
  }

  /**
   * Rebuilds the instance buffers for this frame.
   * @param focus the player position: nearby trees are kept for shadows and
   *   trees between the camera and this point become see-through.
   */
  update(camera: THREE.Camera, instances: Iterable<TreeInstance>, focus?: THREE.Vector3) {
    for (const row of this.buckets) for (const v of row) for (const b of v) b.count = 0;
    for (const row of this.ghosts) for (const b of row) b.count = 0;

    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const cam = camera.position;
    const maxD2 = this.maxDistance * this.maxDistance;
    const headY = focus ? focus.y + 1.6 : 0;

    for (const t of instances) {
      const dx = t.cx - cam.x;
      const dz = t.cz - cam.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > maxD2) continue;
      this.sphere.center.set(t.cx, t.cy, t.cz);
      this.sphere.radius = t.radius;
      let visible = this.frustum.intersectsSphere(this.sphere);
      // Keep nearby trees around the player so their shadows don't pop.
      if (!visible && focus) {
        const fx = t.cx - focus.x;
        const fz = t.cz - focus.z;
        visible = fx * fx + fz * fz < 18 * 18;
      }
      if (!visible) continue;

      // See-through when the crown (a vertical cylinder from ~30% of the height
      // to the top) contains the camera or cuts the camera -> player sight line.
      let ghost = false;
      if (focus) {
        const r = t.canopy + 0.6;
        const r2 = r * r;
        const base = t.height * 0.25;
        const top = t.height + 0.8;
        for (let k = 0; k <= 6 && !ghost; k++) {
          const u = k / 6;
          const px = cam.x + (focus.x - cam.x) * u - t.cx;
          const pz = cam.z + (focus.z - cam.z) * u - t.cz;
          const py = cam.y + (headY - cam.y) * u;
          ghost = px * px + pz * pz < r2 && py > base && py < top;
        }
      }

      const d = Math.sqrt(d2);
      let bucket: Bucket;
      if (ghost) {
        bucket = this.ghosts[t.species][t.variant];
        if (bucket.count >= bucket.meshes[0].instanceMatrix.count) bucket = this.ghosts[t.species][t.variant] = this.enlarge(bucket);
      } else {
        const ld = d / this.lodScale;
        const li = ld < LOD_DISTANCES[1] ? 0 : ld < LOD_DISTANCES[2] ? 1 : ld < LOD_DISTANCES[3] ? 2 : 3;
        bucket = this.buckets[t.species][t.variant][li];
        if (bucket.count >= bucket.meshes[0].instanceMatrix.count) bucket = this.buckets[t.species][t.variant][li] = this.enlarge(bucket);
      }
      const m = t.override ?? t.matrix;
      bucket.meshes[0].setMatrixAt(bucket.count, m);
      bucket.meshes[1].setMatrixAt(bucket.count, m);
      bucket.count++;
    }

    const flush = (b: Bucket) => {
      for (const m of b.meshes) {
        m.count = b.count;
        if (b.count) m.instanceMatrix.needsUpdate = true;
      }
    };
    for (const row of this.buckets) for (const v of row) v.forEach(flush);
    for (const row of this.ghosts) row.forEach(flush);
  }

  /** A standalone full-detail mesh of a variant (for falling trees). */
  makeStandalone(si: number, vi: number): THREE.Group {
    const tpl = this.lib.templates[si][vi];
    const g = new THREE.Group();
    const b = new THREE.Mesh(tpl.levels[0].branches, tpl.bark);
    const l = new THREE.Mesh(tpl.levels[0].leaves, tpl.leaf);
    b.castShadow = l.castShadow = this.castShadows;
    g.add(b, l);
    return g;
  }
}
