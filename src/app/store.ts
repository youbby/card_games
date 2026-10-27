import { create } from 'zustand';
import { DEFAULT_SETTINGS, type Settings } from '../data/types';
import type { GameId } from '../games/catalog';

export type CreateReason = 'first' | 'allBankrupt' | 'new';

export type Screen =
  | { name: 'boot' }
  | { name: 'characterSelect' }
  | { name: 'characterCreate'; reason: CreateReason }
  | { name: 'lobby' }
  | { name: 'setup'; gameId?: GameId }
  | { name: 'table'; sessionId: string }
  | { name: 'house'; roomId: string }
  | { name: 'stats'; characterId: string }
  | { name: 'cpus' }
  | { name: 'settings' };

interface AppState {
  stack: Screen[];
  playerId: string | null;
  settings: Settings;
  toast: string | null;
  push: (screen: Screen) => void;
  replace: (screen: Screen) => void;
  back: () => void;
  reset: (stack: Screen[]) => void;
  setPlayer: (id: string | null) => void;
  setSettings: (settings: Settings) => void;
  showToast: (message: string) => void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useApp = create<AppState>((set) => ({
  stack: [{ name: 'boot' }],
  playerId: null,
  settings: DEFAULT_SETTINGS,
  toast: null,
  push: (screen) => set((s) => ({ stack: [...s.stack, screen] })),
  replace: (screen) => set((s) => ({ stack: [...s.stack.slice(0, -1), screen] })),
  back: () => set((s) => (s.stack.length > 1 ? { stack: s.stack.slice(0, -1) } : s)),
  reset: (stack) => set({ stack }),
  setPlayer: (playerId) => set({ playerId }),
  setSettings: (settings) => set({ settings }),
  showToast: (toast) => {
    clearTimeout(toastTimer);
    set({ toast });
    toastTimer = setTimeout(() => set({ toast: null }), 2600);
  },
}));

export const currentScreen = (s: AppState) => s.stack[s.stack.length - 1];
