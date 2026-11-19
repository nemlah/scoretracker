import { EXCL_LIMIT, gameResult, PERIODS, playerLines } from './model.js';
import { isTracked, manUpGoalIds, replaySituations } from './situations.js';

const regulationPeriods = PERIODS.slice(0, 4);

export function pct(part, whole) {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0 || part < 0) return null;
  return Math.round(100 * part / whole);
}

function gameSituations(game) {
  const manUp = {
    quarters: regulationPeriods.map(() => ({ played: 0, scored: 0 })),
    played: 0,
    scored: 0,
  };
  const manDown = {
    quarters: regulationPeriods.map(() => ({ played: 0, stopped: 0 })),
    played: 0,
    stopped: 0,
  };
  const counts = { manUp, manDown };
  for (const { kind, period, outcome } of replaySituations(game).closed) {
    const total = counts[kind];
    const quarter = total.quarters[period - 1];
    total.played++;
    quarter.played++;
    if (outcome === 'scored' || outcome === 'stopped') {
      total[outcome]++;
      quarter[outcome]++;
    }
  }
  return counts;
}

function goalFlow(events) {
  let lead = 0;
  let biggestLead = 0;
  let ties = 0;
  let neverBehind = true;
  let runSide = null;
  let runLength = 0;
  const runs = { us: 0, them: 0 };
  const scorers = new Set();
  for (const { type, playerId } of events) {
    if (type !== 'goal' && type !== 'oppGoal') continue;
    const ours = type === 'goal';
    const side = ours ? 'us' : 'them';
    if (ours && playerId != null) scorers.add(playerId);
    lead += ours ? 1 : -1;
    biggestLead = Math.max(biggestLead, lead);
    if (lead === 0) ties++;
    if (lead < 0) neverBehind = false;
    runLength = side === runSide ? runLength + 1 : 1;
    runSide = side;
    runs[side] = Math.max(runs[side], runLength);
  }
  let longestRun = null;
  if (runSide !== null) {
    longestRun = runs.us >= runs.them ? { us: runs.us, them: 0 } : { us: 0, them: runs.them };
  }
  return { biggestLead, longestRun, ties, neverBehind, scorers: scorers.size };
}

export function gameTeamStats(game) {
  // Array sort is stable, so equal timestamps keep their original array order.
  const events = game.events.filter(event => regulationPeriods.includes(event.period))
    .sort((a, b) => a.ts - b.ts);
  const { us, them, excl, pens } = gameResult({ ...game, events });
  const tracked = isTracked(game);
  const { manUp, manDown } = tracked ? gameSituations(game) : { manUp: null, manDown: null };
  const goals = {
    for: us,
    against: them,
    manUpFor: tracked ? manUpGoalIds(game).size : null,
    manDownAgainst: manDown ? manDown.played - manDown.stopped : null,
  };

  const quarters = regulationPeriods.map(() => ({ excl: 0, pens: 0 }));
  let saved = 0;
  for (const { type, period } of events) {
    if (type === 'excl') quarters[period - 1].excl++;
    else if (type === 'pen') quarters[period - 1].pens++;
    else if (type === 'penSave') saved++;
  }
  const trouble = playerLines(game.lineup, game.events)
    .map(({ playerId, name, cap, excl, pens }) => {
      const fouls = excl + pens;
      return { playerId, name, cap, fouls, out: fouls >= EXCL_LIMIT };
    })
    .filter(player => player.fouls >= 2)
    .sort((a, b) => Number(a.out) - Number(b.out) || a.cap - b.cap);

  return {
    tracked, manUp, manDown, goals,
    fouls: { quarters, excl, pens },
    trouble,
    pensAgainst: { faced: pens, saved },
    flow: goalFlow(events),
  };
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function validSituation(played, successful) {
  return isCount(played) && isCount(successful) && successful <= played;
}

function validQuarters(quarters) {
  return Array.isArray(quarters) && quarters.length === regulationPeriods.length
    && [...quarters].every(quarter => isCount(quarter?.us) && isCount(quarter?.them));
}

export function seasonTeamStats(stats) {
  const results = Array.isArray(stats?.results) ? stats.results : [];
  const games = [];
  const total = {
    manUp: { played: 0, scored: 0 },
    manDown: { played: 0, stopped: 0 },
    situationGames: 0,
    excl: 0,
    exclGames: 0,
  };
  const quarterFor = regulationPeriods.map(() => 0);
  const quarterAgainst = regulationPeriods.map(() => 0);
  let covered = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let manDownAgainst = 0;

  for (const result of results) {
    const { gameId, opponent, date, manUp, manDown, excl, quarters, us, them } = result ?? {};
    const row = {
      gameId: typeof gameId === 'string' ? gameId : null,
      opponent: typeof opponent === 'string' ? opponent : null,
      date: typeof date === 'string' ? date : null,
      manUp: null,
      manDown: null,
      excl: null,
    };
    if (validSituation(manUp?.played, manUp?.scored) && validSituation(manDown?.played, manDown?.stopped)) {
      row.manUp = { played: manUp.played, scored: manUp.scored };
      row.manDown = { played: manDown.played, stopped: manDown.stopped };
      total.manUp.played += manUp.played;
      total.manUp.scored += manUp.scored;
      total.manDown.played += manDown.played;
      total.manDown.stopped += manDown.stopped;
      total.situationGames++;
      manDownAgainst += manDown.played - manDown.stopped;
    }
    if (isCount(excl)) {
      row.excl = excl;
      total.excl += excl;
      total.exclGames++;
    }
    if (validQuarters(quarters)) {
      covered++;
      quarters.forEach(({ us, them }, index) => {
        quarterFor[index] += us;
        quarterAgainst[index] += them;
      });
    }
    if (Number.isFinite(us)) goalsFor += us;
    if (Number.isFinite(them)) goalsAgainst += them;
    games.push(row);
  }

  const totalFor = quarterFor.reduce((sum, goals) => sum + goals, 0);
  const totalAgainst = quarterAgainst.reduce((sum, goals) => sum + goals, 0);
  const of = results.length;
  return {
    games,
    total,
    quarters: {
      for: quarterFor,
      against: quarterAgainst,
      diff: quarterFor.map((goals, index) => goals - quarterAgainst[index]),
      totalFor,
      totalAgainst,
      totalDiff: totalFor - totalAgainst,
      covered,
      of,
    },
    goals: {
      for: goalsFor,
      against: goalsAgainst,
      manUpFor: total.manUp.scored,
      manDownAgainst,
      situationGames: total.situationGames,
      of,
    },
  };
}
