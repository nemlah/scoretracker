import { goalieStats } from '../goalies.js';
import { isTracked, replaySituations, SITUATION_TYPES } from '../situations.js';
import { EVENT_TYPES, isDuplicateTap, lastEvent, makeEvent, playerLines } from '../model.js';

/**
 * Every tap goes through here: journal first, then the write. The write is never awaited, so
 * the tap feels instant offline; a rejection reaches onError instead.
 * @param {Object} deps
 * @param {{addEvent: Function, removeEvent: Function, replaceEvent: Function}} deps.repo
 * @param {{record: Function, failed: Function, markRetried: Function, discard: Function}} deps.journal
 * @param {() => (import('../model.js').Game|null)} deps.getGame
 * @param {() => boolean} deps.isActive
 * @param {readonly string[]} [deps.eventTypes] the event types the journal accepts
 * @param {(err: unknown) => void} deps.onError
 */
export function createTapper({
  repo, journal, getGame, isActive, onError,
  now = Date.now,
  eventTypes = EVENT_TYPES,
  vibrate = ms => globalThis.navigator?.vibrate?.(ms),
}) {
  // Duplicate protection is per device: the last tap this tapper accepted, not any event in the game.
  let lastTap = null;

  // Resolves once the write has settled; a failure goes to onError and never rejects.
  function send(write, ...args) {
    try {
      return Promise.resolve(write(...args)).catch(onError);
    } catch (err) {
      onError(err);
      return Promise.resolve();
    }
  }

  const liveGame = () => {
    const game = getGame();
    return isActive() && game?.status === 'live' ? game : null;
  };

  function tap(type, playerId = null) {
    const game = liveGame();
    if (game === null) return null;
    if (SITUATION_TYPES.includes(type)) {
      if (!isTracked(game) || ![1, 2, 3, 4].includes(game.period)) return null;
      const { open } = replaySituations(game);
      if (type === 'manUp' ? open !== null
        : open?.kind !== (type === 'manUpEnd' ? 'manUp' : 'manDown')) return null;
    }
    const isGoalieTap = ['save', 'penSave', 'gkIn'].includes(type);
    if (isGoalieTap) {
      // A cached older model.js does not know these types; the journal would drop everything on its next load.
      if (!eventTypes.includes(type)) return null;
      if (!game.lineup.some(player => player.playerId === playerId && player.goalie === true)) return null;
      if (type === 'save' && game.period === 'SO') return null;
      if (type === 'gkIn' && goalieStats({ ...game, events: game.events ?? [] })?.inGoal === playerId) return null;
    }
    if (type === 'pen' && playerId === null) return null;
    if (type === 'goal' || type === 'excl' || type === 'pen' || isGoalieTap) {
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

  // Retry the latest intent with one write per event: arrayUnion compares whole objects, not ids.
  // Resolve against `current`, which may be another game's snapshot or hold another event version.
  function retryFailed(gameId, current = getGame()) {
    if (!isActive()) return;
    const known = current?.id === gameId ? (current.events ?? []) : null;
    const sent = [];
    const groups = new Map();
    for (const entry of journal.failed(gameId)) {
      const id = entry.event.id;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(entry);
    }
    for (const [id, entries] of groups) {
      const last = entries.at(-1);
      const serverVersion = known?.find(event => event.id === id);
      if (last.op === 'remove' && known && !serverVersion) {
        // Already gone: nothing to remove, so nothing is left to retry.
        for (const entry of entries) journal.discard(entry.id);
        continue;
      }
      for (const entry of entries) journal.markRetried(entry.id);
      if (last.op === 'remove') {
        sent.push(send(repo.removeEvent, gameId, serverVersion ?? last.event));
      } else if (serverVersion) {
        sent.push(send(repo.replaceEvent, gameId, serverVersion, last.event));
      } else {
        sent.push(send(repo.addEvent, gameId, last.event));
      }
    }
    return Promise.all(sent);
  }

  function discardFailed(gameId) {
    for (const entry of journal.failed(gameId)) journal.discard(entry.id);
  }

  return { tap, undo, retryFailed, discardFailed };
}
