/** @typedef {import('./model.js').Event} Event */
/**
 * @typedef {Object} Entry
 * @property {string} id
 * @property {string} gameId
 * @property {'add'|'remove'|'replace'} op
 * @property {Event} event
 * @property {'pending'|'failed'} status
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
 */
export function createJournal(storage, key = 'wp-journal') {
  /** @type {Entry[]} */
  let entries = [];
  let storageAvailable = true;
  let raw;
  try {
    raw = storage.getItem(key);
  } catch {
    storageAvailable = false;
  }
  if (raw != null) {
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
      // Removing an event cancels our own earlier add of it. Otherwise, once both writes have
      // settled, the add would look unsaved (the event is absent) and a retry would restore it.
      if (op === 'remove') {
        entries = entries.filter(entry => !(entry.gameId === gameId && entry.op === 'add'
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
    failed(gameId) {
      return entries.filter(entry => entry.status === 'failed'
        && (gameId === undefined || entry.gameId === gameId)).map(copyEntry);
    },
    markRetried(entryId) {
      const entry = entries.find(entry => entry.id === entryId);
      if (entry) entry.status = 'pending';
      persist();
    },
    discard(entryId) {
      entries = entries.filter(entry => entry.id !== entryId);
      persist();
    },
  };
}
