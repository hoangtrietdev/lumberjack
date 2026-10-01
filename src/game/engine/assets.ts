import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

export interface BarkMaps {
  color: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
}

export interface Assets {
  bark: Record<string, BarkMaps>;
  leaves: Record<string, THREE.Texture>;
  grassTexture: THREE.Texture;
  dirtTexture: THREE.Texture;
  grassClump: THREE.Mesh | null;
  rocks: THREE.Mesh[];
}

const BARKS = ['Bark001', 'Bark002', 'Bark003'];
const LEAVES = ['ash', 'aspen', 'oak', 'pine'];

function loadTexture(loader: THREE.TextureLoader, url: string, srgb: boolean): Promise<THREE.Texture> {
  return new Promise((resolve) => {
    loader.load(
      url,
      (t) => {
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        resolve(t);
      },
      undefined,
      () => {
        console.warn('Missing texture', url);
        resolve(new THREE.Texture());
      },
    );
  });
}

export async function loadAssets(onProgress: (p: number) => void): Promise<Assets> {
  const tl = new THREE.TextureLoader();
  const jobs: Promise<unknown>[] = [];
  let done = 0;
  const track = <T,>(p: Promise<T>): Promise<T> => {
    jobs.push(p);
    return p.then((v) => {
      done++;
      onProgress(done / jobs.length);
      return v;
    });
  };

  const bark: Record<string, BarkMaps> = {};
  for (const b of BARKS) {
    const base = `/textures/bark/${b}_`;
    const [color, normal, roughness] = await Promise.all([
      track(loadTexture(tl, `${base}Color.jpg`, true)),
      track(loadTexture(tl, `${base}NormalGL.jpg`, false)),
      track(loadTexture(tl, `${base}Roughness.jpg`, false)),
    ]);
    bark[b] = { color, normal, roughness };
  }

  const leaves: Record<string, THREE.Texture> = {};
  await Promise.all(
    LEAVES.map(async (l) => {
      const t = await track(loadTexture(tl, `/textures/leaves/${l}.png`, true));
      t.premultiplyAlpha = true;
      coverageMipmaps(t, 0.5);
      leaves[l] = t;
    }),
  );

  const [grassTexture, dirtTexture] = await Promise.all([
    track(loadTexture(tl, '/textures/ground/grass.jpg', true)),
    track(loadTexture(tl, '/textures/ground/dirt_color.jpg', true)),
  ]);
  for (const t of [grassTexture, dirtTexture]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
  }

  const gltf = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/');
  gltf.setDRACOLoader(draco);

  const firstMesh = (o: THREE.Object3D): THREE.Mesh | null => {
    let found: THREE.Mesh | null = null;
    o.traverse((c) => {
      if (!found && (c as THREE.Mesh).isMesh) found = c as THREE.Mesh;
    });
    return found;
  };

  const safeLoad = (url: string) =>
    track(
      gltf.loadAsync(url).then(
        (g) => firstMesh(g.scene),
        (e) => {
          console.warn('Model failed', url, e);
          return null;
        },
      ),
    );

  const [grassClump, r1, r2, r3] = await Promise.all([
    safeLoad('/models/grass.glb'),
    safeLoad('/models/rock1.glb'),
    safeLoad('/models/rock2.glb'),
    safeLoad('/models/rock3.glb'),
  ]);
  draco.dispose();

  // Normalise rock geometry to a unit-size footprint sitting on y=0.
  const rocks: THREE.Mesh[] = [];
  for (const r of [r1, r2, r3]) {
    if (!r) continue;
    const g = r.geometry.clone();
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const size = new THREE.Vector3();
    bb.getSize(size);
    const s = 1 / Math.max(size.x, size.z);
    g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    g.scale(s, s, s);
    g.computeBoundingSphere();
    rocks.push(new THREE.Mesh(g, r.material));
  }

  if (grassClump) {
    const g = grassClump.geometry.clone();
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const h = bb.max.y - bb.min.y || 1;
    g.translate(0, -bb.min.y, 0);
    g.scale(0.55 / h, 0.55 / h, 0.55 / h);
    grassClump.geometry = g;
  }

  return { bark, leaves, grassTexture, dirtTexture, grassClump, rocks };
}

/**
 * Builds mipmaps that keep the same alpha-tested coverage at every level.
 *
 * With normal mipmaps the leaf alpha is averaged away as a tree gets smaller
 * on screen, so `alphaTest` discards every leaf pixel and distant trees look
 * bare (while their shadows, rendered at a higher texel density, still show
 * foliage). Here each level's alpha is scaled until the share of pixels above
 * the threshold matches the full-size texture.
 */
export function coverageMipmaps(tex: THREE.Texture, threshold: number) {
  const img = tex.image as CanvasImageSource & { width: number; height: number };
  if (!img || !img.width || typeof document === 'undefined') return;
  const make = (w: number, h: number) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  };
  const coverage = (a: Uint8ClampedArray, scale: number) => {
    let n = 0;
    const cut = threshold * 255;
    for (let i = 3; i < a.length; i += 4) if (a[i] * scale > cut) n++;
    return n / (a.length / 4);
  };

  let w = img.width;
  let h = img.height;
  const base = make(w, h);
  const bctx = base.getContext('2d', { willReadFrequently: true });
  if (!bctx) return;
  bctx.drawImage(img, 0, 0);
  const target = coverage(bctx.getImageData(0, 0, w, h).data, 1);
  const mipmaps: HTMLCanvasElement[] = [base];
  let prev: HTMLCanvasElement = base;

  while (w > 1 || h > 1) {
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
    const c = make(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(prev, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const a = data.data;
    // Binary search the alpha scale that restores the original coverage.
    let lo = 1;
    let hi = 6;
    for (let k = 0; k < 14; k++) {
      const mid = (lo + hi) / 2;
      if (coverage(a, mid) < target) lo = mid;
      else hi = mid;
    }
    const scale = (lo + hi) / 2;
    for (let i = 3; i < a.length; i += 4) a[i] = Math.min(255, a[i] * scale);
    ctx.putImageData(data, 0, 0);
    mipmaps.push(c);
    prev = c;
  }

  tex.mipmaps = mipmaps as unknown as THREE.Texture['mipmaps'];
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
}
