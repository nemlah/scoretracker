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
