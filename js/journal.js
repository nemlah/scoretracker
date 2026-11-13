/** @typedef {import('./model.js').Event} Event */
/**
 * @typedef {Object} Entry
 * @property {string} id
 * @property {string} gameId
 * @property {'add'|'remove'|'replace'} op
 * @property {Event} event
 * @property {'pending'|'failed'} status
 * @property {boolean} [gone] the game no longer exists on the server
 */

function validEntry(entry) {
  const event = entry?.event;
  return typeof entry?.id === 'string' && typeof entry.gameId === 'string'
    && ['add', 'remove', 'replace'].includes(entry.op)
    && ['pending', 'failed'].includes(entry.status)
    && typeof event?.id === 'string'
    && ['goal', 'excl', 'oppGoal'].includes(event.type)
    && [1, 2, 3, 4, 'SO'].includes(event.period)
    && Number.isFinite(event.ts)
    && (!Object.hasOwn(event, 'playerId') || typeof event.playerId === 'string');
}

const copyEntry = entry => ({ ...entry, event: { ...entry.event } });

/**
 * Local safety net for event writes. Reconcile only against a server snapshot
 * with fromCache === false and hasPendingWrites === false.
 *
 * Several tabs of one browser share the storage, so every call re-reads it and every change is
 * applied to what was just read: no instance ever writes back a stale copy. When storage is
 * unavailable the journal keeps working from memory.
 */
export function createJournal(storage, key = 'wp-journal') {
  /** @type {Entry[]} */
  let entries = [];
  let storageAvailable = true;

  function load() {
    if (!storageAvailable) return;
    let raw;
    try {
      raw = storage.getItem(key);
    } catch {
      storageAvailable = false;
      return;
    }
    entries = [];
    if (raw == null) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every(validEntry)) entries = parsed;
    } catch {
      // Corrupt data starts empty; a later write can repair storage.
    }
  }

  function persist() {
    if (!storageAvailable) return;
    try {
      storage.setItem(key, JSON.stringify(entries));
    } catch {
      // Keep the complete current journal in memory for this instance.
      storageAvailable = false;
    }
  }

  return {
    record(gameId, op, event) {
      load();
      // A later correction supersedes our own earlier ones for the same event. Otherwise, once
      // all the writes have settled, the earlier entry would look unsaved (it no longer matches
      // the server) and a retry would undo the newer correction. A remove cancels the earlier
      // add and replaces of that event; a replace cancels the earlier replaces.
      const superseded = op === 'remove' ? ['add', 'replace'] : op === 'replace' ? ['replace'] : [];
      if (superseded.length > 0) {
        entries = entries.filter(entry => !(entry.gameId === gameId && superseded.includes(entry.op)
          && entry.event.id === event.id));
      }
      const entry = {
        id: globalThis.crypto.randomUUID(), gameId, op,
        event: { ...event }, status: 'pending',
      };
      entries.push(entry);
      persist();
      return copyEntry(entry);
    },
    reconcile(gameId, serverEvents) {
      load();
      let confirmed = 0;
      const failed = [];
      entries = entries.filter(entry => {
        if (entry.gameId !== gameId || entry.status !== 'pending') return true;
        const serverEvent = serverEvents.find(event => event.id === entry.event.id);
        const matches = entry.op === 'add' ? serverEvent !== undefined
          : entry.op === 'remove' ? serverEvent === undefined
            : serverEvent !== undefined && serverEvent.playerId === entry.event.playerId;
        if (matches) {
          confirmed += 1;
          return false;
        }
        entry.status = 'failed';
        failed.push(copyEntry(entry));
        return true;
      });
      persist();
      return { confirmed, failed };
    },
    /** The game does not exist on the server: its entries can only be discarded. */
    markGone(gameId) {
      load();
      const gone = [];
      for (const entry of entries) {
        if (entry.gameId !== gameId) continue;
        entry.status = 'failed';
        entry.gone = true;
        gone.push(copyEntry(entry));
      }
      if (gone.length > 0) persist();
      return gone;
    },
    failed(gameId) {
      load();
      return entries.filter(entry => entry.status === 'failed'
        && (gameId === undefined || entry.gameId === gameId)).map(copyEntry);
    },
    /** Games with entries that are still waiting for the server's verdict. */
    pendingGameIds() {
      load();
      return [...new Set(entries.filter(entry => entry.status === 'pending').map(entry => entry.gameId))];
    },
    markRetried(entryId) {
      load();
      const entry = entries.find(entry => entry.id === entryId);
      if (entry) entry.status = 'pending';
      persist();
    },
    discard(entryId) {
      load();
      entries = entries.filter(entry => entry.id !== entryId);
      persist();
    },
  };
}
