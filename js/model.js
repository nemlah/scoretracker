import { SITUATION_TYPES, isTracked, situationCounts } from './situations.js';
import { goalieStats } from './goalies.js';

/**
 * @typedef {Object} Event
 * @property {string} id
 * @property {'goal'|'excl'|'oppGoal'|'pen'|'manUp'|'manUpEnd'|'manDownEnd'|'save'|'penSave'|'gkIn'} type
 * @property {1|2|3|4|'SO'} period
 * @property {number} ts
 * @property {string} [playerId]
 *
 * @typedef {Object} LineupEntry
 * @property {string} playerId
 * @property {string} name
 * @property {number} cap
 * @property {boolean} [goalie]
 *
 * @typedef {Object} RosterPlayer
 * @property {string} id
 * @property {string} name
 * @property {number} cap
 * @property {boolean} archived
 * @property {boolean} [goalie]
 *
 * @typedef {Object} Selection
 * @property {string} playerId
 * @property {string} name
 * @property {number|null} cap
 * @property {boolean} selected
 * @property {boolean} goalie
 *
 * @typedef {Object} Game
 * @property {string} id
 * @property {string} opponent
 * @property {string} date
 * @property {string} season
 * @property {'live'|'final'} status
 * @property {1|2|3|4|'SO'} period
 * @property {LineupEntry[]} lineup
 * @property {Event[]} events
 * @property {boolean} [situations]
 * @property {'league'|'cup'|'tournament'|'friendly'} [competition]
 * @property {string} [competitionName]
 * @property {string} [tournamentId]
 * @property {string} [phaseId]
 */

// remove in R4: read by the R2 viewer.js
export const TIMELINE_SAVES = true;

export const EVENT_TYPES = Object.freeze(['goal', 'excl', 'oppGoal', 'pen', ...SITUATION_TYPES, 'save', 'penSave', 'gkIn']);
export const PERIODS = Object.freeze([1, 2, 3, 4, 'SO']);
export const EXCL_LIMIT = 3;
export const DUPLICATE_TAP_MS = 1000;
export const COMPETITIONS = Object.freeze(/** @type {const} */ (['league', 'cup', 'tournament', 'friendly']));
export const MAX_COMPETITION_NAME = 40;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isListId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 64;
}

export function listName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  return name && name.length <= MAX_COMPETITION_NAME ? name : null;
}

export function sameListName(a, b) {
  return typeof a === 'string' && typeof b === 'string'
    && a.trim().toLocaleLowerCase('el') === b.trim().toLocaleLowerCase('el');
}

export function listEntries(map) {
  if (!isPlainObject(map)) return [];
  const entries = [];
  for (const [id, entry] of Object.entries(map)) {
    if (!isListId(id) || !isPlainObject(entry)) continue;
    const name = listName(entry.name);
    if (name !== null) entries.push({ id, name });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name, 'el'));
}

export function competitionOf(source) {
  const { competition, competitionName, tournamentId, phaseId } = source ?? {};
  const fields = { competition: COMPETITIONS.includes(competition) ? competition : 'league' };
  if (fields.competition === 'tournament') {
    const name = listName(competitionName);
    if (name !== null) fields.competitionName = name;
    if (isListId(tournamentId)) fields.tournamentId = tournamentId;
  }
  if (fields.competition === 'league' && isListId(phaseId)) fields.phaseId = phaseId;
  return fields;
}

export function isFriendly(source) {
  return source?.competition === 'friendly';
}

export function competitionFields(competition, name, ids = {}) {
  const fields = competitionOf({ competition, competitionName: name, tournamentId: ids?.tournamentId, phaseId: ids?.phaseId });
  if (fields.competition !== competition) return null;
  if (competition === 'tournament' && !fields.competitionName) return null;
  return fields;
}

/** The "Add new…" choice of a tournament or phase select. */
export const LIST_NEW = '__new';

/**
 * The options of a tournament or phase select: the entries (already sorted), then the chosen id when it is no
 * longer in the list (kind 'removed', so the form can show it until changed), then "Add new…". `withNone` puts
 * the empty "No phase" choice first.
 * @param {{ id: string, name: string }[]} entries
 * @param {string} choice an entry id, '' or LIST_NEW
 * @param {{ withNone?: boolean }} [options]
 * @returns {{ value: string, kind: 'none'|'entry'|'removed'|'new', name?: string }[]}
 */
export function listOptions(entries, choice, { withNone = false } = {}) {
  const options = [];
  if (withNone) options.push({ value: '', kind: 'none' });
  for (const entry of entries) options.push({ value: entry.id, kind: 'entry', name: entry.name });
  if (choice !== '' && choice !== LIST_NEW && !entries.some(entry => entry.id === choice)) {
    options.push({ value: choice, kind: 'removed' });
  }
  options.push({ value: LIST_NEW, kind: 'new' });
  return options;
}

/**
 * What a game form's tournament and phase fields say, resolved against the team's lists. `error` is a strings key
 * (listNameRequired, listNameDuplicate, listEntryRemoved) or null; `payload` is the competition fields plus the
 * entry's id or a `newEntry`. With `nullPhase`, a league game with "No phase" sends phaseId: null (the info form, to
 * clear a stored phase); the new-game form omits it.
 * @param {{ competition: string, tournamentChoice?: string, tournamentNew?: string, phaseChoice?: string, phaseNew?: string,
 *   lists?: { tournaments?: object, phases?: object }, nullPhase?: boolean }} form
 */
export function listChoice({
  competition, tournamentChoice = LIST_NEW, tournamentNew = '', phaseChoice = '', phaseNew = '', lists = {}, nullPhase = false,
}) {
  const pick = (map, choice, typed, list) => {
    const entries = listEntries(map);
    if (choice === LIST_NEW) {
      const name = listName(typed);
      if (name === null) return { error: 'listNameRequired' };
      if (entries.some(entry => sameListName(entry.name, name))) return { error: 'listNameDuplicate' };
      return { name, newEntry: { list, name } };
    }
    const entry = entries.find(candidate => candidate.id === choice);
    return entry ? { name: entry.name, id: entry.id } : { error: 'listEntryRemoved' };
  };
  const withEntry = (fields, picked) => ({ ...fields, ...(picked.newEntry ? { newEntry: picked.newEntry } : {}) });
  if (competition === 'tournament') {
    const picked = pick(lists.tournaments, tournamentChoice, tournamentNew, 'tournaments');
    if (picked.error) return { error: picked.error };
    return { error: null, payload: withEntry(competitionFields('tournament', picked.name, picked.id ? { tournamentId: picked.id } : {}), picked) };
  }
  if (competition === 'league' && phaseChoice !== '') {
    const picked = pick(lists.phases, phaseChoice, phaseNew, 'phases');
    if (picked.error) return { error: picked.error };
    return { error: null, payload: withEntry(competitionFields('league', '', picked.id ? { phaseId: picked.id } : {}), picked) };
  }
  const fields = competitionFields(competition, '');
  if (fields === null) return { error: 'listNameRequired' };
  return { error: null, payload: competition === 'league' && nullPhase ? { ...fields, phaseId: null } : fields };
}

export function nextPeriod(p) {
  const index = PERIODS.indexOf(p);
  return index >= 0 && index < PERIODS.length - 1 ? PERIODS[index + 1] : null;
}

export function prevPeriod(p) {
  const index = PERIODS.indexOf(p);
  return index > 0 ? PERIODS[index - 1] : null;
}

export function makeEvent(type, period, playerId = null, now = Date.now(), id = crypto.randomUUID()) {
  const event = { id, type, period, ts: now };
  if (playerId != null) event.playerId = playerId;
  return event;
}

export function withPlayer(event, playerId) {
  return makeEvent(event.type, event.period, playerId, event.ts, event.id);
}

export function deriveScore(events) {
  const score = { us: 0, them: 0, soUs: 0, soThem: 0 };
  for (const event of events) {
    if (event.type === 'goal') score[event.period === 'SO' ? 'soUs' : 'us'] += 1;
    if (event.type === 'oppGoal') score[event.period === 'SO' ? 'soThem' : 'them'] += 1;
  }
  return score;
}

export function hasShootout(period, events) {
  return period === 'SO' || events.some(event => event.period === 'SO');
}

export function playerLines(lineup, events) {
  return lineup.map(player => {
    const ownEvents = events.filter(event => event.playerId === player.playerId);
    const excl = ownEvents.filter(event => event.type === 'excl').length;
    const pens = ownEvents.filter(event => event.type === 'pen').length;
    return {
      ...player,
      goals: ownEvents.filter(event => event.type === 'goal' && event.period !== 'SO').length,
      soGoals: ownEvents.filter(event => event.type === 'goal' && event.period === 'SO').length,
      excl,
      pens,
      out: excl + pens >= EXCL_LIMIT,
    };
  }).sort((a, b) => a.cap - b.cap);
}

// Lines with something to show: at least one goal (regular or shootout) or foul.
export function scoringLines(lines) {
  return lines.filter(line => line.goals + line.soGoals + line.excl + line.pens > 0);
}

export function lastEvent(events) {
  const latest = events.reduce((last, event) => !last || event.ts >= last.ts ? event : last, null);
  return latest === null ? null : withPlayer(latest, latest.playerId);
}

// Stable sorting preserves array order when timestamps tie, without mutating events.
export function foulOutIds(events) {
  const counts = new Map();
  const ids = new Set();
  for (const event of [...events].sort((a, b) => a.ts - b.ts)) {
    if (event.playerId == null || !['excl', 'pen'].includes(event.type)) continue;
    const count = (counts.get(event.playerId) ?? 0) + 1;
    counts.set(event.playerId, count);
    if (count === EXCL_LIMIT) ids.add(event.id);
  }
  return ids;
}

export function latestNewGoal(prevEvents, nextEvents) {
  const seen = new Set(prevEvents.map(event => event.id));
  return nextEvents.reduce((latest, event) => {
    if (event.type !== 'goal' || seen.has(event.id)) return latest;
    return !latest || event.ts >= latest.ts ? event : latest;
  }, null);
}

export function timeline(events) {
  return [...PERIODS].reverse().flatMap(period => {
    const entries = events.filter(event => event.period === period
      && !SITUATION_TYPES.includes(event.type) && event.type !== 'gkIn')
      .map(event => withPlayer(event, event.playerId))
      .reverse().sort((a, b) => b.ts - a.ts);
    return entries.length ? [{ period, events: entries }] : [];
  });
}

export function timelineRows(events) {
  const rows = timeline(events);
  const regulationScore = { us: 0, them: 0 };
  // Walk the display order backwards to score by period, timestamp and original array order.
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const goals = { us: 0, them: 0 };
    const score = row.period === 'SO' ? { us: 0, them: 0 } : regulationScore;
    for (let j = row.events.length - 1; j >= 0; j--) {
      const event = row.events[j];
      if (event.type !== 'goal' && event.type !== 'oppGoal') continue;
      const side = event.type === 'goal' ? 'us' : 'them';
      goals[side]++;
      score[side]++;
      event.score = { ...score };
    }
    row.goals = goals;
  }
  return rows;
}

export function isDuplicateTap(prevEvent, type, playerId, now, windowMs = DUPLICATE_TAP_MS) {
  return prevEvent !== null && prevEvent.type === type
    && (prevEvent.playerId ?? null) === (playerId ?? null)
    && now >= prevEvent.ts && now - prevEvent.ts < windowMs;
}

export function playerHasEvents(events, playerId) {
  return events.some(event => event.playerId === playerId);
}

export const CAP_MIN = 1;
export const CAP_MAX = 99;

export function defaultSelection(roster, previousGame) {
  const previousPlayers = previousGame === null ? null
    : new Set(previousGame.lineup.map(player => player.playerId));
  return roster.filter(player => !player.archived).map(player => ({
    playerId: player.id,
    name: player.name,
    cap: player.cap,
    selected: previousPlayers === null || previousPlayers.has(player.id),
    goalie: player.goalie === true,
  })).sort((a, b) => a.cap - b.cap || a.name.localeCompare(b.name));
}

export function assignCap(selection, playerId, cap) {
  const target = selection.find(player => player.playerId === playerId);
  if (!target) return selection.map(player => ({ ...player }));
  const holder = selection.find(player => player.playerId !== playerId
    && player.selected && player.cap === cap);
  return selection.map(player => ({
    ...player,
    cap: player.playerId === playerId ? cap : player === holder ? target.cap : player.cap,
  }));
}

export function toggleSelected(selection, playerId) {
  return selection.map(player => {
    if (player.playerId !== playerId) return { ...player };
    const selected = !player.selected;
    const collision = selected && selection.some(other => other.playerId !== playerId
      && other.selected && other.cap === player.cap);
    return { ...player, selected, cap: collision ? null : player.cap };
  });
}

export function validateLineup(selection) {
  const selected = selection.filter(player => player.selected);
  if (!selected.length) return [{ playerId: null, reason: 'noPlayers' }];
  return selected.flatMap(player => {
    let reason;
    if (player.cap === null) reason = 'missingCap';
    else if (!Number.isInteger(player.cap) || player.cap < CAP_MIN || player.cap > CAP_MAX) reason = 'badCap';
    else if (selected.some(other => other !== player && other.cap === player.cap)) reason = 'duplicateCap';
    return reason ? [{ playerId: player.playerId, reason }] : [];
  });
}

export function lineupFrom(selection) {
  return selection.filter(player => player.selected)
    .map(({ playerId, name, cap, goalie }) => ({ playerId, name, cap, ...(goalie === true ? { goalie: true } : {}) }))
    .sort((a, b) => a.cap - b.cap);
}

/**
 * Caps are written back for everyone in the lineup. The goalie flag is written for everyone when
 * changedGoalieIds is null (a new game takes its flags from the roster), otherwise only for the
 * players whose tick the caller changed; everybody else keeps the roster's flag.
 */
export function rosterWithCaps(roster, lineup, changedGoalieIds = null) {
  const entries = new Map(lineup.map(player => [player.playerId, player]));
  return roster.map(player => {
    const entry = entries.get(player.id);
    if (!entry) return { ...player };
    const written = { ...player, cap: entry.cap };
    if (changedGoalieIds === null || changedGoalieIds.has(player.id)) written.goalie = entry.goalie === true;
    return written;
  });
}

export function seasonFor(isoDate) {
  const [year, month] = isoDate.split('-').map(Number);
  const start = month >= 8 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** A season label is exactly YYYY-YY, for example 2026-27. */
export function isValidSeason(season) {
  return typeof season === 'string' && /^\d{4}-\d{2}$/.test(season);
}

export function gameResult(game) {
  const { us, them, soUs, soThem } = deriveScore(game.events);
  const quarters = Array.from({ length: 4 }, () => ({ us: 0, them: 0 }));
  let excl = 0;
  let pens = 0;
  for (const { period, type } of game.events) {
    if (!Number.isInteger(period) || period < 1 || period > quarters.length) continue;
    const quarter = quarters[period - 1];
    if (type === 'goal') quarter.us++;
    else if (type === 'oppGoal') quarter.them++;
    else if (type === 'excl') excl++;
    else if (type === 'pen') pens++;
  }
  const result = { gameId: game.id, date: game.date, opponent: game.opponent, us, them, excl, pens, quarters };
  if (hasShootout(game.period, game.events)) Object.assign(result, { soUs, soThem });
  if (isTracked(game)) Object.assign(result, situationCounts(game));
  const fields = competitionOf(game);
  if (fields.competition !== 'league' || fields.phaseId) Object.assign(result, fields);
  return result;
}

export function resultOutcome(result) {
  const { us, them, soUs, soThem } = result ?? {};
  if (!Number.isFinite(us) || !Number.isFinite(them)) return null;
  if (us > them) return 'W';
  if (us < them) return 'L';
  if (Number.isFinite(soUs) && Number.isFinite(soThem) && soUs !== soThem) return soUs > soThem ? 'W' : 'L';
  return 'D';
}

export function seasonRow(game, names) {
  const lineup = game.lineup ?? [];
  const players = playerLines(lineup, game.events).map(({ playerId, name, goals, excl, pens }) => [
    playerId, { name: names.get(playerId) ?? name, goals, excl, pens },
  ]);
  const lineupGoalies = new Set(lineup.filter(player => player.goalie === true).map(player => player.playerId));
  const goalieLines = goalieStats({ ...game, lineup })?.goalies ?? [];
  const goalies = goalieLines.map(({ playerId, name, saves, penSaves, goalsAgainst }) => [
    playerId, { name: names.get(playerId) ?? name, games: Number(lineupGoalies.has(playerId)), saves, penSaves, goalsAgainst },
  ]);
  return { ...gameResult(game), players: Object.fromEntries(players), goalies: Object.fromEntries(goalies) };
}

export function sumLines(rows) {
  const players = new Map();
  const goalies = new Map();
  for (const row of rows) {
    for (const [id, { name, goals, excl, pens }] of Object.entries(row.players ?? {})) {
      const total = players.get(id) ?? { name, games: 0, goals: 0, excl: 0, pens: 0 };
      total.games++;
      total.goals += goals;
      total.excl += excl;
      total.pens += pens;
      players.set(id, total);
    }
    for (const [id, { name, games, saves, penSaves, goalsAgainst }] of Object.entries(row.goalies ?? {})) {
      const total = goalies.get(id) ?? { name, games: 0, saves: 0, penSaves: 0, goalsAgainst: 0 };
      total.games += games;
      total.saves += saves;
      total.penSaves += penSaves;
      total.goalsAgainst += goalsAgainst;
      goalies.set(id, total);
    }
  }
  return { players: Object.fromEntries(players), goalies: Object.fromEntries(goalies) };
}

export function countedRows(results) {
  return Array.isArray(results) ? results.filter(row => row != null && !isFriendly(row)) : [];
}

export function hasLines(results) {
  return countedRows(results).every(row => isPlainObject(row.players));
}

function rowScopes(row) {
  const { competition, phaseId, tournamentId } = competitionOf(row);
  if (competition === 'league') return phaseId ? ['league', `phase:${phaseId}`] : ['league'];
  if (competition === 'tournament' && tournamentId) return [`tournament:${tournamentId}`];
  return competition === 'cup' ? ['cup'] : [];
}

export function scopeRows(results, key) {
  const rows = countedRows(results);
  return key === 'season' ? rows : rows.filter(row => rowScopes(row).includes(key));
}

export function seasonScopes(results) {
  const rows = countedRows(results);
  if (!rows.length) return [];
  // Visit the earliest date first so each phase and tournament enters the map in display order.
  rows.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const counts = new Map();
  for (const row of rows) {
    for (const key of rowScopes(row)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const keys = [...counts.keys()].filter(key => counts.get(key) < rows.length);
  return ['season', ...['league', 'phase', 'tournament', 'cup'].flatMap(
    kind => keys.filter(key => key === kind || key.startsWith(`${kind}:`)),
  )];
}

export function aggregateSeason(games, roster) {
  const names = new Map(roster.map(player => [player.id, player.name]));
  const results = games.filter(game => game.status === 'final')
    .map(game => seasonRow(game, names)).sort((a, b) => b.date.localeCompare(a.date));
  const rows = countedRows(results);
  let situations = null;
  for (const { manUp, manDown } of rows) {
    if (!manUp) continue;
    situations ??= { manUp: { played: 0, scored: 0 }, manDown: { played: 0, stopped: 0 } };
    situations.manUp.played += manUp.played;
    situations.manUp.scored += manUp.scored;
    situations.manDown.played += manDown.played;
    situations.manDown.stopped += manDown.stopped;
  }
  return { ...sumLines(rows), situations, results };
}

export function formatDate(iso) {
  return iso.split('-').reverse().join('/');
}

export function todayIso(now = new Date(), timeZone = 'Europe/Athens') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/**
 * Plan the viewer's subscriptions and display from the latest watch snapshots.
 * `offline` is the browser's own connection state. A watch that has waited for the server in vain carries
 * `meta.stale` itself, so one silent watch does not make another watch's cache miss count as absence.
 */
export function viewerState({ route, team, game, live, stats, offline, calendarSeason, lastSeason, lastShown }) {
  const settled = watch => watch?.data !== undefined
    && (watch.data !== null || !watch.meta?.fromCache || watch.meta?.error || watch.meta?.stale || offline);
  const matching = (watch, key) => key !== null && watch.key === key ? watch : undefined;

  const isHome = route.kind === 'home';
  const isGame = route.kind === 'game';
  const gameKey = isGame ? route.id : null;
  const currentId = team.data?.currentGameId ?? null;
  const liveKey = gameKey === currentId ? null : currentId;
  const routedGame = matching(game, gameKey);
  const currentGame = gameKey === currentId ? routedGame : matching(live, liveKey);

  let season = isHome ? lastSeason : null;
  if (isHome && settled(team)) {
    if (team.meta?.error) {
      season = lastSeason ?? calendarSeason;
    } else if (currentId === null) {
      // A cached roster without a pointer may be older than the server's current game.
      if (!team.meta?.fromCache || team.meta?.stale || offline) season = calendarSeason;
    } else if (settled(currentGame)) {
      // A missing game can arrive before the team points elsewhere.
      season = currentGame.data === null ? lastSeason ?? calendarSeason : currentGame.data.season;
    }
  }

  let mode = 'unavailable';
  if (isHome) {
    mode = team.data === undefined ? 'loading' : 'home';
  } else if (isGame) {
    if (routedGame?.data) mode = 'game';
    else if (!settled(routedGame)) {
      const heldUnavailable = lastShown?.gameKey === gameKey && lastShown.mode === 'unavailable';
      if (!heldUnavailable) mode = 'loading';
    }
  }

  let results = isHome ? 'loading' : null;
  if (season !== null) {
    const seasonStats = matching(stats, season);
    if (seasonStats?.data !== undefined) {
      if (seasonStats.meta?.error) results = 'failed';
      else if (settled(seasonStats)) {
        const rows = seasonStats.data?.results;
        results = Array.isArray(rows) && rows.length > 0 ? 'ready' : 'empty';
      }
    }
    // Reconnecting can make an offline cache miss unsettled again.
    if (results === 'loading' && lastShown?.statsKey === season) results = lastShown.results ?? results;
  }

  const banner = liveKey !== null && mode !== 'loading' && currentGame?.data?.status === 'live'
    ? { gameId: liveKey }
    : null;

  return {
    watch: { game: gameKey, live: liveKey, stats: season },
    tracked: { team: true, game: isGame, live: isHome, stats: isHome },
    mode, season, results, banner,
  };
}
