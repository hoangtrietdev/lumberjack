// Tiny external store that the engine writes and React reads (useSyncExternalStore).
import { useSyncExternalStore } from 'react';
import type { DictKey } from '../../i18n';

export type Phase = 'loading' | 'menu' | 'playing' | 'paused' | 'over' | 'error';

export interface RunResult {
  score: number;
  wood: number;
  felled: number;
  time: number;
  bestChain: number;
  rare: number;
  stunned: number;
  isNewBest: boolean;
}

export interface HudState {
  phase: Phase;
  loading: number;
  loadingKey: DictKey;
  error: string | null;
  score: number;
  time: number;
  felled: number;
  chain: number;
  multiplier: number;
  comboLeft: number;
  heat: number;
  heatLevel: number;
  bounty: number;
  stamina: number;
  hidden: boolean;
  chasing: number;
  alerted: number;
  /** Tree under the axe: `species` indexes TREE_CATALOG. */
  target: { species: number; hp: number; maxHp: number; points: number } | null;
  toast: { id: number; text: string; tone: 'info' | 'good' | 'bad' } | null;
  result: RunResult | null;
  best: number;
  muted: boolean;
  touch: boolean;
  locked: boolean;
}

const initial: HudState = {
  phase: 'loading',
  loading: 0,
  loadingKey: 'loading.boot',
  error: null,
  score: 0,
  time: 0,
  felled: 0,
  chain: 0,
  multiplier: 1,
  comboLeft: 0,
  heat: 0,
  heatLevel: 0,
  bounty: 0,
  stamina: 100,
  hidden: false,
  chasing: 0,
  alerted: 0,
  target: null,
  toast: null,
  result: null,
  best: 0,
  muted: false,
  touch: false,
  locked: false,
};

let state: HudState = initial;
const listeners = new Set<() => void>();

export const hud = {
  get: () => state,
  set(patch: Partial<HudState>) {
    let changed = false;
    for (const k in patch) {
      if ((patch as Record<string, unknown>)[k] !== (state as unknown as Record<string, unknown>)[k]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  reset() {
    state = initial;
  },
};

let toastId = 0;
export function toast(text: string, tone: 'info' | 'good' | 'bad' = 'info') {
  const id = ++toastId;
  hud.set({ toast: { id, text, tone } });
  setTimeout(() => {
    if (state.toast?.id === id) hud.set({ toast: null });
  }, 2800);
}

export function useHud<T>(select: (s: HudState) => T): T {
  return useSyncExternalStore(
    hud.subscribe,
    () => select(state),
    () => select(initial),
  );
}

// ------------------------------------------------------------ persistence --

const KEY_BEST = 'chatchay.best.v1';
const KEY_NAME = 'chatchay.name';
const KEY_TUTORIAL = 'chatchay.tutorial';
const KEY_MUTED = 'chatchay.muted';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* storage unavailable */
  }
}

export const saved = {
  best(): number {
    return Number(read(KEY_BEST)) || 0;
  },
  setBest(n: number) {
    write(KEY_BEST, String(n));
  },
  name(): string {
    return read(KEY_NAME) ?? '';
  },
  setName(n: string) {
    write(KEY_NAME, n);
  },
  tutorialSeen(): boolean {
    return read(KEY_TUTORIAL) === '1';
  },
  setTutorialSeen() {
    write(KEY_TUTORIAL, '1');
  },
  muted(): boolean {
    return read(KEY_MUTED) === '1';
  },
  setMuted(m: boolean) {
    write(KEY_MUTED, m ? '1' : '0');
  },
};
