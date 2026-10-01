import * as THREE from 'three';

interface Particle {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  life: number;
  max: number;
  size: number;
}

/** Wood chips, leaves and dust, pooled in instanced meshes. */
class Pool {
  mesh: THREE.InstancedMesh;
  parts: Particle[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, private cap: number, private gravity: number, private drag: number) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cap; i++)
      this.parts.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), life: 0, max: 1, size: 1 });
  }

  emit(pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number) {
    const p = this.parts.find((x) => !x.alive);
    if (!p) return;
    p.alive = true;
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    p.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
    p.life = 0;
    p.max = life;
    p.size = size;
  }

  update(dt: number) {
    let n = 0;
    for (const p of this.parts) {
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.max) {
        p.alive = false;
        continue;
      }
      p.vel.y -= this.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - this.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.02) {
        p.pos.y = 0.02;
        p.vel.set(p.vel.x * 0.3, Math.abs(p.vel.y) * 0.2, p.vel.z * 0.3);
        p.spin.multiplyScalar(0.5);
      }
      p.rot.x += p.spin.x * dt;
      p.rot.y += p.spin.y * dt;
      p.rot.z += p.spin.z * dt;
      const fade = 1 - Math.max(0, (p.life - p.max * 0.7) / (p.max * 0.3));
      this.q.setFromEuler(p.rot);
      this.m.compose(p.pos, this.q, this.s.setScalar(p.size * fade));
      this.mesh.setMatrixAt(n++, this.m);
      if (n >= this.cap) break;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Effects {
  readonly group = new THREE.Group();
  private chips: Pool;
  private leaves: Pool;
  private dust: Pool;
  private popups: { sprite: THREE.Sprite; t: number; vy: number }[] = [];

  constructor() {
    this.chips = new Pool(new THREE.BoxGeometry(0.06, 0.02, 0.1), new THREE.MeshStandardMaterial({ color: '#e8c48a', roughness: 1 }), 160, 9.8, 0.4);
    this.leaves = new Pool(new THREE.PlaneGeometry(0.12, 0.08), new THREE.MeshStandardMaterial({ color: '#5f8a3a', side: THREE.DoubleSide, roughness: 1 }), 200, 1.2, 1.8);
    this.dust = new Pool(
      new THREE.IcosahedronGeometry(0.5, 0),
      new THREE.MeshBasicMaterial({ color: '#c9b48f', transparent: true, opacity: 0.35, depthWrite: false }),
      60,
      -0.3,
      1.6,
    );
    this.group.add(this.chips.mesh, this.leaves.mesh, this.dust.mesh);
  }

  chop(at: THREE.Vector3, dir: THREE.Vector3) {
    for (let i = 0; i < 9; i++) {
      const v = new THREE.Vector3(-dir.x * 2 + (Math.random() - 0.5) * 3, 1.5 + Math.random() * 2.5, -dir.z * 2 + (Math.random() - 0.5) * 3);
      this.chips.emit(at, v, 1.2 + Math.random() * 0.6, 0.7 + Math.random() * 0.8);
    }
  }

  leafFall(x: number, z: number, height: number, radius: number, count = 8) {
    for (let i = 0; i < count; i++) {
      const p = new THREE.Vector3(x + (Math.random() - 0.5) * radius * 2, height * (0.6 + Math.random() * 0.4), z + (Math.random() - 0.5) * radius * 2);
      this.leaves.emit(p, new THREE.Vector3((Math.random() - 0.5) * 1.2, -0.5, (Math.random() - 0.5) * 1.2), 4 + Math.random() * 2, 0.8 + Math.random() * 0.8);
    }
  }

  dustBurst(x: number, z: number, dir: THREE.Vector3, length: number) {
    for (let i = 0; i < 26; i++) {
      const along = Math.random() * length;
      const p = new THREE.Vector3(x + dir.x * along + (Math.random() - 0.5) * 1.5, 0.2, z + dir.z * along + (Math.random() - 0.5) * 1.5);
      this.dust.emit(p, new THREE.Vector3((Math.random() - 0.5) * 2.5, 0.5 + Math.random() * 1.5, (Math.random() - 0.5) * 2.5), 1.4 + Math.random(), 0.6 + Math.random() * 1.1);
    }
  }

  /** Floating "+90" style text above a point. */
  popup(text: string, at: THREE.Vector3, color = '#ffd23f', scale = 1) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 96;
    const g = c.getContext('2d')!;
    g.font = '800 54px "Be Vietnam Pro", system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 10;
    g.strokeStyle = 'rgba(20,16,10,0.9)';
    g.strokeText(text, 128, 50);
    g.fillStyle = color;
    g.fillText(text, 128, 50);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.scale.set(2.4 * scale, 0.9 * scale, 1);
    sprite.position.copy(at);
    sprite.renderOrder = 20;
    this.group.add(sprite);
    this.popups.push({ sprite, t: 0, vy: 1.4 });
  }

  update(dt: number) {
    this.chips.update(dt);
    this.leaves.update(dt);
    this.dust.update(dt);
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.t += dt;
      p.sprite.position.y += p.vy * dt;
      p.vy *= 1 - dt * 1.2;
      const m = p.sprite.material as THREE.SpriteMaterial;
      m.opacity = Math.min(1, 2.2 - p.t);
      if (p.t > 2.2) {
        this.group.remove(p.sprite);
        m.map?.dispose();
        m.dispose();
        this.popups.splice(i, 1);
      }
    }
  }
}
