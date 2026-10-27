import { useCallback, useEffect, useRef, useState } from 'react';
import { pushBackHandler } from '../app/native';

/** Loads async data and reloads when `deps` change. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): { data: T | undefined; reload: () => void } {
  const [data, setData] = useState<T>();
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let alive = true;
    loadRef.current().then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [...deps, tick]);
  return { data, reload: useCallback(() => setTick((t) => t + 1), []) };
}

/** Registers an Android back-button handler while the component is mounted (and `active`). */
export function useBackButton(handler: () => void, active = true): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    return pushBackHandler(() => ref.current());
  }, [active]);
}
