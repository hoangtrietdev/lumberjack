import * as THREE from 'three';
import type { Difficulty } from '../logic/rules';
import { buildRanger, type Rig } from './characters';
import { lerpAngle } from './player';
import type { TreeRec, World } from './world';

export type RangerState = 'patrol' | 'investigate' | 'chase' | 'search' | 'stunned';

function iconTexture(text: string, color: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.font = 'bold 54px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = '#1b1b1b';
  g.strokeText(text, 32, 36);
  g.fillStyle = color;
  g.fillText(text, 32, 36);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let ICONS: Record<string, THREE.SpriteMaterial> | null = null;
function icons() {
  if (!ICONS) {
    ICONS = {
      '?': new THREE.SpriteMaterial({ map: iconTexture('?', '#ffd23f'), depthTest: false }),
      '!': new THREE.SpriteMaterial({ map: iconTexture('!', '#ff3b30'), depthTest: false }),
      z: new THREE.SpriteMaterial({ map: iconTexture('✶', '#ffffff'), depthTest: false }),
    };
  }
  return ICONS;
}

function coneGeometry(fovDeg: number): THREE.BufferGeometry {
  const seg = 20;
  const half = THREE.MathUtils.degToRad(fovDeg / 2);
  const pos: number[] = [0, 0, 0];
  for (let i = 0; i <= seg; i++) {
    const a = -half + (2 * half * i) / seg;
    pos.push(Math.sin(a), 0, Math.cos(a));
  }
  const idx: number[] = [];
  for (let i = 1; i <= seg; i++) idx.push(0, i, i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // Fade alpha toward the rim
  const alpha = [1];
  for (let i = 0; i <= seg; i++) alpha.push(0);
  g.setAttribute('alpha', new THREE.Float32BufferAttribute(alpha, 1));
  g.setIndex(idx);
  return g;
}

const coneMaterial = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color('#ffe08a') }, uOpacity: { value: 0.22 } },
    vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA; void main(){ gl_FragColor = vec4(uColor, uOpacity * (0.25 + 0.75 * vA)); }`,
  });

export class Ranger {
  readonly rig: Rig;
  readonly pos = new THREE.Vector3();
  facing = 0;
  state: RangerState = 'patrol';
  target = new THREE.Vector3();
  timer = 0;
  suspicion = 0; // 0..1 builds while the player is in view
  lostTimer = 0;
  stuckTimer = 0;
  speed = 0;
  lookAround = 0;
  /** Running to a radio call / tip-off instead of strolling. */
  urgent = false;
  /** Angle used to spread chasers around the player (set by the manager). */
  flank = 0;
  private searchLeft = 0;
  private searchCenter = new THREE.Vector3();
  private lastSeen = new THREE.Vector3();
  private lastSeenVel = new THREE.Vector3();
  private targetAge = 0;
  private icon: THREE.Sprite;
  private cone: THREE.Mesh;
  private coneFov = 0;
  private lastPos = new THREE.Vector3();
  private detour = 0;

  constructor(private scene: THREE.Object3D, x: number, z: number) {
    this.rig = buildRanger();
    this.pos.set(x, 0, z);
    this.lastPos.copy(this.pos);
    this.icon = new THREE.Sprite(icons()['?']);
    this.icon.scale.set(0.7, 0.7, 0.7);
    this.icon.position.y = 2.45;
    this.icon.visible = false;
    this.icon.renderOrder = 10;
    this.rig.root.add(this.icon);
    this.cone = new THREE.Mesh(coneGeometry(110), coneMaterial());
    this.cone.position.y = 0.04;
    this.cone.renderOrder = 1;
    scene.add(this.rig.root, this.cone);
  }

  dispose() {
    this.scene.remove(this.rig.root, this.cone);
    this.cone.geometry.dispose();
    (this.cone.material as THREE.Material).dispose();
  }

  get busy() {
    return this.state === 'chase' || this.state === 'stunned';
  }

  /** Hear a noise at (x, z). Louder (closer) noises are located more precisely. */
  hear(x: number, z: number, loudness: number) {
    if (this.busy) return;
    this.goCheck(x, z, 5 * (1 - loudness), false);
  }

  /** Radio call or tip-off: run to the reported spot and search around it. */
  dispatch(x: number, z: number, error: number) {
    if (this.busy) return;
    this.goCheck(x, z, error, true);
  }

  private goCheck(x: number, z: number, err: number, urgent: boolean) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * err;
    this.target.set(x + Math.cos(a) * r, 0, z + Math.sin(a) * r);
    this.searchCenter.copy(this.target);
    this.state = 'investigate';
    this.urgent = urgent || this.urgent;
    this.timer = 0;
    this.targetAge = 0;
    this.searchLeft = 2;
  }

  stun(seconds: number) {
    this.state = 'stunned';
    this.timer = seconds;
    this.suspicion = 0;
    this.urgent = false;
  }

  /** Can the ranger currently see the player? */
  canSee(player: THREE.Vector3, hidden: TreeRec | null, noisy: boolean, world: World, d: Difficulty): boolean {
    if (this.state === 'stunned') return false;
    const dx = player.x - this.pos.x;
    const dz = player.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    let range = d.sightRange;
    if (this.state === 'chase') range *= 1.5;
    if (hidden) {
      // A bush hides you, unless you chop in it or a chaser is right on your heels.
      if (this.state === 'chase' && dist < 3.5) return true;
      range = noisy ? 7 : 2.2;
    }
    if (dist > range) return false;
    if (dist > 2.5) {
      const fov = this.state === 'chase' ? 240 : d.fovDeg;
      const ang = Math.abs(angleDiff(this.facing, Math.atan2(dx, dz)));
      if (ang > THREE.MathUtils.degToRad(fov / 2)) return false;
    }
    return !world.sightBlocked(this.pos.x, this.pos.z, player.x, player.z, hidden);
  }

  update(dt: number, player: THREE.Vector3, playerVel: THREE.Vector3, sees: boolean, world: World, d: Difficulty, onSpotted: (r: Ranger) => void) {
    const dist = this.pos.distanceTo(player);

    if (this.state === 'stunned') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = 'search';
        this.target.copy(player);
        this.searchCenter.copy(player);
        this.searchLeft = 2;
        this.urgent = true;
        this.timer = 0;
      }
    } else if (sees) {
      // Close range = instant; far away takes a moment to recognise you.
      const rate = (dist < 6 ? 10 : 1.6 * (1 - dist / (d.sightRange * 1.5)) + 0.7) * d.awareness;
      this.suspicion = Math.min(1, this.suspicion + rate * dt);
      this.lastSeen.copy(player);
      this.lastSeenVel.copy(playerVel);
      if (this.suspicion >= 1 && this.state !== 'chase') {
        this.state = 'chase';
        this.urgent = true;
        onSpotted(this);
      }
      if (this.state === 'chase') {
        this.lostTimer = 0;
      } else if (this.suspicion > 0.3) {
        this.state = 'investigate';
        this.target.copy(player);
        this.searchCenter.copy(player);
      }
    } else {
      this.suspicion = Math.max(0, this.suspicion - dt * 0.3);
      if (this.state === 'chase') {
        this.lostTimer += dt;
        if (this.lostTimer > d.pursuitMemory) {
          // Lost you: sweep the area around where you were heading.
          this.state = 'search';
          this.searchCenter.copy(this.lastSeen).addScaledVector(this.lastSeenVel, 1.2);
          this.target.copy(this.searchCenter);
          this.searchLeft = 3;
          this.timer = 0;
        }
      }
    }

    if (this.state === 'chase') {
      if (this.lostTimer === 0) {
        // Aim where the player is going, and fan out so several chasers surround them.
        const lead = Math.min(1.1, dist / Math.max(1, d.runSpeed));
        this.target.copy(player).addScaledVector(playerVel, lead * 0.9);
        if (dist > 4) {
          const side = Math.min(4, dist * 0.25);
          this.target.x += Math.cos(this.flank) * side;
          this.target.z += Math.sin(this.flank) * side;
        }
      } else {
        // Still hunting: follow the last sighting along the player's heading.
        this.target.copy(this.lastSeen).addScaledVector(this.lastSeenVel, Math.min(2.5, this.lostTimer * 1.2));
      }
    }

    // Re-plan patrols that take too long (unreachable spot, player moved on).
    this.targetAge += dt;
    if (this.state === 'patrol' && this.targetAge > 12) this.pickPatrolTarget(player, d.pressure);

    // Speed
    let moveSpeed = d.walkSpeed;
    if (this.state === 'chase') moveSpeed = d.runSpeed;
    else if (this.state === 'investigate' || this.state === 'search') moveSpeed = this.urgent ? d.runSpeed * 0.85 : d.walkSpeed * 1.5;
    if (this.state === 'stunned') moveSpeed = 0;

    const toT = new THREE.Vector3().subVectors(this.target, this.pos).setY(0);
    const tDist = toT.length();
    const arrived = tDist < (this.state === 'chase' ? 0.2 : 1.2);

    if (arrived && this.state !== 'chase') {
      moveSpeed = 0;
      this.timer += dt;
      this.lookAround += dt;
      this.facing += Math.sin(this.lookAround * 1.6) * dt * 2.2;
      const wait = this.state === 'patrol' ? 1.2 : 1.6;
      if (this.timer > wait) {
        this.timer = 0;
        if (this.state !== 'patrol' && this.searchLeft > 0) {
          // Sweep a few spots around the search centre before giving up.
          this.searchLeft--;
          const a = Math.random() * Math.PI * 2;
          const r = 3 + Math.random() * 5;
          this.target.set(this.searchCenter.x + Math.cos(a) * r, 0, this.searchCenter.z + Math.sin(a) * r);
        } else {
          this.state = 'patrol';
          this.urgent = false;
          this.pickPatrolTarget(player, d.pressure);
        }
      }
    }

    if (moveSpeed > 0 && tDist > 0.05) {
      let want = Math.atan2(toT.x, toT.z);
      // Simple avoidance: if stuck, steer sideways for a moment.
      if (this.detour !== 0) want += this.detour;
      this.facing = lerpAngle(this.facing, want, Math.min(1, dt * (this.state === 'chase' ? 9 : 6)));
      const sp = Math.min(moveSpeed, tDist / Math.max(dt, 1e-3));
      this.speed += (sp - this.speed) * Math.min(1, dt * 6);
    } else {
      this.speed += (0 - this.speed) * Math.min(1, dt * 8);
    }

    this.pos.x += Math.sin(this.facing) * this.speed * dt;
    this.pos.z += Math.cos(this.facing) * this.speed * dt;
    world.resolveCollisions(this.pos, 0.33);

    // Stuck detection
    const moved = this.pos.distanceTo(this.lastPos);
    this.lastPos.copy(this.pos);
    if (this.speed > 0.5 && moved < this.speed * dt * 0.35) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.2) {
        this.detour = (Math.random() < 0.5 ? -1 : 1) * (0.9 + Math.random() * 0.6);
        this.stuckTimer = -0.6; // hold the detour a little while
      }
    } else if (this.stuckTimer < 0) {
      this.stuckTimer += dt;
      if (this.stuckTimer >= 0) this.detour = 0;
    } else {
      this.stuckTimer = 0;
      this.detour = 0;
    }

    // Visuals
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.facing;
    if (this.state === 'stunned') {
      this.rig.root.rotation.z = Math.min(1.45, this.rig.root.rotation.z + dt * 6);
      this.rig.animate(dt, 0);
    } else {
      this.rig.root.rotation.z *= 0.85;
      this.rig.animate(dt, this.speed, -1, arrived ? Math.sin(this.lookAround * 2.2) * 0.6 : 0);
    }

    const iconKey =
      this.state === 'stunned' ? 'z' : this.state === 'chase' ? '!' : this.state === 'investigate' || this.state === 'search' || this.suspicion > 0.15 ? '?' : null;
    this.icon.visible = iconKey !== null;
    if (iconKey) {
      this.icon.material = icons()[iconKey];
      const pulse = iconKey === '!' ? 1 + Math.sin(performance.now() / 90) * 0.12 : 0.7 + this.suspicion * 0.4;
      this.icon.scale.setScalar(0.7 * pulse);
    }

    // Vision cone
    const fov = this.state === 'chase' ? 0 : d.fovDeg;
    if (Math.abs(fov - this.coneFov) > 4) {
      this.cone.geometry.dispose();
      this.cone.geometry = coneGeometry(Math.max(10, fov));
      this.coneFov = fov;
    }
    this.cone.visible = this.state !== 'chase' && this.state !== 'stunned';
    this.cone.position.set(this.pos.x, 0.05, this.pos.z);
    this.cone.rotation.y = this.facing;
    this.cone.scale.setScalar(d.sightRange);
    const u = (this.cone.material as THREE.ShaderMaterial).uniforms;
    (u.uColor.value as THREE.Color).set(this.state === 'patrol' ? (this.suspicion > 0.1 ? '#ffb347' : '#ffe08a') : '#ff9f43');
    u.uOpacity.value = 0.16 + this.suspicion * 0.25;

    return dist;
  }

  pickPatrolTarget(player: THREE.Vector3, pressure = 0) {
    // Patrol around the player's general area; under pressure, tighter circles.
    this.targetAge = 0;
    const r = THREE.MathUtils.lerp(26, 7, pressure) * (0.5 + Math.random());
    const a = Math.random() * Math.PI * 2;
    this.target.set(player.x + Math.cos(a) * r, 0, player.z + Math.sin(a) * r);
  }
}

export function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class RangerManager {
  rangers: Ranger[] = [];
  private spawnTimer = 3;
  private tipTimer = 0;

  constructor(private scene: THREE.Object3D) {}

  reset() {
    for (const r of this.rangers) r.dispose();
    this.rangers = [];
    this.spawnTimer = 4;
    this.tipTimer = 0;
  }

  /** Try to find a free spot on a ring around the player. */
  spawn(player: THREE.Vector3, world: World, d: Difficulty) {
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = d.spawnMin + Math.random() * (d.spawnMax - d.spawnMin);
      const p = new THREE.Vector3(player.x + Math.cos(a) * r, 0, player.z + Math.sin(a) * r);
      let free = true;
      world.forEachCollider(p.x, p.z, 2, (cx, cz, cr) => {
        if (Math.hypot(cx - p.x, cz - p.z) < cr + 0.6) free = false;
      });
      if (!free) continue;
      const ranger = new Ranger(this.scene, p.x, p.z);
      ranger.facing = Math.atan2(player.x - p.x, player.z - p.z);
      ranger.pickPatrolTarget(player, d.pressure);
      this.rangers.push(ranger);
      return ranger;
    }
    return null;
  }

  /** Alerts rangers within `radius` of a noise. */
  noise(x: number, z: number, radius: number) {
    for (const r of this.rangers) {
      const d = Math.hypot(r.pos.x - x, r.pos.z - z);
      if (d < radius) r.hear(x, z, 1 - d / radius);
    }
  }

  /** A ranger who spots you radios everyone in range with your position. */
  private radio(from: Ranger, player: THREE.Vector3, d: Difficulty) {
    for (const r of this.rangers) {
      if (r === from || r.busy) continue;
      if (r.pos.distanceTo(from.pos) < d.radioRange) r.dispatch(player.x, player.z, 3);
    }
  }

  /**
   * @param onTip called when an anonymous tip-off sends rangers to your area
   * @returns true if the player got caught this frame
   */
  update(
    dt: number,
    player: THREE.Vector3,
    playerVel: THREE.Vector3,
    hidden: TreeRec | null,
    noisy: boolean,
    world: World,
    d: Difficulty,
    onSpotted: (r: Ranger) => void,
    onTip: () => void,
  ): boolean {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = d.spawnEvery;
      if (this.rangers.length < d.maxRangers) this.spawn(player, world, d);
    }

    // Score-driven tip-offs: the richer you get, the more often someone reports you.
    if (Number.isFinite(d.tipEvery)) {
      this.tipTimer += dt;
      if (this.tipTimer >= d.tipEvery) {
        this.tipTimer = 0;
        const free = this.rangers.filter((r) => !r.busy).sort((a, b) => a.pos.distanceTo(player) - b.pos.distanceTo(player));
        const sent = free.slice(0, d.tipRangers);
        for (const r of sent) r.dispatch(player.x, player.z, d.tipError);
        if (sent.length) onTip();
      }
    }

    const spotted = (r: Ranger) => {
      this.radio(r, player, d);
      onSpotted(r);
    };

    // Spread chasers evenly around the player so they close in from all sides.
    const chasers = this.rangers.filter((r) => r.state === 'chase');
    chasers.forEach((r, i) => {
      const base = Math.atan2(r.pos.z - player.z, r.pos.x - player.x);
      r.flank = chasers.length > 1 ? base + ((i / chasers.length) * 2 - 1) * 1.2 : base;
    });

    let caught = false;
    for (let i = this.rangers.length - 1; i >= 0; i--) {
      const r = this.rangers[i];
      const sees = r.canSee(player, hidden, noisy, world, d);
      const dist = r.update(dt, player, playerVel, sees, world, d, spotted);
      if (dist < d.catchRadius && r.state !== 'stunned') caught = true;
      // Rangers that drift far away while not chasing are recycled.
      if (dist > 90 && r.state !== 'chase') {
        r.dispose();
        this.rangers.splice(i, 1);
      }
    }
    return caught;
  }

  get chasing(): number {
    return this.rangers.filter((r) => r.state === 'chase').length;
  }

  get alerted(): number {
    return this.rangers.filter((r) => r.state === 'investigate' || r.state === 'search' || r.suspicion > 0.2).length;
  }
}
