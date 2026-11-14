/**
 * @typedef {Object} Open
 * @property {'manUp'|'manDown'} kind
 * @property {string} startId
 * @property {number} startTs
 * @property {1|2|3|4} period
 *
 * @typedef {Open & { outcome: 'scored'|'missed'|'stopped'|'conceded', closedBy: string|null }} Closed
 */

export const SITUATION_TYPES = Object.freeze(['manUp', 'manUpEnd', 'manDownEnd']);
export const SITUATION_REMIND_MS = 40000;

export function isTracked(game) {
  return game?.situations === true;
}

/** @returns {{ closed: Closed[], open: Open|null }} */
export function replaySituations(game) {
  const closed = [];
  let open = null;
  if (!isTracked(game)) return { closed, open };

  function close(outcome, closedBy) {
    closed.push({ ...open, outcome, closedBy });
    open = null;
  }

  // Array sort is stable, so equal timestamps keep their original array order.
  const events = [...game.events].sort((a, b) => a.ts - b.ts);
  for (const event of events) {
    if (![1, 2, 3, 4].includes(event.period)) continue;
    if (open && event.period !== open.period) {
      close(open.kind === 'manUp' ? 'missed' : 'stopped', null);
    }
    switch (event.type) {
      case 'goal':
        if (open) close(open.kind === 'manUp' ? 'scored' : 'stopped', event.id);
        break;
      case 'oppGoal':
        if (open) close(open.kind === 'manUp' ? 'missed' : 'conceded', event.id);
        break;
      case 'excl':
        if (open?.kind === 'manUp') close('missed', event.id);
        if (!open) open = { kind: 'manDown', startId: event.id, startTs: event.ts, period: event.period };
        break;
      case 'manUp':
        if (open?.kind === 'manDown') close('stopped', event.id);
        if (!open) open = { kind: 'manUp', startId: event.id, startTs: event.ts, period: event.period };
        break;
      case 'manUpEnd':
        if (open?.kind === 'manUp') close('missed', event.id);
        break;
      case 'manDownEnd':
        if (open?.kind === 'manDown') close('stopped', event.id);
        break;
    }
  }
  if (open && (game.status === 'final' || game.period !== open.period)) {
    close(open.kind === 'manUp' ? 'missed' : 'stopped', null);
  }
  return { closed, open };
}

export function situationCounts(game) {
  if (!isTracked(game)) return null;
  const counts = { manUp: { played: 0, scored: 0 }, manDown: { played: 0, stopped: 0 } };
  for (const situation of replaySituations(game).closed) {
    counts[situation.kind].played += 1;
    if (situation.outcome === 'scored') counts.manUp.scored += 1;
    if (situation.outcome === 'stopped') counts.manDown.stopped += 1;
  }
  return counts;
}

export function manUpGoalIds(game) {
  return new Set(replaySituations(game).closed
    .filter(situation => situation.kind === 'manUp' && situation.outcome === 'scored')
    .map(situation => situation.closedBy));
}

export function manUpSwitch(game, goalId, on, id = crypto.randomUUID()) {
  if (!isTracked(game)) return null;
  const goal = game.events.find(event => event.id === goalId && event.type === 'goal');
  if (!goal || ![1, 2, 3, 4].includes(goal.period)) return null;
  const scored = replaySituations(game).closed.find(situation => situation.kind === 'manUp'
    && situation.outcome === 'scored' && situation.closedBy === goalId);
  if (on === Boolean(scored)) return null;

  if (on) {
    const end = game.events.find(event => event.type === 'manUpEnd' && event.ts === goal.ts - 1);
    if (end) return { op: 'remove', event: end };
  } else if (scored.startTs === goal.ts - 1) {
    return { op: 'remove', event: game.events.find(event => event.id === scored.startId) };
  }
  return {
    op: 'add',
    event: { id, type: on ? 'manUp' : 'manUpEnd', period: goal.period, ts: goal.ts - 1 },
  };
}
