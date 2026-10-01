import * as THREE from 'three';
import { PLAYER } from '../logic/rules';
import { buildLumberjack, type Rig } from './characters';
import type { InputState } from './input';
import type { TreeRec, World } from './world';

export interface ChopEvent {
  tree: TreeRec;
  felled: boolean;
}

export class Player {
  readonly rig: Rig;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  facing = 0; // yaw, 0 = +Z
  stamina = PLAYER.staminaMax;
  sprinting = false;
  chopT = -1; // chop cycle progress, -1 = idle
  private chopHit = false;
  target: TreeRec | null = null;
  hiddenIn: TreeRec | null = null;
  private exhausted = false;
  private targetRing: THREE.Mesh;

  constructor(scene: THREE.Object3D) {
    this.rig = buildLumberjack();
    scene.add(this.rig.root);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 40),
      new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.7, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    ring.visible = false;
    ring.renderOrder = 2;
    this.targetRing = ring;
    scene.add(ring);
  }

  reset() {
    this.position.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.facing = 0;
    this.stamina = PLAYER.staminaMax;
    this.chopT = -1;
    this.target = null;
    this.hiddenIn = null;
    this.exhausted = false;
    this.rig.root.visible = true;
  }

  /**
   * @param camYaw camera yaw so movement is camera-relative
   * @returns chop event when an axe swing lands this frame
   */
  update(dt: number, input: InputState, camYaw: number, world: World): ChopEvent | null {
    let event: ChopEvent | null = null;

    // --- movement intent (camera relative)
    const ix = input.moveX;
    const iz = input.moveY;
    const mag = Math.min(1, Math.hypot(ix, iz));
    const wantsMove = mag > 0.12;

    // --- chopping
    this.target = world.findChopTarget(this.position, this.facing, PLAYER.reach);
    if (input.chop && this.target && (this.chopT >= 0 || !wantsMove || input.chopPressed)) {
      if (this.chopT < 0) {
        this.chopT = 0;
        this.chopHit = false;
      }
    }
    if (this.chopT >= 0) {
      const t = this.target;
      if (t) {
        const want = Math.atan2(t.x - this.position.x, t.z - this.position.z);
        this.facing = lerpAngle(this.facing, want, Math.min(1, dt * 14));
      }
      this.chopT += dt / PLAYER.chopInterval;
      if (!this.chopHit && this.chopT >= 0.68) {
        this.chopHit = true;
        if (t) event = { tree: t, felled: world.hit(t, this.position) };
      }
      if (this.chopT >= 1) {
        // Keep swinging while the button is held and a tree is in reach.
        this.chopT = input.chop && this.target && !event?.felled ? 0 : -1;
        this.chopHit = false;
      }
    }

    const chopping = this.chopT >= 0;

    // --- sprint / stamina
    if (this.stamina <= 0) this.exhausted = true;
    if (this.exhausted && this.stamina > 30) this.exhausted = false;
    this.sprinting = input.sprint && wantsMove && !chopping && !this.exhausted;
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - PLAYER.sprintDrain * dt);
    else this.stamina = Math.min(PLAYER.staminaMax, this.stamina + PLAYER.staminaRegen * dt * (wantsMove ? 0.7 : 1.3));

    const speed = chopping ? 0 : (this.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed) * mag;
    const sin = Math.sin(camYaw);
    const cos = Math.cos(camYaw);
    // Input: moveY > 0 = forward (away from camera)
    // right vector = forward x up = (-cos, sin)
    const wx = -ix * cos + iz * sin;
    const wz = ix * sin + iz * cos;
    const len = Math.hypot(wx, wz) || 1;
    const tx = wantsMove ? (wx / len) * speed : 0;
    const tz = wantsMove ? (wz / len) * speed : 0;
    const accel = wantsMove ? 14 : 18;
    this.velocity.x += (tx - this.velocity.x) * Math.min(1, accel * dt);
    this.velocity.z += (tz - this.velocity.z) * Math.min(1, accel * dt);
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    world.resolveCollisions(this.position, 0.35);

    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    if (hs > 0.3 && !chopping) {
      this.facing = lerpAngle(this.facing, Math.atan2(this.velocity.x, this.velocity.z), Math.min(1, dt * 12));
    }

    this.hiddenIn = world.bushAt(this.position.x, this.position.z);

    // --- visuals
    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.y = this.facing;
    this.rig.animate(dt, hs, this.chopT);
    // Crouch a little when hiding in a bush.
    const crouch = this.hiddenIn && hs < 2.5 ? 0.82 : 1;
    this.rig.root.scale.y += (crouch - this.rig.root.scale.y) * Math.min(1, dt * 8);

    if (this.target) {
      this.targetRing.visible = true;
      this.targetRing.position.set(this.target.x, 0.03, this.target.z);
      const r = this.target.collR + 0.25;
      this.targetRing.scale.set(r, r, r);
      (this.targetRing.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.3 * Math.sin(performance.now() / 150);
    } else {
      this.targetRing.visible = false;
    }
    return event;
  }

  hideTargetRing() {
    this.targetRing.visible = false;
  }
}

export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
