/**
 * Seasons whose stats document needs recomputing. The set is persisted, so a recount that
 * could not run (offline, page closed) is retried on the next drain.
 * @param {{getItem: Function, setItem: Function}} storage
 * @param {(season: string) => Promise<void>} recompute
 */
export function createStatsQueue(storage, recompute, key = 'wp-stats-dirty') {
  /** @type {string[]} */
  let seasons = [];
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
      if (Array.isArray(parsed) && parsed.every(season => typeof season === 'string')) {
        seasons = [...new Set(parsed)];
      }
    } catch {
      // Corrupt data starts empty; the next change repairs storage.
    }
  }

  // Bumped on every markDirty, so a recount that was already reading when the season changed
  // again does not clear the mark.
  const generation = new Map();
  let running = null;

  function persist() {
    if (!storageAvailable) return;
    try {
      storage.setItem(key, JSON.stringify(seasons));
    } catch {
      storageAvailable = false;
    }
  }

  function markDirty(season) {
    generation.set(season, (generation.get(season) ?? 0) + 1);
    if (!seasons.includes(season)) seasons.push(season);
    persist();
  }

  async function run() {
    const done = [];
    const failed = [];
    const attempted = new Map(); // season -> generation it was last attempted at
    const next = () => seasons.find(season => attempted.get(season) !== (generation.get(season) ?? 0));
    for (let season = next(); season !== undefined; season = next()) {
      const started = generation.get(season) ?? 0;
      attempted.set(season, started);
      try {
        await recompute(season);
      } catch {
        if (!failed.includes(season)) failed.push(season);
        continue;
      }
      const index = failed.indexOf(season);
      if (index >= 0) failed.splice(index, 1);
      if ((generation.get(season) ?? 0) === started) {
        seasons = seasons.filter(entry => entry !== season);
        persist();
      }
      if (!done.includes(season)) done.push(season);
    }
    return { done, failed };
  }

  function drain() {
    if (running === null) {
      running = run().finally(() => { running = null; });
    }
    return running;
  }

  return { markDirty, drain, dirty: () => [...seasons] };
}
