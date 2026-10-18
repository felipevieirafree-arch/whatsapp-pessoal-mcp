/** Node timers have .unref()/.ref(); workerd's return plain numbers. Libraries inside Baileys call unref(). */
type TimerFn = (...args: any[]) => number;

const wrap = (name: 'setTimeout' | 'setInterval') => {
  const orig = (globalThis[name] as unknown as TimerFn).bind(globalThis);
  (globalThis as any)[name] = (...args: any[]) => {
    const t: any = new Number(orig(...args));
    t.unref = () => t;
    t.ref = () => t;
    t.hasRef = () => true;
    return t;
  };
};
const wrapClear = (name: 'clearTimeout' | 'clearInterval') => {
  const orig = (globalThis[name] as unknown as (id?: number) => void).bind(globalThis);
  (globalThis as any)[name] = (t?: unknown) => orig(t == null ? undefined : Number(t));
};
wrap('setTimeout');
wrap('setInterval');
wrapClear('clearTimeout');
wrapClear('clearInterval');
