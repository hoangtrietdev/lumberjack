import { yieldToBrowser } from './yield';
import * as THREE from 'three';
import { TREE_CATALOG, isRare, speciesName } from '../trees/catalog';
import { getLang, t } from '../../i18n';
import {
  addHeat,
  comboTimeLeft,
  coolHeat,
  difficulty,
  fellTree,
  heatLevel,
  bountyTier,
  newScore,
  totalScore,
  type Difficulty,
  type ScoreState,
} from '../logic/rules';
import { hud, saved, toast } from '../ui/store';
import { loadAssets } from './assets';
import { GameAudio } from './audio';
import { Effects } from './effects';
import { Input } from './input';
import { Minimap } from './minimap';
import { Player } from './player';
import { RangerManager, type Ranger } from './rangers';
import { SKY, createLights, createSky } from './sky';
import { TreeLibrary } from './trees';
import { World, type TreeRec } from './world';

type Quality = 'high' | 'low';

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly input: Input;
  readonly audio = new GameAudio();
  private lastFrame = 0;
  private world!: World;
  private lib!: TreeLibrary;
  private player!: Player;
  private rangers!: RangerManager;
  private effects = new Effects();
  private minimap: Minimap | null = null;
  private sky: THREE.Mesh;
  private lights: ReturnType<typeof createLights>;
  private raf = 0;
  private disposed = false;
  private quality: Quality;

  // camera rig
  private camYaw = 0;
  private camPitch = 0.5;
  private camDist = 8.5;
  private camShake = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();

  // run state
  private t = 0;
  private elapsed = 0;
  private heat = 0;
  private score: ScoreState = newScore();
  private stunned = 0;
  private diff: Difficulty = difficulty(0, 0);
  private hudTimer = 0;
  private overTimer = 0;
  private lastTargetKey = '';
  private spottedCooldown = 0;
  private bounty = 0;
  private wasHidden = false;

  // adaptive resolution (idea borrowed from Tidewater's dynamic resolution)
  private frameAvg = 16;
  /** Last frame's CPU timings in ms (handy with `?debug`). */
  perf = { sim: 0, stream: 0, instancing: 0, render: 0 };
  private pixelRatio = 1;
  private maxPixelRatio = 1;
  private resTimer = 0;

  constructor(private container: HTMLElement) {
    const touch = matchMedia('(pointer: coarse)').matches;
    const q = new URLSearchParams(location.search).get('q');
    this.quality = q === 'low' || q === 'high' ? q : touch ? 'low' : 'high';
    this.renderer = new THREE.WebGLRenderer({ antialias: this.quality === 'high', powerPreference: 'high-performance' });
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, this.quality === 'low' ? 1.25 : 1.75);
    this.pixelRatio = this.maxPixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.2, 260);
    this.scene.fog = new THREE.Fog(SKY.fog, 28, 88);
    this.scene.background = SKY.fog.clone();
    this.sky = createSky();
    this.scene.add(this.sky);
    this.lights = createLights(this.scene);
    this.lights.sun.castShadow = this.quality === 'high';
    this.scene.add(this.effects.group);

    this.input = new Input(this.renderer.domElement);
    this.input.onPauseRequest = () => this.pause();
    document.addEventListener('pointerlockchange', this.onLockChange);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);

    const muted = saved.muted();
    this.audio.setMuted(muted);
    hud.set({ touch, muted, best: saved.best() });
  }

  async init() {
    try {
      hud.set({ phase: 'loading', loading: 0, loadingKey: 'loading.assets' });
      const assets = await loadAssets((p) => hud.set({ loading: p * 0.25 }));
      if (this.disposed) return;
      hud.set({ loadingKey: 'loading.trees' });
      this.lib = new TreeLibrary(TREE_CATALOG, assets);
      await this.lib.build((p) => hud.set({ loading: 0.25 + p * 0.65 }));
      if (this.disposed) return;

      hud.set({ loadingKey: 'loading.forest' });
      this.world = new World(TREE_CATALOG, this.lib, assets, this.newSeed());
      this.world.viewRadius = this.quality === 'high' ? 2.6 : 2.1;
      this.world.instancer.maxDistance = this.quality === 'high' ? 90 : 70;
      this.world.instancer.setShadows(this.quality === 'high');
      this.world.instancer.lodScale = this.quality === 'high' ? 1 : 0.65;
      if (this.quality === 'low') this.scene.fog = new THREE.Fog(SKY.fog, 22, 68);
      this.scene.add(this.world.group);
      this.player = new Player(this.scene);
      this.rangers = new RangerManager(this.scene);
      while (!this.world.isSettled(this.player.position)) {
        this.world.update(this.player.position, 4);
        await yieldToBrowser();
      }
      hud.set({ loading: 1 });
      // Compile shaders up front to avoid a hitch on the first frame.
      this.updateCamera(0, true);
      this.world.instancer.update(this.camera, this.world.standing(), this.player.position);
      await this.renderer.compileAsync?.(this.scene, this.camera);
      hud.set({ phase: 'menu' });
      this.lastFrame = performance.now();
      this.loop();
    } catch (e) {
      console.error(e);
      hud.set({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }

  private newSeed() {
    return (Math.random() * 1e9) | 0;
  }

  setMinimapCanvas(c: HTMLCanvasElement | null) {
    this.minimap = c ? new Minimap(c) : null;
  }

  setMuted(m: boolean) {
    this.audio.setMuted(m);
    saved.setMuted(m);
    hud.set({ muted: m });
  }

  /** Starts a new run (call from a click so audio + pointer lock can start). */
  start() {
    if (!this.world) return;
    saved.setTutorialSeen();
    this.audio.unlock();
    this.world.reset(this.newSeed());
    this.player.reset();
    this.rangers.reset();
    this.t = 0;
    this.heat = 0;
    this.score = newScore();
    this.stunned = 0;
    this.bounty = 0;
    this.overTimer = 0;
    this.camYaw = 0;
    this.camPitch = 0.5;
    this.camDist = 8.5;
    this.lastTargetKey = '';
    hud.set({
      phase: 'playing',
      result: null,
      score: 0,
      time: 0,
      felled: 0,
      chain: 0,
      multiplier: 1,
      comboLeft: 0,
      heat: 0,
      heatLevel: 0,
      stamina: 100,
      target: null,
      chasing: 0,
      alerted: 0,
    });
    // Pre-stream the new forest around the spawn point.
    for (let i = 0; i < 40 && !this.world.isSettled(this.player.position); i++) this.world.update(this.player.position, 8);
    this.input.enabled = true;
    this.input.requestLock();
    toast(t('toast.start'), 'info');
  }

  pause() {
    if (hud.get().phase !== 'playing') return;
    this.input.enabled = false;
    this.input.exitLock();
    hud.set({ phase: 'paused' });
  }

  resume() {
    if (hud.get().phase !== 'paused') return;
    this.audio.unlock();
    this.input.enabled = true;
    this.input.requestLock();
    this.lastFrame = performance.now();
    hud.set({ phase: 'playing' });
  }

  toMenu() {
    this.input.enabled = false;
    this.input.exitLock();
    hud.set({ phase: 'menu' });
  }

  private hadLock = false;
  private onLockChange = () => {
    const locked = this.input.locked;
    hud.set({ locked });
    // Esc releases pointer lock without a keydown event: treat it as pause.
    if (locked) this.hadLock = true;
    else if (this.hadLock && hud.get().phase === 'playing') this.pause();
    if (!locked) this.hadLock = false;
  };

  private onVisibility = () => {
    if (document.hidden) this.pause();
  };

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  // ------------------------------------------------------------------ loop --

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const raw = Math.max(0, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const dt = Math.min(0.05, raw);
    this.elapsed += dt;
    const phase = hud.get().phase;

    const t0 = performance.now();
    this.input.poll();
    if (phase === 'playing') this.tick(dt);
    else if (phase === 'over') this.tickOver(dt);
    else if (phase === 'menu') this.tickMenu(dt);

    if (phase !== 'paused') {
      this.lib.setTime(this.elapsed);
      this.world.setGrassTime(this.elapsed);
      this.world.animate(dt);
      this.effects.update(dt);
      this.audio.update(phase === 'playing' ? dt : 0);
    }
    const t1 = performance.now();
    this.world.update(this.player.position, phase === 'playing' ? 1 : 2);
    this.updateCamera(dt, false);
    this.followSun();
    const t2 = performance.now();
    this.world.instancer.update(this.camera, this.world.standing(), this.player.position);
    const t3 = performance.now();
    this.renderer.render(this.scene, this.camera);
    const t4 = performance.now();
    this.perf = { sim: t1 - t0, stream: t2 - t1, instancing: t3 - t2, render: t4 - t3 };
    this.adaptResolution(raw);
  };

  private tickMenu(dt: number) {
    this.camYaw += dt * 0.08;
    this.player.rig.animate(dt, 0);
    this.player.hideTargetRing();
  }

  private tickOver(dt: number) {
    this.overTimer += dt;
    this.camDist += (4.5 - this.camDist) * Math.min(1, dt * 2);
    this.player.rig.animate(dt, 0);
    for (const r of this.rangers.rangers) r.rig.animate(dt, 0);
  }

  private tick(dt: number) {
    this.t += dt;
    const [dx, dy, zoom] = this.input.consumeLook();
    this.camYaw -= dx * 0.0032;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + dy * 0.0022, 0.15, 1.1);
    this.camDist = THREE.MathUtils.clamp(this.camDist + zoom * 0.6, 4, 14);

    const hidden = this.player.hiddenIn;
    this.heat = coolHeat(this.heat, dt, !!hidden && this.rangers.chasing === 0);
    // Rangers react to both how noisy you are (heat) and how much you've looted (score).
    const scoreNow = totalScore(this.score, this.t);
    this.diff = difficulty(this.t, this.heat, scoreNow);
    const tier = bountyTier(scoreNow);
    if (tier > this.bounty) {
      this.bounty = tier;
      toast(t('toast.bounty', { n: tier }), 'bad');
      this.audio.whistle();
    }

    const ev = this.player.update(dt, this.input, this.camYaw, this.world);
    if (ev) this.onChop(ev.tree, ev.felled);

    const noisy = this.player.chopT >= 0;
    const caught = this.rangers.update(
      dt,
      this.player.position,
      this.player.velocity,
      this.player.hiddenIn,
      noisy,
      this.world,
      this.diff,
      this.onSpotted,
      this.onTip,
    );
    this.spottedCooldown -= dt;

    // Being chased keeps the heat up.
    if (this.rangers.chasing > 0) this.heat = addHeat(this.heat, dt * 3);

    if (!this.wasHidden && this.player.hiddenIn) toast(t('toast.hidden'), 'good');
    this.wasHidden = !!this.player.hiddenIn;

    if (caught) {
      this.gameOver();
      return;
    }

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.pushHud();
    }
    this.minimap?.draw(dt, this.player.position.x, this.player.position.z, this.camYaw, this.world, this.rangers.rangers, this.diff.fovDeg, this.diff.sightRange);
  }

  private pushHud() {
    const tgt = this.player.target;
    const key = tgt ? `${tgt.id}:${tgt.hp}` : '';
    const patch: Parameters<typeof hud.set>[0] = {
      score: totalScore(this.score, this.t),
      time: Math.floor(this.t),
      felled: this.score.felled,
      chain: this.score.chain,
      multiplier: comboTimeLeft(this.score, this.t) > 0 ? Math.min(5, 1 + 0.5 * this.score.chain) : 1,
      comboLeft: Math.round(comboTimeLeft(this.score, this.t) * 10) / 10,
      heat: Math.round(this.heat),
      heatLevel: heatLevel(this.heat),
      bounty: this.bounty,
      stamina: Math.round(this.player.stamina),
      hidden: !!this.player.hiddenIn,
      chasing: this.rangers.chasing,
      alerted: this.rangers.alerted,
    };
    if (key !== this.lastTargetKey) {
      this.lastTargetKey = key;
      patch.target = tgt ? { species: tgt.species, hp: tgt.hp, maxHp: tgt.maxHp, points: tgt.data.points } : null;
    }
    hud.set(patch);
  }

  private onTip = () => {
    if (this.spottedCooldown > 0) return;
    this.spottedCooldown = 3;
    toast(t('toast.tip'), 'bad');
  };

  private onSpotted = (r: Ranger) => {
    if (this.spottedCooldown > 0) return;
    this.spottedCooldown = 4;
    this.audio.whistle();
    toast(t('toast.spotted'), 'bad');
    void r;
  };

  private onChop(tree: TreeRec, felled: boolean) {
    const p = this.player.position;
    const dir = new THREE.Vector3(tree.x - p.x, 0, tree.z - p.z).normalize();
    const at = new THREE.Vector3(tree.x - dir.x * tree.collR, 1.0, tree.z - dir.z * tree.collR);
    this.audio.chop(tree.maxHp >= 7);
    this.effects.chop(at, dir);
    if (Math.random() < 0.6) this.effects.leafFall(tree.x, tree.z, tree.data.height * tree.scale, tree.data.canopyRadius * tree.scale, 3);
    this.heat = addHeat(this.heat, 2 + tree.maxHp * 0.3);
    this.makeNoise(tree.x, tree.z, tree.data.noise);

    if (!felled) return;
    const rare = isRare(tree.spec);
    const r = fellTree(this.score, tree.data.points, this.t, rare);
    this.score = r.state;
    this.heat = addHeat(this.heat, 6 + tree.maxHp * 1.2);
    this.audio.creak();
    const label = r.multiplier > 1 ? `+${r.gained} ×${r.multiplier}` : `+${r.gained}`;
    this.effects.popup(label, new THREE.Vector3(tree.x, 2.6, tree.z), rare ? '#ffb000' : '#ffe27a', rare ? 1.3 : 1);
    if (r.multiplier > 1) this.audio.combo(r.state.chain);
    if (rare) toast(t('toast.rare', { name: speciesName(tree.spec, getLang()) }), 'good');
    this.world.fell(tree, p, this.onCrash);
  }

  private onCrash = (tree: TreeRec, dir: THREE.Vector3) => {
    const len = tree.data.height * tree.scale;
    this.audio.crash();
    this.effects.dustBurst(tree.x, tree.z, dir, len);
    this.effects.leafFall(tree.x + dir.x * len * 0.7, tree.z + dir.z * len * 0.7, 2, tree.data.canopyRadius * tree.scale, 14);
    const d = Math.hypot(this.player.position.x - tree.x, this.player.position.z - tree.z);
    this.camShake = Math.max(this.camShake, Math.max(0, 0.35 - d * 0.015));
    this.makeNoise(tree.x + dir.x * len * 0.5, tree.z + dir.z * len * 0.5, tree.data.noise * 1.5);

    // Trees landing on rangers knock them out for a while: lure them in!
    for (const r of this.rangers.rangers) {
      if (r.state === 'stunned') continue;
      const rx = r.pos.x - tree.x;
      const rz = r.pos.z - tree.z;
      const along = rx * dir.x + rz * dir.z;
      const side = Math.abs(rx * dir.z - rz * dir.x);
      const crown = tree.data.canopyRadius * tree.scale;
      if (along > 0.5 && along < len + 0.5 && side < (along > len * 0.6 ? Math.max(1.2, crown * 0.8) : 1.0)) {
        r.stun(7);
        this.stunned++;
        const bonus = 150;
        this.score = { ...this.score, wood: this.score.wood + bonus };
        this.effects.popup(t('popup.knockout', { n: bonus }), new THREE.Vector3(r.pos.x, 2.8, r.pos.z), '#7fffd4', 1.2);
        this.audio.stun();
        toast(t('toast.knockout'), 'good');
      }
    }
  };

  private makeNoise(x: number, z: number, radius: number) {
    this.rangers.noise(x, z, radius);
    this.minimap?.addNoise(x, z, radius);
  }

  private gameOver() {
    this.input.enabled = false;
    this.input.exitLock();
    this.player.hideTargetRing();
    this.audio.caught();
    const score = totalScore(this.score, this.t);
    const best = saved.best();
    const isNewBest = score > best;
    if (isNewBest) saved.setBest(score);
    hud.set({
      phase: 'over',
      best: Math.max(best, score),
      target: null,
      result: {
        score,
        wood: this.score.wood,
        felled: this.score.felled,
        time: Math.floor(this.t),
        bestChain: this.score.bestChain,
        rare: this.score.rare,
        stunned: this.stunned,
        isNewBest,
      },
    });
  }

  // --------------------------------------------------------------- camera --

  private updateCamera(dt: number, snap: boolean) {
    const p = this.player.position;
    const pitch = this.camPitch;
    const dist = hud.get().phase === 'menu' ? 10 : this.camDist;
    const off = new THREE.Vector3(
      -Math.sin(this.camYaw) * Math.cos(pitch) * dist,
      Math.sin(pitch) * dist + 1.6,
      -Math.cos(this.camYaw) * Math.cos(pitch) * dist,
    );
    const wantPos = p.clone().add(off);
    // Keep the camera from dipping below the ground.
    wantPos.y = Math.max(0.6, wantPos.y);
    const wantLook = p.clone().add(new THREE.Vector3(Math.sin(this.camYaw) * 2, 1.5, Math.cos(this.camYaw) * 2));
    const k = snap ? 1 : 1 - Math.exp(-dt * 12);
    this.camPos.lerp(wantPos, k);
    this.camLook.lerp(wantLook, k);
    if (snap) {
      this.camPos.copy(wantPos);
      this.camLook.copy(wantLook);
    }
    this.camera.position.copy(this.camPos);
    if (this.camShake > 0) {
      this.camShake = Math.max(0, this.camShake - dt * 0.8);
      const s = this.camShake;
      this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    }
    this.camera.lookAt(this.camLook);
    this.sky.position.copy(this.camera.position);
  }

  private followSun() {
    const p = this.player.position;
    const sun = this.lights.sun;
    // Snap to shadow texels to avoid shimmering.
    const step = 52 / 2048;
    const x = Math.round(p.x / step) * step;
    const z = Math.round(p.z / step) * step;
    sun.position.set(x + SKY.sunDir.x * 60, SKY.sunDir.y * 60, z + SKY.sunDir.z * 60);
    sun.target.position.set(x, 0, z);
  }

  private adaptResolution(raw: number) {
    this.frameAvg += (raw * 1000 - this.frameAvg) * 0.05;
    this.resTimer += raw;
    if (this.resTimer < 1.5) return;
    this.resTimer = 0;
    let pr = this.pixelRatio;
    if (this.frameAvg > 24 && pr > 0.6) pr = Math.max(0.6, pr - 0.15);
    else if (this.frameAvg < 15 && pr < this.maxPixelRatio) pr = Math.min(this.maxPixelRatio, pr + 0.1);
    if (pr !== this.pixelRatio) {
      this.pixelRatio = pr;
      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.input.dispose();
    this.audio.dispose();
    document.removeEventListener('pointerlockchange', this.onLockChange);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.world?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
