// Game rules: scoring, combo, heat (wanted level) and difficulty ramp.
// Pure and framework-free so they can be unit tested with `node --test`.

export const COMBO_WINDOW = 9; // seconds between fells to keep the chain
export const MAX_COMBO = 5;
export const SURVIVAL_POINTS_PER_SEC = 1;

export interface ScoreState {
  wood: number; // points from felled trees (after multiplier)
  felled: number;
  chain: number; // trees in the current combo chain
  bestChain: number;
  lastFellAt: number; // seconds of game time, -Infinity if never
  rare: number; // ancient / precious trees felled
}

export function newScore(): ScoreState {
  return { wood: 0, felled: 0, chain: 0, bestChain: 0, lastFellAt: -Infinity, rare: 0 };
}

export function comboMultiplier(chain: number): number {
  if (chain <= 1) return 1;
  return Math.min(MAX_COMBO, 1 + 0.5 * (chain - 1));
}

/** Registers a felled tree. Returns the new state and the points awarded. */
export function fellTree(s: ScoreState, basePoints: number, now: number, rare = false): { state: ScoreState; gained: number; multiplier: number } {
  const chain = now - s.lastFellAt <= COMBO_WINDOW ? s.chain + 1 : 1;
  const multiplier = comboMultiplier(chain);
  const gained = Math.round(basePoints * multiplier);
  return {
    gained,
    multiplier,
    state: {
      wood: s.wood + gained,
      felled: s.felled + 1,
      chain,
      bestChain: Math.max(s.bestChain, chain),
      lastFellAt: now,
      rare: s.rare + (rare ? 1 : 0),
    },
  };
}

/** Seconds left before the combo chain breaks (0 if none). */
export function comboTimeLeft(s: ScoreState, now: number): number {
  if (s.chain < 1) return 0;
  return Math.max(0, COMBO_WINDOW - (now - s.lastFellAt));
}

export function totalScore(s: ScoreState, survivedSec: number): number {
  return s.wood + Math.floor(survivedSec * SURVIVAL_POINTS_PER_SEC);
}

// ---------------------------------------------------------------- heat ----
// Heat rises with every chop and every felled tree and slowly cools down.
// Its level (0-5) is shown as "wanted stars" and drives ranger pressure.

export const HEAT_MAX = 100;

export function addHeat(heat: number, amount: number): number {
  return Math.min(HEAT_MAX, heat + amount);
}

export function coolHeat(heat: number, dt: number, hidden: boolean): number {
  const rate = hidden ? 4 : 1.1;
  return Math.max(0, heat - rate * dt);
}

export function heatLevel(heat: number): number {
  return Math.min(5, Math.floor(heat / 20));
}

// ---------------------------------------------------------- difficulty ----

export interface Difficulty {
  maxRangers: number;
  walkSpeed: number;
  runSpeed: number;
  sightRange: number;
  fovDeg: number;
  spawnEvery: number; // seconds between spawns while below max
  spawnMin: number; // spawn ring around the player (metres)
  spawnMax: number;
  /** 0..1: how tightly patrols close in on the player. */
  pressure: number;
  /** Seconds a chasing ranger keeps hunting after losing sight. */
  pursuitMemory: number;
  /** Radius in which a ranger who spots you radios the others. */
  radioRange: number;
  /** Seconds between anonymous tip-offs revealing your area (Infinity = none). */
  tipEvery: number;
  /** How precise a tip-off is (metres of error). */
  tipError: number;
  /** How many rangers each tip-off dispatches. */
  tipRangers: number;
  /** Multiplier on how fast rangers recognise you. */
  awareness: number;
  catchRadius: number;
}

/**
 * Score pressure 0..1: the more you have looted, the harder the rangers hunt
 * you, regardless of how noisy you are right now (that is what heat is for).
 */
export function scorePressure(score: number): number {
  return Math.min(1, Math.max(0, score) / 3000);
}

/** Integer "bounty" tier from the score, used for HUD/toasts (0 = none). */
export function bountyTier(score: number): number {
  return Math.min(6, Math.floor(Math.max(0, score) / 500));
}

export function difficulty(t: number, heat: number, score = 0): Difficulty {
  const lvl = heatLevel(heat);
  const sp = scorePressure(score);
  const tier = bountyTier(score);
  return {
    maxRangers: Math.min(16, 1 + Math.floor(t / 30) + lvl + tier),
    walkSpeed: 2.0 + Math.min(1.2, t / 220) + sp * 0.8,
    runSpeed: Math.min(7.9, 5.4 + Math.min(1.6, t / 150) + lvl * 0.08 + sp * 1.1),
    sightRange: 15 + Math.min(8, t / 25) + sp * 6,
    fovDeg: Math.min(160, 100 + Math.min(30, t / 10) + sp * 25),
    spawnEvery: Math.max(2.2, 14 - t / 20 - lvl - sp * 6),
    spawnMin: 38 - sp * 12,
    spawnMax: 56 - sp * 14,
    pressure: Math.min(1, (lvl / 5) * 0.6 + sp * 0.75),
    pursuitMemory: 2.5 + sp * 3 + lvl * 0.3,
    radioRange: 30 + sp * 35 + lvl * 4,
    tipEvery: score < 200 ? Infinity : Math.max(7, 32 - sp * 22 - lvl * 2),
    tipError: 16 - sp * 12,
    tipRangers: 1 + Math.floor(sp * 3) + (lvl >= 3 ? 1 : 0),
    awareness: 1 + sp * 1.2,
    catchRadius: 1.05 + sp * 0.3,
  };
}

export const PLAYER = {
  walkSpeed: 4.2,
  sprintSpeed: 7.4,
  staminaMax: 100,
  sprintDrain: 22, // per second
  staminaRegen: 14,
  chopInterval: 0.42,
  reach: 1.9, // metres from trunk surface
  catchRadius: 1.05,
};
