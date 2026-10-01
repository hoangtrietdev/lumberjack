import type { Ranger } from './rangers';
import type { World } from './world';

/** Radar-style minimap: player-up, shows trees, bushes, rangers and their view. */
export class Minimap {
  range = 42; // metres from centre to edge
  private noises: { x: number; z: number; r: number; t: number }[] = [];

  constructor(private canvas: HTMLCanvasElement) {}

  addNoise(x: number, z: number, r: number) {
    this.noises.push({ x, z, r, t: 0 });
  }

  draw(dt: number, px: number, pz: number, camYaw: number, world: World, rangers: Ranger[], fov: number, sight: number) {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = c.clientWidth;
    if (!size) return;
    if (c.width !== Math.round(size * dpr)) {
      c.width = c.height = Math.round(size * dpr);
    }
    const g = c.getContext('2d');
    if (!g) return;
    const W = c.width;
    const R = W / 2;
    const k = R / this.range;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath();
    g.arc(R, R, R - 1, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = 'rgba(28, 40, 22, 0.82)';
    g.fillRect(0, 0, W, W);

    // World -> map: rotate so the camera's forward points up.
    const cos = Math.cos(camYaw);
    const sin = Math.sin(camYaw);
    const map = (x: number, z: number): [number, number] => {
      const dx = x - px;
      const dz = z - pz;
      // forward f=(sin,cos) -> up; right=(-cos,sin) -> right
      const fx = dx * sin + dz * cos;
      const rx = -dx * cos + dz * sin;
      return [R + rx * k, R - fx * k];
    };

    world.forEachNearby(px, pz, this.range + 4, (t) => {
      const [x, y] = map(t.x, t.z);
      if (t.kind === 'bush') {
        g.fillStyle = 'rgba(120, 170, 80, 0.55)';
        g.beginPath();
        g.arc(x, y, Math.max(2, t.hideR * k), 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillStyle = t.data.points >= 90 ? 'rgba(232, 196, 90, 0.95)' : 'rgba(170, 205, 130, 0.75)';
        g.beginPath();
        g.arc(x, y, Math.max(1.4 * dpr, (0.4 + t.data.hp * 0.12) * k * 0.6), 0, Math.PI * 2);
        g.fill();
      }
    });

    // Noise ripples
    for (let i = this.noises.length - 1; i >= 0; i--) {
      const n = this.noises[i];
      n.t += dt;
      if (n.t > 1) {
        this.noises.splice(i, 1);
        continue;
      }
      const [x, y] = map(n.x, n.z);
      g.strokeStyle = `rgba(255, 210, 63, ${0.7 * (1 - n.t)})`;
      g.lineWidth = 2 * dpr;
      g.beginPath();
      g.arc(x, y, n.r * k * n.t, 0, Math.PI * 2);
      g.stroke();
    }

    // Rangers + cones
    for (const r of rangers) {
      const [x, y] = map(r.pos.x, r.pos.z);
      const dir = -(r.facing - camYaw) - Math.PI / 2;
      if (r.state !== 'chase' && r.state !== 'stunned') {
        const half = ((fov / 2) * Math.PI) / 180;
        g.fillStyle = r.state === 'patrol' ? 'rgba(255, 224, 138, 0.18)' : 'rgba(255, 159, 67, 0.28)';
        g.beginPath();
        g.moveTo(x, y);
        g.arc(x, y, sight * k, dir - half, dir + half);
        g.closePath();
        g.fill();
      }
      g.fillStyle = r.state === 'chase' ? '#ff3b30' : r.state === 'stunned' ? '#bbbbbb' : r.state === 'patrol' ? '#ffd23f' : '#ff9f43';
      g.strokeStyle = '#1b1b1b';
      g.lineWidth = 1.5 * dpr;
      g.beginPath();
      g.arc(x, y, 4.2 * dpr, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }

    // Player arrow (always pointing up = camera forward)
    g.translate(R, R);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#b3261e';
    g.lineWidth = 2 * dpr;
    g.beginPath();
    g.moveTo(0, -7 * dpr);
    g.lineTo(5 * dpr, 6 * dpr);
    g.lineTo(0, 3 * dpr);
    g.lineTo(-5 * dpr, 6 * dpr);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();

    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2 * dpr;
    g.beginPath();
    g.arc(R, R, R - 1.5, 0, Math.PI * 2);
    g.stroke();
  }
}
