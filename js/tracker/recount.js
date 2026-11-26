/**
 * Season stats follow the games, so a change that affects a final game (or moves a game in or
 * out of final) marks its season dirty. The recount itself waits until the change has been
 * answered, because it reads the games from the server.
 *
 * The seasons are marked at once, so the mark is persisted. Draining happens once, after the
 * write has settled either way: a drain before that could finish before the write is even
 * queued. The mark is repeated at that point because another drain (online, takeover, the
 * redrain timer) may have consumed the first mark while the write was still waiting.
 * @param {{stats: {markDirty: Function, drain: Function}}} ctx
 * @param {string|string[]} season one season, or several when a change moves a game between them
 * @param {Promise<unknown>|unknown} write
 */
export function recountAfter(ctx, season, write) {
  const seasons = [...new Set([season].flat())];
  const markAll = () => seasons.forEach(entry => ctx.stats.markDirty(entry));
  markAll();
  const settled = Promise.resolve(write);
  const again = () => {
    markAll();
    return ctx.stats.drain();
  };
  settled.then(again, again);
  return settled;
}

/**
 * A recount that failed (a read with signal bars but no data) is retried on its own: when a
 * drain result still has failed seasons while this device is active, one timer drains again
 * after `delayMs`. Neither `online` nor the active transition fires in that case.
 * The timer only calls `drain`; the caller passes each drain result to `after` exactly once
 * (its wrapped drain does), so a failing retry schedules the next one.
 * @param {{
 *   drain: () => unknown,
 *   isActive: () => boolean,
 *   hasDirty: () => boolean,
 *   delayMs?: number,
 *   timers?: {setTimeout: Function, clearTimeout: Function},
 * }} options
 * @returns {{after: (result: {done: string[], failed: string[]}) => void, stop: () => void}}
 */
export function createRedrain({
  drain,
  isActive,
  hasDirty,
  delayMs = 60000,
  timers = { setTimeout, clearTimeout },
}) {
  // Called unbound on purpose: a browser's setTimeout throws when `this` is not the window.
  const { setTimeout: setTimer, clearTimeout: clearTimer } = timers;
  let timer = null;

  function fire() {
    timer = null;
    if (!isActive() || !hasDirty()) return;
    try {
      Promise.resolve(drain()).catch(() => {});
    } catch {
      // A drain that throws is retried by the next result or the next wake-up.
    }
  }

  return {
    after(result) {
      if (timer !== null || !isActive() || !(result?.failed?.length > 0)) return;
      timer = setTimer(fire, delayMs);
    },
    stop() {
      if (timer !== null) { clearTimer(timer); timer = null; }
    },
  };
}
