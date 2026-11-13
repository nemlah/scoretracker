import { recountAfter } from './recount.js';

/**
 * Recovery of journalled taps, independent of which game is on screen: games that have pending
 * entries but no open watch are checked against the server once, and retry works for any game.
 * @param {Object} deps
 * @param {{readGameFromServer: (id: string) => Promise<object|null>}} deps.repo
 * @param {{pendingGameIds: Function, markGone: Function, reconcile: Function, failed: Function}} deps.journal
 * @param {{retryFailed: Function, discardFailed: Function}} deps.tapper
 * @param {{markDirty: Function, drain: Function}} deps.stats
 * @param {() => Set<string>} deps.watchedIds games that have an open watch (it settles their entries)
 * @param {(id: string) => (object|null|undefined)} deps.snapshotOf latest snapshot of a watched game
 * @param {() => void} deps.onChange the journal changed; refresh what shows it
 */
export function createRecovery({ repo, journal, tapper, stats, watchedIds, snapshotOf, onChange }) {
  const reading = new Set();

  async function checkGame(gameId) {
    reading.add(gameId);
    try {
      const game = await repo.readGameFromServer(gameId);
      if (game === null) journal.markGone(gameId);
      else journal.reconcile(gameId, game.events ?? []);
    } catch {
      // Offline or unreachable: the entries stay pending and a later check settles them.
    } finally {
      reading.delete(gameId);
    }
  }

  return {
    /** One-off server read for every game with pending entries that no open watch covers. */
    async reconcileOrphans() {
      const watched = watchedIds();
      const orphans = journal.pendingGameIds().filter(id => !watched.has(id) && !reading.has(id));
      if (orphans.length === 0) return;
      await Promise.all(orphans.map(checkGame));
      onChange();
    },

    /** @returns {Promise<'retried'|'gone'|'unavailable'>} */
    async retry(gameId) {
      const entries = journal.failed(gameId);
      if (entries.length === 0) return 'retried';
      if (entries.some(entry => entry.gone)) return 'gone';
      let game = snapshotOf(gameId);
      if (game === undefined) {
        try {
          game = await repo.readGameFromServer(gameId);
        } catch {
          return 'unavailable';
        }
      }
      if (game === null) {
        journal.markGone(gameId);
        onChange();
        return 'gone';
      }
      const writes = tapper.retryFailed(gameId, game);
      onChange();
      // A retried change to a final game moves the season stats; the recount waits for the writes.
      if (game.status === 'final') await recountAfter({ stats }, game.season, writes);
      else await writes;
      return 'retried';
    },

    discard(gameId) {
      tapper.discardFailed(gameId);
      onChange();
    },
  };
}
