/** Node timers have .unref()/.ref(); workerd's return plain numbers. Libraries inside Baileys call unref(). */
type TimerFn = (...args: any[]) => number;

/** Intervals currently running. Baileys starts several per socket and never stops them, so the object never goes idle. */
export const liveIntervals = new Set<number>();

const wrap = (name: 'setTimeout' | 'setInterval') => {
  const orig = (globalThis[name] as unknown as TimerFn).bind(globalThis);
  (globalThis as any)[name] = (...args: any[]) => {
    const id = orig(...args);
    if (name === 'setInterval') liveIntervals.add(id);
    const t: any = new Number(id);
    t.unref = () => t;
    t.ref = () => t;
    t.hasRef = () => true;
    return t;
  };
};
const wrapClear = (name: 'clearTimeout' | 'clearInterval') => {
  const orig = (globalThis[name] as unknown as (id?: number) => void).bind(globalThis);
  (globalThis as any)[name] = (t?: unknown) => {
    if (t != null) liveIntervals.delete(Number(t));
    orig(t == null ? undefined : Number(t));
  };
};
wrap('setTimeout');
wrap('setInterval');
wrapClear('clearTimeout');
wrapClear('clearInterval');
