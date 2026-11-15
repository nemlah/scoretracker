/**
 * @typedef {Object} GoalieLine
 * @property {string} playerId
 * @property {string} name
 * @property {number} cap
 * @property {number} saves
 * @property {number} penSaves
 * @property {number} goalsAgainst
 * @property {number} soSaves
 * @property {number} soConceded
 */

function replay(game, eventId = null, before = false) {
  const lineupGoalies = game.lineup.filter(player => player.goalie === true)
    .sort((a, b) => a.cap - b.cap);
  if (!lineupGoalies.length) return null;

  const lines = new Map();
  function lineFor(playerId) {
    if (!lines.has(playerId)) {
      const player = game.lineup.find(player => player.playerId === playerId);
      lines.set(playerId, {
        playerId, name: player?.name ?? '', cap: player?.cap ?? 0,
        saves: 0, penSaves: 0, goalsAgainst: 0, soSaves: 0, soConceded: 0,
      });
    }
    return lines.get(playerId);
  }
  for (const player of lineupGoalies) lineFor(player.playerId);
  let inGoal = lineupGoalies[0].playerId;

  // Array sort is stable, so equal timestamps keep their original array order.
  for (const event of [...game.events].sort((a, b) => a.ts - b.ts)) {
    if (event.id === eventId && before) break;
    if (['save', 'penSave', 'gkIn'].includes(event.type) && event.playerId != null) {
      inGoal = event.playerId;
      lineFor(inGoal);
    }
    const line = lineFor(inGoal);
    if ([1, 2, 3, 4].includes(event.period)) {
      if (event.type === 'save' && event.playerId != null) line.saves += 1;
      if (event.type === 'penSave' && event.playerId != null) line.penSaves += 1;
      if (event.type === 'oppGoal') line.goalsAgainst += 1;
    } else if (event.period === 'SO') {
      if (event.type === 'penSave' && event.playerId != null) line.soSaves += 1;
      if (event.type === 'oppGoal') line.soConceded += 1;
    }
    if (event.id === eventId) break;
  }
  return { goalies: [...lines.values()].sort((a, b) => a.cap - b.cap), inGoal };
}

/** @returns {{ goalies: GoalieLine[], inGoal: string|null }|null} */
export function goalieStats(game) {
  return replay(game);
}

export function savePct(line) {
  const saved = line.saves + line.penSaves;
  const faced = saved + line.goalsAgainst;
  return faced === 0 ? null : Math.round(saved / faced * 100);
}

export function inGoalAt(game, eventId) {
  if (!game.events.some(event => event.id === eventId)) return null;
  return replay(game, eventId)?.inGoal ?? null;
}

export function inGoalSwitch(game, oppGoalId, goalieId, id = crypto.randomUUID()) {
  if (!game.lineup.some(player => player.goalie === true && player.playerId === goalieId)) return null;
  const goal = game.events.find(event => event.id === oppGoalId && event.type === 'oppGoal');
  if (!goal || inGoalAt(game, oppGoalId) === goalieId) return null;

  const correction = game.events.find(event => event.type === 'gkIn'
    && event.ts === goal.ts - 1 && event.period === goal.period);
  if (correction) {
    if (replay(game, correction.id, true).inGoal === goalieId) {
      return { op: 'remove', event: correction };
    }
    return { op: 'replace', event: correction, newEvent: { ...correction, playerId: goalieId } };
  }
  return {
    op: 'add',
    event: { id, type: 'gkIn', period: goal.period, ts: goal.ts - 1, playerId: goalieId },
  };
}
