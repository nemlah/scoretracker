/**
 * Season stats follow the games, so a change that affects a final game (or moves a game in or
 * out of final) marks its season dirty. The recount itself waits until the change has been
 * answered, because it reads the games from the server.
 * @param {{stats: {markDirty: Function, drain: Function}}} ctx
 * @param {string} season
 * @param {Promise<unknown>|unknown} write
 */
export function recountAfter(ctx, season, write) {
  // Drained at once, even if the write is refused: recomputeSeason waits for this client's
  // queued writes before it reads, so it cannot aggregate around them.
  ctx.stats.markDirty(season);
  ctx.stats.drain();
  const settled = Promise.resolve(write);
  // Marked again once the write is through, in case a recount already ran while it was pending.
  settled.then(() => {
    ctx.stats.markDirty(season);
    return ctx.stats.drain();
  }, () => {});
  return settled;
}
