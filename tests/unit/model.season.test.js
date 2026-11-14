import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../../js/model.js';
const ev = (type, period, playerId, ts) => m.makeEvent(type, period, playerId, ts, `e${ts}`);
const roster = [
  { id:'a', name:'Alexiou', cap:5, archived:false }, { id:'b', name:'Papadakis', cap:2, archived:false },
  { id:'c', name:'Georgiou', cap:7, archived:false }, { id:'z', name:'Old', cap:9, archived:true },
];
const caps = sel => sel.map(s => [s.playerId, s.cap]);

test('defaultSelection: no previous game → all active ticked, by cap', () => {
  assert.deepEqual(m.defaultSelection(roster, null), [
    { playerId:'b', name:'Papadakis', cap:2, selected:true },
    { playerId:'a', name:'Alexiou', cap:5, selected:true },
    { playerId:'c', name:'Georgiou', cap:7, selected:true },
  ]);
});
test('defaultSelection: previous game → only its lineup ticked', () => {
  const prev = { lineup: [{ playerId:'a', name:'Alexiou', cap:5 }] };
  assert.deepEqual(m.defaultSelection(roster, prev).map(s => [s.playerId, s.selected]), [['b',false],['a',true],['c',false]]);
});
test('assignCap swaps with the selected holder and does not mutate', () => {
  const sel = m.defaultSelection(roster, null);
  assert.deepEqual(caps(m.assignCap(sel, 'a', 2)), [['b',5],['a',2],['c',7]]);
  assert.equal(sel[1].cap, 5);
});
test('assignCap does not swap with an unselected holder', () => {
  const sel = m.assignCap(m.toggleSelected(m.defaultSelection(roster, null), 'b'), 'a', 2);
  assert.deepEqual(caps(sel), [['b',2],['a',2],['c',7]]);
});
test('toggleSelected: ticking into a collision clears the ticked cap', () => {
  let sel = m.toggleSelected(m.defaultSelection(roster, null), 'b');
  sel = m.toggleSelected(m.assignCap(sel, 'a', 2), 'b');
  assert.deepEqual(sel[0], { playerId:'b', name:'Papadakis', cap:null, selected:true });
  assert.deepEqual(m.validateLineup(sel), [{ playerId:'b', reason:'missingCap' }]);
});
test('validateLineup: ok, empty, bad, duplicate', () => {
  const base = m.defaultSelection(roster, null);
  assert.deepEqual(m.validateLineup(base), []);
  assert.deepEqual(m.validateLineup(base.map(s => ({ ...s, selected:false }))), [{ playerId:null, reason:'noPlayers' }]);
  for (const bad of [0, 100, 2.5]) {
    assert.deepEqual(m.validateLineup(base.map(s => s.playerId === 'c' ? { ...s, cap: bad } : s)), [{ playerId:'c', reason:'badCap' }]);
  }
  assert.deepEqual(m.validateLineup(base.map(s => s.playerId === 'c' ? { ...s, cap: 2 } : s)),
    [{ playerId:'b', reason:'duplicateCap' }, { playerId:'c', reason:'duplicateCap' }]);
});
test('lineupFrom and rosterWithCaps', () => {
  const lineup = m.lineupFrom(m.assignCap(m.defaultSelection(roster, null), 'a', 11));
  assert.deepEqual(lineup, [{ playerId:'b', name:'Papadakis', cap:2 }, { playerId:'c', name:'Georgiou', cap:7 }, { playerId:'a', name:'Alexiou', cap:11 }]);
  const r = m.rosterWithCaps(roster, lineup);
  assert.equal(r.find(p => p.id === 'a').cap, 11);
  assert.equal(r.find(p => p.id === 'z').cap, 9);
  assert.equal(roster[0].cap, 5);
});
test('seasonFor: 1 August cutoff', () => {
  assert.equal(m.seasonFor('2026-08-01'), '2026-27');
  assert.equal(m.seasonFor('2026-07-31'), '2025-26');
  assert.equal(m.seasonFor('2027-01-15'), '2026-27');
  assert.equal(m.seasonFor('2099-12-01'), '2099-00');
});
test('gameResult includes shootout only when there was one', () => {
  const g = { id:'g1', date:'2026-11-08', opponent:'Rivals', period:4, events:[ev('goal',1,'a',1), ev('oppGoal',2,null,2)] };
  assert.deepEqual(m.gameResult(g), { gameId:'g1', date:'2026-11-08', opponent:'Rivals', us:1, them:1 });
  assert.deepEqual(m.gameResult({ ...g, period:'SO', events:[...g.events, ev('goal','SO','a',3)] }),
    { gameId:'g1', date:'2026-11-08', opponent:'Rivals', us:1, them:1, soUs:1, soThem:0 });
});
test('aggregateSeason: final only, roster names, games played, no shootout goals', () => {
  const games = [
    { id:'g1', date:'2026-10-01', opponent:'A', status:'final', period:'SO',
      lineup:[{ playerId:'a', name:'Alex', cap:5 }, { playerId:'b', name:'Papadakis', cap:2 }, { playerId:'q', name:'Guest', cap:13 }],
      events:[ev('goal',1,'a',1), ev('excl',1,'b',2), ev('goal','SO','a',3), ev('goal',2,null,4), ev('pen',2,'b',5)] },
    { id:'g2', date:'2026-10-08', opponent:'B', status:'final', period:4, lineup:[{ playerId:'a', name:'Alexiou', cap:5 }], events:[ev('goal',3,'a',1)] },
    { id:'g3', date:'2026-10-15', opponent:'C', status:'live', period:1, lineup:[{ playerId:'a', name:'Alexiou', cap:5 }], events:[ev('goal',1,'a',1)] },
  ];
  const s = m.aggregateSeason(games, roster);
  assert.deepEqual(s.players, {
    a: { name:'Alexiou', games:2, goals:2, excl:0, pens:0 },
    b: { name:'Papadakis', games:1, goals:0, excl:1, pens:1 },
    q: { name:'Guest', games:1, goals:0, excl:0, pens:0 },
  });
  assert.deepEqual(s.results.map(r => r.gameId), ['g2', 'g1']);
});
test('formatDate and todayIso', () => {
  assert.equal(m.formatDate('2026-11-08'), '08/11/2026');
  assert.equal(m.todayIso(new Date('2026-11-12T22:30:00Z')), '2026-11-13');
});

test('isValidSeason accepts exactly YYYY-YY', () => {
  assert.equal(m.isValidSeason('2026-27'), true);
  assert.equal(m.isValidSeason(m.seasonFor('2026-11-08')), true);
  for (const bad of ['2026-2', '26-27', '2026-277', ' 2026-27', '2026/27', 'abcd-ef', '', null, undefined]) {
    assert.equal(m.isValidSeason(bad), false, String(bad));
  }
});

test('gameResult adds man-up and man-down figures only for tracked games', () => {
  const game = { id:'g1', date:'2026-11-08', opponent:'Rivals', status:'final', period:4,
    events:[ev('manUp',1,null,1), ev('goal',1,'a',2), ev('excl',1,'b',3), ev('oppGoal',1,null,4)] };
  const result = m.gameResult({ ...game, situations:true });
  assert.deepEqual(result.manUp, { played:1, scored:1 });
  assert.deepEqual(result.manDown, { played:1, stopped:0 });
  for (const marker of [undefined, false, 1, 'true']) {
    const untracked = m.gameResult({ ...game, ...(marker === undefined ? {} : { situations:marker }) });
    assert.equal('manUp' in untracked, false);
    assert.equal('manDown' in untracked, false);
  }
});
test('aggregateSeason sums situations over tracked final games only', () => {
  const base = { date:'2026-11-08', opponent:'Rivals', status:'final', period:4, lineup:[] };
  const untracked = { ...base, id:'old', events:[ev('excl',1,'b',1), ev('manDownEnd',1,null,2)] };
  const first = { ...base, id:'g1', situations:true,
    events:[ev('manUp',1,null,1), ev('goal',1,'a',2), ev('excl',1,'b',3), ev('oppGoal',1,null,4)] };
  const second = { ...base, id:'g2', situations:true,
    events:[ev('manUp',1,null,1), ev('manUpEnd',1,null,2), ev('excl',1,'b',3), ev('manDownEnd',1,null,4)] };
  const live = { ...first, id:'live', status:'live' };
  assert.deepEqual(m.aggregateSeason([untracked, first, second, live], roster).situations,
    { manUp:{ played:2, scored:1 }, manDown:{ played:2, stopped:1 } });
  assert.equal(m.aggregateSeason([untracked], roster).situations, null);
  assert.equal(m.aggregateSeason([live], roster).situations, null);
  assert.equal(m.aggregateSeason([], roster).situations, null);
  assert.deepEqual(m.aggregateSeason([{ ...first, events:[] }], roster).situations,
    { manUp:{ played:0, scored:0 }, manDown:{ played:0, stopped:0 } });
});
