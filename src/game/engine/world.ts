import * as THREE from 'three';
import { chunkKey, generateChunk, worldToChunk, type PlacedTree } from '../logic/worldgen';
import type { TreeSpecies, TreeVariant } from '../trees/catalog';
import type { Assets } from './assets';
import { TreeInstancer, type TreeInstance, type TreeLibrary } from './trees';

export interface TreeRec extends TreeInstance {
  id: string;
  x: number;
  z: number;
  rotation: number;
  scale: number;
  spec: TreeSpecies;
  data: TreeVariant;
  kind: 'tree' | 'bush';
  hp: number;
  maxHp: number;
  felled: boolean;
  collR: number; // trunk collider radius (0 for bushes)
  hideR: number; // radius in which the player counts as hidden (bushes)
  shake: number; // remaining shake time
  shakeDir: THREE.Vector3;
}

interface Rock {
  x: number;
  z: number;
  r: number;
  mesh: THREE.Mesh;
}

interface Chunk {
  key: string;
  cx: number;
  cz: number;
  trees: TreeRec[];
  bushes: TreeRec[];
  rocks: Rock[];
  group: THREE.Group;
}

interface Falling {
  rec: TreeRec;
  pivot: THREE.Group;
  axis: THREE.Vector3;
  dir: THREE.Vector3;
  t: number;
  crashed: boolean;
  onCrash: (rec: TreeRec, dir: THREE.Vector3) => void;
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class World {
  readonly group = new THREE.Group();
  readonly instancer: TreeInstancer;
  private chunks = new Map<string, Chunk>();
  private felled = new Set<string>();
  private falling: Falling[] = [];
  private ground: THREE.Mesh;
  private groundTile = 6;
  private grassMaterial: THREE.MeshStandardMaterial | null = null;
  private grassUniforms = { uTime: { value: 0 } };
  private stumps: THREE.InstancedMesh;
  private stumpsDirty = true;
  viewRadius = 2.6; // in chunks
  grassEnabled = true;

  constructor(
    private catalog: TreeSpecies[],
    private lib: TreeLibrary,
    private assets: Assets,
    public seed: number,
  ) {
    this.instancer = new TreeInstancer(lib);
    this.group.add(this.instancer.group);

    // Ground: one big plane that follows the player in texture-tile steps.
    const g = new THREE.PlaneGeometry(260, 260, 1, 1);
    g.rotateX(-Math.PI / 2);
    const tex = assets.grassTexture;
    tex.repeat.set(260 / this.groundTile, 260 / this.groundTile);
    const groundMat = new THREE.MeshStandardMaterial({ map: tex, color: new THREE.Color('#d2dcae'), roughness: 1 });
    this.patchGround(groundMat);
    this.ground = new THREE.Mesh(g, groundMat);
    this.ground.receiveShadow = true;
    this.group.add(this.ground);

    // Stumps of felled trees.
    const sg = new THREE.CylinderGeometry(1, 1.15, 1, 10);
    sg.translate(0, 0.5, 0);
    const bark = lib.templates.find((r) => r.length)?.[0]?.bark;
    const stumpMat = new THREE.MeshStandardMaterial({ color: '#7a5a3a', map: bark?.map ?? null, roughness: 1 });
    const top = new THREE.MeshStandardMaterial({ color: '#d9b98a', roughness: 1 });
    this.stumps = new THREE.InstancedMesh(sg, [stumpMat, top, top], 1024);
    this.stumps.count = 0;
    this.stumps.castShadow = true;
    this.stumps.receiveShadow = true;
    this.stumps.frustumCulled = false;
    this.group.add(this.stumps);

    if (assets.grassClump) {
      const src = assets.grassClump.material as THREE.MeshStandardMaterial;
      const m = new THREE.MeshStandardMaterial({
        map: src.map,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
        roughness: 1,
        color: new THREE.Color(0.62, 0.68, 0.5),
        emissive: new THREE.Color(0x203010),
        emissiveIntensity: 0.15,
      });
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = this.grassUniforms.uTime;
        shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec2 wp = instanceMatrix[3].xz;
          #else
            vec2 wp = vec2(0.0);
          #endif
          float sway = sin(uTime * 1.7 + wp.x * 0.35 + wp.y * 0.21) * 0.5 + sin(uTime * 3.1 + wp.x) * 0.15;
          transformed.x += sway * position.y * 0.35;
          transformed.z += sway * position.y * 0.2;`,
        );
      };
      this.grassMaterial = m;
    }
  }

  /** Breaks up the grass tiling with large-scale dirt / colour patches. */
  private patchGround(m: THREE.MeshStandardMaterial) {
    const dirt = this.assets.dirtTexture;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uDirt = { value: dirt };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos2;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos2 = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vWorldPos2;
          uniform sampler2D uDirt;
          float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float n2(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
            return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          vec2 wp = vWorldPos2.xz;
          float patchN = n2(wp * 0.05) * 0.65 + n2(wp * 0.21) * 0.35;
          vec3 dirtC = texture2D(uDirt, wp / 5.0).rgb;
          float dirtAmt = smoothstep(0.62, 0.8, patchN);
          diffuseColor.rgb = mix(diffuseColor.rgb, dirtC * vec3(0.9, 0.85, 0.8), dirtAmt * 0.85);
          diffuseColor.rgb *= 0.85 + 0.3 * n2(wp * 0.11);`,
        );
    };
  }

  setGrassTime(t: number) {
    this.grassUniforms.uTime.value = t;
  }

  /** Streams chunks around a point. Loads at most `budget` chunks per call. */
  update(center: THREE.Vector3, budget = 2) {
    const [ccx, ccz] = worldToChunk(center.x, center.z);
    const r = Math.ceil(this.viewRadius);
    const wanted: [number, number, number][] = [];
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        const d = Math.hypot(i, j);
        if (d <= this.viewRadius) wanted.push([ccx + i, ccz + j, d]);
      }
    }
    wanted.sort((a, b) => a[2] - b[2]);
    let loaded = 0;
    for (const [cx, cz] of wanted) {
      const key = chunkKey(cx, cz);
      if (this.chunks.has(key)) continue;
      this.loadChunk(cx, cz);
      if (++loaded >= budget) break;
    }
    for (const [key, ch] of this.chunks) {
      if (Math.hypot(ch.cx - ccx, ch.cz - ccz) > this.viewRadius + 1.2) this.unloadChunk(key);
    }

    // Ground follows the player, snapped to the texture tile size.
    this.ground.position.set(
      Math.round(center.x / this.groundTile) * this.groundTile,
      0,
      Math.round(center.z / this.groundTile) * this.groundTile,
    );

    if (this.stumpsDirty) this.rebuildStumps();
  }

  /** True once every chunk in view has been generated (used by the loader). */
  isSettled(center: THREE.Vector3): boolean {
    const [ccx, ccz] = worldToChunk(center.x, center.z);
    const r = Math.ceil(this.viewRadius);
    for (let i = -r; i <= r; i++)
      for (let j = -r; j <= r; j++)
        if (Math.hypot(i, j) <= this.viewRadius && !this.chunks.has(chunkKey(ccx + i, ccz + j))) return false;
    return true;
  }

  private makeRec(p: PlacedTree): TreeRec {
    const spec = this.catalog[p.species];
    const data = spec.variants[p.variant];
    const s = spec.scale * p.scale;
    const m = new THREE.Matrix4();
    _q.setFromAxisAngle(UP, p.rotation);
    m.compose(_p.set(p.x, 0, p.z), _q, _s.set(s, s, s));
    const h = data.height * p.scale;
    return {
      id: p.id,
      x: p.x,
      z: p.z,
      rotation: p.rotation,
      scale: p.scale,
      spec,
      data,
      kind: spec.kind,
      hp: data.hp,
      maxHp: data.hp,
      felled: false,
      collR: spec.kind === 'tree' ? Math.max(0.18, data.trunkRadius * p.scale + 0.12) : 0,
      hideR: spec.kind === 'bush' ? Math.max(0.8, data.canopyRadius * p.scale * 0.8) : 0,
      shake: 0,
      shakeDir: new THREE.Vector3(1, 0, 0),
      species: p.species,
      variant: p.variant,
      matrix: m,
      cx: p.x,
      cy: h / 2,
      cz: p.z,
      radius: Math.max(h / 2, data.canopyRadius * p.scale) * 1.05,
      canopy: data.canopyRadius * p.scale,
      height: h,
      override: null,
    };
  }

  private loadChunk(cx: number, cz: number) {
    const content = generateChunk(cx, cz, this.seed, this.catalog);
    const group = new THREE.Group();
    const trees = content.trees.map((p) => {
      const r = this.makeRec(p);
      if (this.felled.has(r.id)) r.felled = true;
      return r;
    });
    const bushes = content.bushes.map((p) => this.makeRec(p));

    const rocks: Rock[] = [];
    for (const rk of content.rocks) {
      const tpl = this.assets.rocks[rk.model % Math.max(1, this.assets.rocks.length)];
      if (!tpl) continue;
      const mesh = new THREE.Mesh(tpl.geometry, tpl.material);
      mesh.position.set(rk.x, -0.05 * rk.size, rk.z);
      mesh.rotation.y = rk.rotation;
      mesh.scale.set(rk.size, rk.size * 0.8, rk.size);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      rocks.push({ x: rk.x, z: rk.z, r: rk.size * 0.42, mesh });
    }

    if (this.grassEnabled && this.assets.grassClump && this.grassMaterial && content.grass.length) {
      const n = content.grass.length / 4;
      const im = new THREE.InstancedMesh(this.assets.grassClump.geometry, this.grassMaterial, n);
      const m = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        const [x, z, rot, s] = content.grass.subarray(i * 4, i * 4 + 4);
        _q.setFromAxisAngle(UP, rot);
        m.compose(_p.set(x, 0, z), _q, _s.set(s, s * (0.8 + (i % 5) * 0.1), s));
        im.setMatrixAt(i, m);
      }
      im.computeBoundingSphere();
      im.receiveShadow = true;
      group.add(im);
    }

    this.group.add(group);
    this.chunks.set(chunkKey(cx, cz), { key: chunkKey(cx, cz), cx, cz, trees, bushes, rocks, group });
    this.stumpsDirty = true;
  }

  private unloadChunk(key: string) {
    const ch = this.chunks.get(key);
    if (!ch) return;
    this.group.remove(ch.group);
    ch.group.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    this.chunks.delete(key);
    this.stumpsDirty = true;
  }

  private rebuildStumps() {
    this.stumpsDirty = false;
    let n = 0;
    const m = new THREE.Matrix4();
    for (const ch of this.chunks.values()) {
      for (const t of ch.trees) {
        if (!t.felled || n >= 1024) continue;
        const r = Math.max(0.12, t.data.trunkRadius * t.scale * 1.05);
        _q.setFromAxisAngle(UP, t.rotation);
        m.compose(_p.set(t.x, 0, t.z), _q, _s.set(r, 0.35 + r * 0.6, r));
        this.stumps.setMatrixAt(n++, m);
      }
    }
    this.stumps.count = n;
    this.stumps.instanceMatrix.needsUpdate = true;
  }

  *standing(): Iterable<TreeRec> {
    for (const ch of this.chunks.values()) {
      for (const t of ch.trees) if (!t.felled) yield t;
      for (const b of ch.bushes) yield b;
    }
  }

  /** Visit tree/rock colliders near (x, z). Callback gets centre and radius. */
  forEachCollider(x: number, z: number, range: number, cb: (cx: number, cz: number, r: number) => void) {
    const [a0, b0] = worldToChunk(x - range, z - range);
    const [a1, b1] = worldToChunk(x + range, z + range);
    for (let a = a0; a <= a1; a++)
      for (let b = b0; b <= b1; b++) {
        const ch = this.chunks.get(chunkKey(a, b));
        if (!ch) continue;
        for (const t of ch.trees) if (!t.felled) cb(t.x, t.z, t.collR);
        for (const r of ch.rocks) cb(r.x, r.z, r.r);
      }
  }

  /** Pushes a circle (x, z, radius) out of all colliders. Mutates `pos`. */
  resolveCollisions(pos: THREE.Vector3, radius: number) {
    this.forEachCollider(pos.x, pos.z, radius + 2, (cx, cz, r) => {
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const min = r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = (min - d) / d;
        pos.x += dx * push;
        pos.z += dz * push;
      }
    });
  }

  private chunksNear(x: number, z: number, range: number): Chunk[] {
    const out: Chunk[] = [];
    const [a0, b0] = worldToChunk(x - range, z - range);
    const [a1, b1] = worldToChunk(x + range, z + range);
    for (let a = a0; a <= a1; a++)
      for (let b = b0; b <= b1; b++) {
        const ch = this.chunks.get(chunkKey(a, b));
        if (ch) out.push(ch);
      }
    return out;
  }

  /** Best tree to chop: close to the trunk and roughly in front of the player. */
  findChopTarget(pos: THREE.Vector3, facing: number, reach: number): TreeRec | null {
    let best: TreeRec | null = null;
    let bestScore = Infinity;
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    for (const ch of this.chunksNear(pos.x, pos.z, reach + 1)) {
      for (const t of ch.trees) {
        if (t.felled) continue;
        const dx = t.x - pos.x;
        const dz = t.z - pos.z;
        const d = Math.hypot(dx, dz);
        const gap = d - t.collR;
        if (gap > reach) continue;
        const dot = d > 1e-3 ? (dx * fx + dz * fz) / d : 1;
        if (dot < -0.2) continue;
        const score = gap - dot * 0.8;
        if (score < bestScore) {
          bestScore = score;
          best = t;
        }
      }
    }
    return best;
  }

  /** The bush the point is hiding in, if any. */
  bushAt(x: number, z: number): TreeRec | null {
    for (const ch of this.chunksNear(x, z, 3)) {
      for (const b of ch.bushes) {
        if (Math.hypot(b.x - x, b.z - z) < b.hideR) return b;
      }
    }
    return null;
  }

  /** Whether a straight sight line between two points is blocked by trunks or bushes. */
  sightBlocked(ax: number, az: number, bx: number, bz: number, ignoreBush: TreeRec | null): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-6) return false;
    const minX = Math.min(ax, bx) - 2;
    const maxX = Math.max(ax, bx) + 2;
    const minZ = Math.min(az, bz) - 2;
    const maxZ = Math.max(az, bz) + 2;
    const [a0, b0] = worldToChunk(minX, minZ);
    const [a1, b1] = worldToChunk(maxX, maxZ);
    const blocks = (cx: number, cz: number, r: number) => {
      const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / len2));
      const px = ax + dx * t - cx;
      const pz = az + dz * t - cz;
      return t > 0.02 && t < 0.98 && px * px + pz * pz < r * r;
    };
    for (let a = a0; a <= a1; a++)
      for (let b = b0; b <= b1; b++) {
        const ch = this.chunks.get(chunkKey(a, b));
        if (!ch) continue;
        for (const t of ch.trees) if (!t.felled && blocks(t.x, t.z, t.collR * 1.6)) return true;
        for (const bu of ch.bushes) if (bu !== ignoreBush && blocks(bu.x, bu.z, bu.hideR * 0.7)) return true;
        for (const r of ch.rocks) if (r.r > 0.5 && blocks(r.x, r.z, r.r)) return true;
      }
    return false;
  }

  /** Applies a chop to a tree. Returns true if this chop fells it. */
  hit(t: TreeRec, from: THREE.Vector3): boolean {
    t.hp = Math.max(0, t.hp - 1);
    t.shake = 0.35;
    t.shakeDir.set(t.x - from.x, 0, t.z - from.z).normalize();
    return t.hp === 0;
  }

  /** Starts the felling animation; the tree falls away from `from`. */
  fell(t: TreeRec, from: THREE.Vector3, onCrash: Falling['onCrash']) {
    t.felled = true;
    t.override = null;
    this.felled.add(t.id);
    this.stumpsDirty = true;

    const dir = new THREE.Vector3(t.x - from.x, 0, t.z - from.z);
    if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
    dir.normalize();
    // A little randomness so trees don't all fall exactly away from you.
    dir.applyAxisAngle(UP, (Math.random() - 0.5) * 0.5);

    const pivot = new THREE.Group();
    pivot.position.set(t.x, 0.3, t.z);
    const body = this.instancer.makeStandalone(t.species, t.variant);
    body.rotation.y = t.rotation;
    body.scale.setScalar(t.spec.scale * t.scale);
    body.position.y = -0.3;
    pivot.add(body);
    this.group.add(pivot);
    const axis = new THREE.Vector3().crossVectors(UP, dir).normalize();
    this.falling.push({ rec: t, pivot, axis, dir, t: 0, crashed: false, onCrash });
  }

  /** Per-frame animation of shaking and falling trees. */
  animate(dt: number) {
    // Shake
    for (const ch of this.chunks.values()) {
      for (const t of ch.trees) {
        if (t.shake <= 0 || t.felled) continue;
        t.shake = Math.max(0, t.shake - dt);
        const k = t.shake / 0.35;
        const ang = Math.sin(k * 28) * 0.035 * k;
        const axis = _p.crossVectors(UP, t.shakeDir).normalize();
        _q2.setFromAxisAngle(axis, ang);
        _q.setFromAxisAngle(UP, t.rotation);
        _q2.multiply(_q);
        const s = t.spec.scale * t.scale;
        t.override = t.override ?? new THREE.Matrix4();
        t.override.compose(_s.set(t.x, 0, t.z), _q2, new THREE.Vector3(s, s, s));
        if (t.shake === 0) t.override = null;
      }
    }

    // Falling
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.t += dt;
      const T = 1.9;
      let ang: number;
      if (f.t < T) {
        const u = f.t / T;
        ang = (Math.PI / 2) * 0.97 * u * u * u;
      } else {
        if (!f.crashed) {
          f.crashed = true;
          f.onCrash(f.rec, f.dir);
        }
        const b = f.t - T;
        ang = (Math.PI / 2) * 0.97 - Math.abs(Math.sin(b * 9)) * 0.06 * Math.exp(-b * 4);
      }
      f.pivot.quaternion.setFromAxisAngle(f.axis, ang);
      if (f.t > T + 3) f.pivot.position.y -= dt * 0.6;
      if (f.t > T + 5) {
        this.group.remove(f.pivot);
        this.falling.splice(i, 1);
      }
    }
  }

  get loadedChunkCount() {
    return this.chunks.size;
  }

  /** Nearby standing trees for the minimap. */
  forEachNearby(x: number, z: number, range: number, cb: (t: TreeRec) => void) {
    for (const ch of this.chunksNear(x, z, range)) {
      for (const t of ch.trees) if (!t.felled) cb(t);
      for (const b of ch.bushes) cb(b);
    }
  }

  /** Starts a fresh forest (new layout, nothing felled). */
  reset(seed: number) {
    for (const key of [...this.chunks.keys()]) this.unloadChunk(key);
    for (const f of this.falling) this.group.remove(f.pivot);
    this.falling = [];
    this.felled.clear();
    this.seed = seed;
    this.stumpsDirty = true;
  }

  dispose() {
    for (const key of [...this.chunks.keys()]) this.unloadChunk(key);
  }
}
