import { useSyncExternalStore } from 'react';

export type Strength = 'breeze' | 'gust' | 'gale';
export const STRENGTH_GAIN: Record<Strength, number> = { breeze: 0.62, gust: 1, gale: 1.5 };

export interface AppState {
  loading: boolean;
  error: string | null;
  paused: boolean;
  strength: Strength;
  uiHidden: boolean;
  helpOpen: boolean;
  hint: boolean;
  /** Gusts still blowing. Enables undo. */
  active: number;
  recording: boolean;
  toast: string | null;
  fps: number;
}

const INITIAL: AppState = {
  loading: true,
  error: null,
  paused: false,
  strength: 'gust',
  uiHidden: false,
  helpOpen: false,
  hint: true,
  active: 0,
  recording: false,
  toast: null,
  fps: 0,
};

export class Store {
  private state = INITIAL;
  private readonly listeners = new Set<() => void>();

  get = (): AppState => this.state;

  set(patch: Partial<AppState>): void {
    let changed = false;
    for (const k of Object.keys(patch) as (keyof AppState)[]) {
      if (this.state[k] !== patch[k]) changed = true;
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export function useStore<T>(store: Store, select: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
