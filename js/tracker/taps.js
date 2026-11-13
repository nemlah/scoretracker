import { isDuplicateTap, lastEvent, makeEvent, playerLines } from '../model.js';

/**
 * Every tap goes through here: journal first, then the write. The write is never awaited, so
 * the tap feels instant offline; a rejection reaches onError instead.
 * @param {Object} deps
 * @param {{addEvent: Function, removeEvent: Function, replaceEvent: Function}} deps.repo
 * @param {{record: Function, failed: Function, markRetried: Function, discard: Function}} deps.journal
 * @param {() => (import('../model.js').Game|null)} deps.getGame
 * @param {() => boolean} deps.isActive
 * @param {(err: unknown) => void} deps.onError
 */
export function createTapper({
  repo, journal, getGame, isActive, onError,
  now = Date.now,
  vibrate = ms => globalThis.navigator?.vibrate?.(ms),
}) {
  // Duplicate protection is per device: the last tap this tapper accepted, not any event in the game.
  let lastTap = null;

  function send(write, ...args) {
    try {
      Promise.resolve(write(...args)).catch(onError);
    } catch (err) {
      onError(err);
    }
  }

  const liveGame = () => {
    const game = getGame();
    return isActive() && game?.status === 'live' ? game : null;
  };

  function tap(type, playerId = null) {
    const game = liveGame();
    if (game === null) return null;
    if (type === 'goal' || type === 'excl') {
      if (playerId !== null) {
        const line = playerLines(game.lineup, game.events ?? []).find(entry => entry.playerId === playerId);
        if (!line || line.out) return null;
      }
    } else {
      playerId = null;
    }
    const at = now();
    if (isDuplicateTap(lastTap, type, playerId, at)) return null;
    const event = makeEvent(type, game.period, playerId, at);
    lastTap = event;
    journal.record(game.id, 'add', event);
    send(repo.addEvent, game.id, event);
    vibrate(30);
    return event;
  }

  function undo() {
    const game = liveGame();
    if (game === null) return null;
    // A tap that reaches here is never ignored. The view disables the button briefly after an
    // Undo, so an accidental double tap is visibly refused rather than silently dropped.
    const event = lastEvent(game.events ?? []);
    if (event === null) return null;
    lastTap = null;
    journal.record(game.id, 'remove', event);
    send(repo.removeEvent, game.id, event);
    return event;
  }

  // `current` is the game's latest snapshot when it is not the one this tapper watches.
  function retryFailed(gameId, current = getGame()) {
    if (!isActive()) return;
    for (const entry of journal.failed(gameId)) {
      journal.markRetried(entry.id);
      if (entry.op === 'add') {
        send(repo.addEvent, gameId, entry.event);
      } else if (entry.op === 'remove') {
        send(repo.removeEvent, gameId, entry.event);
      } else {
        const previous = current?.id === gameId ? (current.events ?? []).find(event => event.id === entry.event.id) : undefined;
        if (previous) send(repo.replaceEvent, gameId, previous, entry.event);
        else send(repo.addEvent, gameId, entry.event);
      }
    }
  }

  function discardFailed(gameId) {
    for (const entry of journal.failed(gameId)) journal.discard(entry.id);
  }

  return { tap, undo, retryFailed, discardFailed };
}
