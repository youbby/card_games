import { useEffect, useState } from 'react';
import { useApp } from '../app/store';
import type { AnimationSpeed } from '../data/types';

const SPEED_SCALE: Record<AnimationSpeed, number> = { SLOW: 1.4, NORMAL: 1, FAST: 0.6 };

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Multiplier for every animation duration and reveal delay (0 = no motion). */
export function animScale(speed: AnimationSpeed): number {
  return prefersReducedMotion() ? 0 : SPEED_SCALE[speed];
}

/** Publishes the animation speed setting to CSS as `--anim`. */
export function applyAnimSpeed(speed: AnimationSpeed): void {
  document.documentElement.style.setProperty('--anim', String(animScale(speed)));
}

/**
 * Reveals up to `total` items one step at a time whenever `key` changes,
 * starting from `from`. The first render shows everything, so opening a
 * screen never replays an old round. Returns how many items are visible.
 */
export function useStagedReveal(key: string | number | null, total: number, stepMs: number, from = 0): number {
  const scale = animScale(useApp((s) => s.settings.animationSpeed));
  const [state, setState] = useState({ key, shown: total });

  let current = state;
  if (state.key !== key) {
    // Adjusting state while rendering: React re-renders before painting.
    current = { key, shown: scale === 0 ? total : Math.min(from, total) };
    setState(current);
  }

  const done = current.shown >= total;
  useEffect(() => {
    if (done) return;
    const timer = setTimeout(() => setState((s) => (s.key === key ? { key, shown: s.shown + 1 } : s)), stepMs * scale);
    return () => clearTimeout(timer);
  }, [key, current.shown, done, stepMs, scale]);

  return Math.min(current.shown, total);
}
