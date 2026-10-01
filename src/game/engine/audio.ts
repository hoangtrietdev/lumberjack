/** All sounds are synthesised with WebAudio, so the game ships no audio files. */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private birdTimer = 0;
  muted = false;

  /** Must be called from a user gesture (e.g. the Play button). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.startAmbience();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  private startAmbience() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    // Slow gusts
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(lp).connect(g).connect(this.master!);
    src.start();
    lfo.start();
    this.ambience = g;
  }

  update(dt: number) {
    if (!this.ctx) return;
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 2.5 + Math.random() * 6;
      this.bird();
    }
  }

  private noise(dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, when = 0, attack = 0.003) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0, slideTo?: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  chop(big = false) {
    this.noise(0.12, 'bandpass', 1400 + Math.random() * 400, 1.2, 0.9);
    this.tone(big ? 95 : 130, 0.16, 'sine', 0.7, 0, 60);
    this.noise(0.05, 'highpass', 4000, 0.7, 0.25);
  }

  creak() {
    this.tone(70, 1.2, 'sawtooth', 0.12, 0, 45);
    this.tone(110, 0.9, 'square', 0.04, 0.2, 60);
  }

  crash() {
    this.noise(1.6, 'lowpass', 900, 0.6, 1.0, 0, 0.01);
    this.tone(55, 0.7, 'sine', 0.9, 0, 30);
    this.noise(0.9, 'bandpass', 2500, 0.8, 0.25, 0.05);
  }

  whistle() {
    this.tone(2900, 0.18, 'sine', 0.35, 0, 3100);
    this.tone(2900, 0.32, 'sine', 0.35, 0.24, 3150);
  }

  bird() {
    const base = 2200 + Math.random() * 1800;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this.tone(base, 0.09, 'sine', 0.05, i * 0.13, base * 1.35);
  }

  combo(level: number) {
    const f = 520 * Math.pow(1.12, level);
    this.tone(f, 0.15, 'triangle', 0.25);
    this.tone(f * 1.5, 0.2, 'triangle', 0.2, 0.08);
  }

  stun() {
    this.tone(880, 0.12, 'square', 0.12);
    this.tone(660, 0.12, 'square', 0.12, 0.1);
    this.tone(990, 0.2, 'square', 0.12, 0.2);
  }

  caught() {
    this.whistle();
    [440, 392, 349, 262].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.3, 0.45 + i * 0.22));
  }

  dispose() {
    this.ctx?.close();
    this.ctx = null;
    void this.ambience;
  }
}
