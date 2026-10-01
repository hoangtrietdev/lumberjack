import * as THREE from 'three';

/** Simple procedural characters built from primitives, with a tiny rig. */

function plaidTexture(base: string, line: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = line;
  g.globalAlpha = 0.55;
  for (let i = 0; i < 64; i += 16) {
    g.fillRect(i, 0, 6, 64);
    g.fillRect(0, i, 64, 6);
  }
  g.globalAlpha = 0.25;
  g.fillStyle = '#000';
  for (let i = 8; i < 64; i += 16) {
    g.fillRect(i, 0, 1, 64);
    g.fillRect(0, i, 64, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  t.magFilter = THREE.NearestFilter;
  return t;
}

const mat = (color: THREE.ColorRepresentation, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });

function capsule(r: number, len: number, m: THREE.Material, pivotTop = true): THREE.Mesh {
  const g = new THREE.CapsuleGeometry(r, len, 4, 10);
  if (pivotTop) g.translate(0, -len / 2 - r * 0.6, 0);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}

export class Rig {
  root = new THREE.Group();
  body = new THREE.Group(); // bob + twist
  torso = new THREE.Group();
  head = new THREE.Group();
  armL = new THREE.Group();
  armR = new THREE.Group();
  legL = new THREE.Group();
  legR = new THREE.Group();
  tool: THREE.Group | null = null;
  private walkPhase = 0;

  constructor() {
    this.root.add(this.body);
    this.body.add(this.torso, this.legL, this.legR);
    this.torso.add(this.head, this.armL, this.armR);
    this.legL.position.set(-0.11, 0.92, 0);
    this.legR.position.set(0.11, 0.92, 0);
    this.torso.position.set(0, 0.95, 0);
    this.armL.position.set(-0.3, 0.52, 0);
    this.armR.position.set(0.3, 0.52, 0);
    this.head.position.set(0, 0.74, 0);
  }

  /**
   * @param speed horizontal speed m/s
   * @param chop 0..1 chop cycle progress, or -1 when not chopping
   */
  animate(dt: number, speed: number, chop = -1, alertLook = 0) {
    const moving = Math.min(1, speed / 4);
    this.walkPhase += dt * (4 + speed * 1.9);
    const s = Math.sin(this.walkPhase);
    const swing = 0.75 * moving;
    this.legL.rotation.x = s * swing;
    this.legR.rotation.x = -s * swing;
    this.body.position.y = Math.abs(Math.cos(this.walkPhase)) * 0.06 * moving;
    this.torso.rotation.x = 0.12 * moving;

    if (chop >= 0) {
      // Horizontal swing: arms forward, torso winds back then whips through.
      let twist: number;
      if (chop < 0.55) twist = THREE.MathUtils.lerp(0, 1.0, easeOut(chop / 0.55));
      else if (chop < 0.72) twist = THREE.MathUtils.lerp(1.0, -0.65, easeIn((chop - 0.55) / 0.17));
      else twist = THREE.MathUtils.lerp(-0.65, 0, easeOut((chop - 0.72) / 0.28));
      this.torso.rotation.y = twist;
      this.armR.rotation.set(-1.35, 0, -0.15);
      this.armL.rotation.set(-1.35, 0, 0.55);
      this.legL.rotation.x = 0.2;
      this.legR.rotation.x = -0.25;
    } else {
      this.torso.rotation.y *= 0.8;
      this.armL.rotation.set(-s * swing * 0.9, 0, 0.08);
      this.armR.rotation.set(s * swing * 0.9 + (this.tool ? -0.25 : 0), 0, -0.08);
    }
    this.head.rotation.y = alertLook;
  }
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeIn = (t: number) => t * t;

export function buildLumberjack(): Rig {
  const rig = new Rig();
  const plaid = mat('#ffffff', { map: plaidTexture('#b3261e', '#1d1d1d') });
  const jeans = mat('#2f4a6d');
  const skin = mat('#e0ac83');
  const boot = mat('#4a2f1b');
  const beard = mat('#6b3f22');
  const beanie = mat('#e2861a');

  // Torso
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.25, 4, 12), plaid);
  chest.position.y = 0.28;
  chest.scale.set(1, 1, 0.75);
  chest.castShadow = true;
  rig.torso.add(chest);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.07, 14), mat('#3a2614'));
  belt.position.y = 0.04;
  belt.scale.z = 0.78;
  rig.torso.add(belt);

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), skin);
  head.castShadow = true;
  rig.head.add(head);
  const beardMesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), beard);
  beardMesh.position.set(0, -0.03, 0.035);
  beardMesh.scale.set(1.02, 1.1, 1.05);
  rig.head.add(beardMesh);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.168, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), beanie);
  cap.position.y = 0.02;
  rig.head.add(cap);
  const brim = new THREE.Mesh(new THREE.TorusGeometry(0.162, 0.03, 8, 20), beanie);
  brim.rotation.x = Math.PI / 2;
  brim.position.y = 0.03;
  rig.head.add(brim);
  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), mat('#f4efe6'));
  pom.position.y = 0.19;
  rig.head.add(pom);
  for (const x of [-0.055, 0.055]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), mat('#1a1a1a'));
    eye.position.set(x, 0.03, 0.145);
    rig.head.add(eye);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), mat('#d48f6b'));
  nose.position.set(0, -0.005, 0.16);
  rig.head.add(nose);

  // Arms
  for (const [arm, side] of [[rig.armL, -1], [rig.armR, 1]] as const) {
    arm.add(capsule(0.075, 0.42, plaid));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 8), skin);
    hand.position.y = -0.6;
    arm.add(hand);
    void side;
  }

  // Legs
  for (const leg of [rig.legL, rig.legR]) {
    leg.add(capsule(0.095, 0.62, jeans));
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.12, 0.28), boot);
    b.position.set(0, -0.86, 0.04);
    b.castShadow = true;
    leg.add(b);
  }

  // Axe in the right hand, pointing forward along the arm.
  const axe = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.85, 8), mat('#8a5a2b'));
  handle.position.y = -0.25;
  handle.castShadow = true;
  axe.add(handle);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.16, 0.22), mat('#a9b0b7', { metalness: 0.7, roughness: 0.35 }));
  blade.position.set(0, -0.6, 0.09);
  blade.castShadow = true;
  axe.add(blade);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.17, 0.03), mat('#e8edf2', { metalness: 0.9, roughness: 0.2 }));
  edge.position.set(0, -0.6, 0.2);
  axe.add(edge);
  axe.position.y = -0.6;
  axe.rotation.y = -Math.PI / 2; // blade faces the swing direction
  rig.armR.add(axe);
  rig.tool = axe;
  return rig;
}

export function buildRanger(): Rig {
  const rig = new Rig();
  const shirt = mat('#6d7a3a');
  const pants = mat('#3b4524');
  const skin = mat(['#c98d64', '#e2b08a', '#a8714e'][Math.floor(Math.random() * 3)]);
  const hatM = mat('#8c6b3e');

  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.25, 4, 12), shirt);
  chest.position.y = 0.28;
  chest.scale.set(1, 1, 0.75);
  chest.castShadow = true;
  rig.torso.add(chest);
  const badge = new THREE.Mesh(new THREE.CircleGeometry(0.045, 6), mat('#f2c230', { metalness: 0.6, roughness: 0.3 }));
  badge.position.set(-0.1, 0.42, 0.185);
  rig.torso.add(badge);
  const patch = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.1), mat('#c0392b'));
  patch.position.set(0.25, 0.48, 0);
  patch.rotation.y = Math.PI / 2;
  rig.torso.add(patch);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.07, 14), mat('#1f1a12'));
  belt.position.y = 0.04;
  belt.scale.z = 0.78;
  rig.torso.add(belt);
  const radio = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.05), mat('#202020'));
  radio.position.set(0.2, 0.06, 0.12);
  rig.torso.add(radio);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 12), skin);
  head.castShadow = true;
  rig.head.add(head);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.025, 20), hatM);
  brim.position.y = 0.08;
  brim.castShadow = true;
  rig.head.add(brim);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.14, 16), hatM);
  crown.position.y = 0.16;
  rig.head.add(crown);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.162, 0.162, 0.03, 16), mat('#3b2a16'));
  band.position.y = 0.11;
  rig.head.add(band);
  for (const x of [-0.055, 0.055]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), mat('#1a1a1a'));
    eye.position.set(x, 0.02, 0.14);
    rig.head.add(eye);
  }
  const mustache = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), mat('#2b1d12'));
  mustache.position.set(0, -0.045, 0.148);
  rig.head.add(mustache);

  for (const arm of [rig.armL, rig.armR]) {
    arm.add(capsule(0.072, 0.42, shirt));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 8), skin);
    hand.position.y = -0.6;
    arm.add(hand);
  }
  // Flashlight in the left hand.
  const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.2, 8), mat('#2a2a2a'));
  torch.position.set(0, -0.66, 0.05);
  torch.rotation.x = Math.PI / 2;
  rig.armL.add(torch);

  for (const leg of [rig.legL, rig.legR]) {
    leg.add(capsule(0.095, 0.62, pants));
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.12, 0.28), mat('#16120d'));
    b.position.set(0, -0.86, 0.04);
    b.castShadow = true;
    leg.add(b);
  }
  return rig;
}
