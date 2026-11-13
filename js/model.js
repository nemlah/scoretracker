/**
 * @typedef {Object} Event
 * @property {string} id
 * @property {'goal'|'excl'|'oppGoal'} type
 * @property {1|2|3|4|'SO'} period
 * @property {number} ts
 * @property {string} [playerId]
 *
 * @typedef {Object} LineupEntry
 * @property {string} playerId
 * @property {string} name
 * @property {number} cap
 *
 * @typedef {Object} RosterPlayer
 * @property {string} id
 * @property {string} name
 * @property {number} cap
 * @property {boolean} archived
 *
 * @typedef {Object} Selection
 * @property {string} playerId
 * @property {string} name
 * @property {number|null} cap
 * @property {boolean} selected
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
 */

export const PERIODS = Object.freeze([1, 2, 3, 4, 'SO']);
export const EXCL_LIMIT = 3;
export const DUPLICATE_TAP_MS = 1000;

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
    return {
      ...player,
      goals: ownEvents.filter(event => event.type === 'goal' && event.period !== 'SO').length,
      soGoals: ownEvents.filter(event => event.type === 'goal' && event.period === 'SO').length,
      excl,
      out: excl >= EXCL_LIMIT,
    };
  }).sort((a, b) => a.cap - b.cap);
}

export function lastEvent(events) {
  const latest = events.reduce((last, event) => !last || event.ts >= last.ts ? event : last, null);
  return latest === null ? null : withPlayer(latest, latest.playerId);
}

export function timeline(events) {
  return [...PERIODS].reverse().flatMap(period => {
    const entries = events.filter(event => event.period === period)
      .map(event => withPlayer(event, event.playerId))
      .reverse().sort((a, b) => b.ts - a.ts);
    return entries.length ? [{ period, events: entries }] : [];
  });
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
    .map(({ playerId, name, cap }) => ({ playerId, name, cap }))
    .sort((a, b) => a.cap - b.cap);
}

export function rosterWithCaps(roster, lineup) {
  const caps = new Map(lineup.map(player => [player.playerId, player.cap]));
  return roster.map(player => ({ ...player, cap: caps.has(player.id) ? caps.get(player.id) : player.cap }));
}

export function seasonFor(isoDate) {
  const [year, month] = isoDate.split('-').map(Number);
  const start = month >= 8 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function gameResult(game) {
  const { us, them, soUs, soThem } = deriveScore(game.events);
  const result = { gameId: game.id, date: game.date, opponent: game.opponent, us, them };
  if (hasShootout(game.period, game.events)) Object.assign(result, { soUs, soThem });
  return result;
}

export function aggregateSeason(games, roster) {
  const names = new Map(roster.map(player => [player.id, player.name]));
  const players = new Map();
  const finals = games.filter(game => game.status === 'final');
  for (const game of finals) {
    for (const line of playerLines(game.lineup, game.events)) {
      const totals = players.get(line.playerId) ?? {
        name: names.get(line.playerId) ?? line.name, games: 0, goals: 0, excl: 0,
      };
      players.set(line.playerId, {
        ...totals, games: totals.games + 1, goals: totals.goals + line.goals, excl: totals.excl + line.excl,
      });
    }
  }
  return {
    players: Object.fromEntries(players),
    results: finals.map(gameResult).sort((a, b) => b.date.localeCompare(a.date)),
  };
}

export function formatDate(iso) {
  return iso.split('-').reverse().join('/');
}

export function todayIso(now = new Date(), timeZone = 'Europe/Athens') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}
