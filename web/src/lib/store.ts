import { useEffect, useState } from "preact/hooks";

/** Minimal observable value; components read it with useStore(). */
export interface Store<T> {
  get(): T;
  set(v: T): void;
  update(f: (v: T) => T): void;
  subscribe(f: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(v) {
      if (Object.is(v, value)) return;
      value = v;
      subs.forEach((f) => f());
    },
    update(f) {
      this.set(f(value));
    },
    subscribe(f) {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}

export function useStore<T>(s: Store<T>): T {
  const [v, setV] = useState(s.get());
  useEffect(() => {
    setV(s.get());
    return s.subscribe(() => setV(s.get()));
  }, [s]);
  return v;
}
