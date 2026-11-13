/**
 * Season stats follow the games, so a change that affects a final game (or moves a game in or
 * out of final) marks its season dirty. The recount itself waits until the change has been
 * answered, because it reads the games from the server.
 * @param {{stats: {markDirty: Function, drain: Function}}} ctx
 * @param {string|string[]} season one season, or several when a change moves a game between them
 * @param {Promise<unknown>|unknown} write
 */
export function recountAfter(ctx, season, write) {
  const seasons = [...new Set([season].flat())];
  const markAll = () => seasons.forEach(entry => ctx.stats.markDirty(entry));
  // Drained at once, even if the write is refused: recomputeSeason waits for this client's
  // queued writes before it reads, so it cannot aggregate around them.
  markAll();
  ctx.stats.drain();
  const settled = Promise.resolve(write);
  // Marked again once the write is through, in case a recount already ran while it was pending.
  settled.then(() => {
    markAll();
    return ctx.stats.drain();
  }, () => {});
  return settled;
}
