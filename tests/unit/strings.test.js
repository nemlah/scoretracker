import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as strings from '../../js/strings.js';
import { eventLabel, goalCountLabel, periodLabel, scoreText, situationShort, t, timelineEntry } from '../../js/strings.js';

const lineup = [
  { playerId: 'p5', name: 'Alexiou', cap: 5 },
  { playerId: 'p2', name: 'Παπαδάκης', cap: 2 },
];
const goal = (playerId) => ({ id: 'e', type: 'goal', period: 1, ts: 1, ...(playerId ? { playerId } : {}) });

test('eventLabel formats each event type', () => {
  assert.equal(eventLabel(goal('p5'), lineup), 'Goal · #5 Alexiou');
  assert.equal(eventLabel(goal(), lineup), 'Goal · scorer unknown');
  assert.equal(eventLabel({ id: 'x', type: 'excl', period: 2, ts: 2, playerId: 'p2' }, lineup), 'Exclusion · #2 Παπαδάκης');
  assert.equal(eventLabel({ id: 'o', type: 'oppGoal', period: 2, ts: 3 }, lineup), 'Opponent goal');
});

test('eventLabel flags a player missing from the lineup', () => {
  assert.equal(eventLabel(goal('gone'), lineup), '#? Unknown player');
  assert.equal(eventLabel({ id: 'x', type: 'excl', period: 1, ts: 1, playerId: 'gone' }, lineup), '#? Unknown player');
});

test('timelineEntry puts an opponent goal on the right with the opponent name', () => {
  const event = { id: 'o', type: 'oppGoal', period: 2, ts: 3 };
  assert.deepEqual(timelineEntry(event, lineup, 'Olympiacos'),
    { side: 'them', icon: '🏐', sr: 'Opponent goal', text: 'Olympiacos', badge: false });
  assert.deepEqual(timelineEntry(event, lineup, '  Olympiacos '),
    { side: 'them', icon: '🏐', sr: 'Opponent goal', text: 'Olympiacos', badge: false });
});

test('timelineEntry falls back to a generic opponent name', () => {
  const event = { id: 'o', type: 'oppGoal', period: 2, ts: 3 };
  const expected = { side: 'them', icon: '🏐', sr: 'Opponent goal', text: 'Opponent', badge: false };
  assert.deepEqual(timelineEntry(event, lineup, '  '), expected);
  assert.deepEqual(timelineEntry(event, lineup, undefined), expected);
});

test('timelineEntry labels a goal with no scorer', () => {
  assert.deepEqual(timelineEntry(goal(), lineup, 'Olympiacos'),
    { side: 'us', icon: '🏐', sr: 'Goal', text: 'Unknown scorer', badge: false });
});

test('timelineEntry shows cap and name for a goal', () => {
  assert.deepEqual(timelineEntry(goal('p5'), lineup, 'Olympiacos'),
    { side: 'us', icon: '🏐', sr: 'Goal', text: '#5 Alexiou', badge: false });
});

test('timelineEntry shows cap and name for an exclusion', () => {
  const event = { id: 'x', type: 'excl', period: 2, ts: 2, playerId: 'p2' };
  assert.deepEqual(timelineEntry(event, lineup, 'Olympiacos'),
    { side: 'us', icon: 'E', sr: 'Exclusion', text: '#2 Παπαδάκης', badge: true });
});

test('timelineEntry flags a player missing from the lineup', () => {
  assert.deepEqual(timelineEntry(goal('gone'), lineup, 'Olympiacos'),
    { side: 'us', icon: '🏐', sr: 'Goal', text: '#? Unknown player', badge: false });
  const event = { id: 'x', type: 'excl', period: 1, ts: 1, playerId: 'gone' };
  assert.deepEqual(timelineEntry(event, lineup, 'Olympiacos'),
    { side: 'us', icon: 'E', sr: 'Exclusion', text: '#? Unknown player', badge: true });
});

test('periodLabel', () => {
  assert.deepEqual([1, 2, 3, 4, 'SO'].map(periodLabel), ['Q1', 'Q2', 'Q3', 'Q4', 'Shootout']);
});

test('scoreText uses an en dash and optional shootout', () => {
  const score = { us: 9, them: 9, soUs: 4, soThem: 3 };
  assert.deepEqual(scoreText(score, true), { main: '9 – 9', shootout: '(4 – 3 pen.)' });
  assert.deepEqual(scoreText(score, false), { main: '9 – 9', shootout: null });
});

test('t interpolates params and warns on a missing key', () => {
  assert.equal(t('goalNamed', { cap: 7, name: 'Nikos' }), 'Goal · #7 Nikos');
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    assert.equal(t('noSuchKey'), 'noSuchKey');
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 1);
});

test('static index.html title matches the catalog title used for document.title', async () => {
  const { readFile } = await import('node:fs/promises');
  const { team } = await import('../../js/config.js');
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const staticTitle = html.match(/<title>([^<]*)<\/title>/)?.[1];
  assert.equal(staticTitle, t('viewerTitle', { team: team.name }));
});

test('static track.html title matches the catalog title used for document.title', async () => {
  const { readFile } = await import('node:fs/promises');
  const { team } = await import('../../js/config.js');
  const html = await readFile(new URL('../../track.html', import.meta.url), 'utf8');
  const staticTitle = html.match(/<title>([^<]*)<\/title>/)?.[1];
  assert.equal(staticTitle, t('trackerTitle', { team: team.name }));
});

test('goalCountLabel is singular for exactly one goal', () => {
  assert.equal(goalCountLabel(0), 'goals');
  assert.equal(goalCountLabel(1), 'goal');
  assert.equal(goalCountLabel(2), 'goals');
});

test('eventLabel names penalty fouls and situation events', () => {
  const players = [{ playerId: 'p2', cap: 2, name: 'Papadakis' }];
  assert.equal(eventLabel({ type: 'pen', playerId: 'p2' }, players), 'Penalty foul · #2 Papadakis');
  assert.equal(eventLabel({ type: 'pen', playerId: 'gone' }, players), '#? Unknown player');
  for (const [type, label] of [['manUp', 'Man-up'], ['manUpEnd', 'End man-up · no goal'], ['manDownEnd', 'End man-down · stopped']]) {
    assert.equal(eventLabel({ type }, players), label);
  }
});

test('situationShort labels tracked and untracked games', () => {
  assert.equal(situationShort({ manUp: { played: 7, scored: 3 }, manDown: { played: 6, stopped: 4 } }), 'MU 3/7 · MD 4/6');
  assert.equal(situationShort(null), '—');
});

test('timelineEntry for a penalty foul', () => {
  assert.deepEqual(timelineEntry({ type: 'pen', playerId: 'p5' }, lineup),
    { side: 'us', icon: 'P', sr: 'Penalty foul', text: '#5 Alexiou', badge: true });
  assert.deepEqual(timelineEntry({ type: 'pen', playerId: 'gone' }, lineup),
    { side: 'us', icon: 'P', sr: 'Penalty foul', text: '#? Unknown player', badge: true });
});

test('timelineEntry for a fouling-out foul', () => {
  const players = [{ playerId: 'p2', cap: 2, name: 'Papadakis' }];
  for (const [type, foul] of [['excl', 'Exclusion'], ['pen', 'Penalty foul']]) {
    assert.deepEqual(timelineEntry({ type, playerId: 'p2' }, players, 'X', true),
      { side: 'us', icon: '🟥', sr: `${foul} · out`, text: '#2 Papadakis · out', badge: false });
  }
  assert.equal(timelineEntry(goal('p5'), lineup, 'X', true).icon, '🏐');
});

test('celebration strings', () => {
  assert.equal(t('celebrateGoal'), 'GOAL!');
  assert.equal(t('celebrateScorer', { cap: 5, name: 'Alexiou' }), '#5 Alexiou');
  assert.equal(t('celebrateManUp', { scorer: '#5 Alexiou' }), '#5 Alexiou · man-up');
});

const goalkeepers = [
  { playerId: 'g1', cap: 1, name: 'Georgiou', goalie: true },
  { playerId: 'g13', cap: 13, name: 'Nikolaou', goalie: true },
];

test('eventLabel names save, penSave and gkIn', () => {
  assert.equal(eventLabel({ type: 'save', playerId: 'g1' }, goalkeepers), 'Save · #1 Georgiou');
  assert.equal(eventLabel({ type: 'penSave', playerId: 'g1' }, goalkeepers), 'Penalty save · #1 Georgiou');
  assert.equal(eventLabel({ type: 'gkIn', playerId: 'g13' }, goalkeepers), 'In goal · #13 Nikolaou');
  for (const type of ['save', 'penSave', 'gkIn']) {
    assert.equal(eventLabel({ type, playerId: 'gone' }, goalkeepers), '#? Unknown player');
  }
});

test('timelineEntry for a penalty save', () => {
  assert.deepEqual(timelineEntry({ type: 'penSave', playerId: 'g1' }, goalkeepers),
    { side: 'us', icon: '✋', sr: 'Penalty saved', text: 'Penalty saved · #1 Georgiou', badge: false });
  assert.deepEqual(timelineEntry({ type: 'penSave', playerId: 'gone' }, goalkeepers, 'X', true),
    { side: 'us', icon: '✋', sr: 'Penalty saved', text: 'Penalty saved · #? Unknown player', badge: false });
});

test('timelineEntry for a save', () => {
  assert.deepEqual(timelineEntry({ type: 'save', playerId: 'g1' }, goalkeepers),
    { side: 'us', icon: '✋', sr: 'Save', text: 'Save · #1 Georgiou', badge: false, minor: true });
  assert.deepEqual(timelineEntry({ type: 'save', playerId: 'gone' }, goalkeepers),
    { side: 'us', icon: '✋', sr: 'Save', text: 'Save · #? Unknown player', badge: false, minor: true });
  assert.equal(strings.TIMELINE_SAVES, true);
});

test('the live banner pill and the R2 viewer lookup keys are available', () => {
  const params = { team: 'ANOG', opponent: 'Rivals', us: 12, them: 11, period: 'Q3' };
  // The R2 viewer fallback still reads the one-line banner template.
  assert.equal(t('liveBanner', params), 'Live: Rivals 12–11 · Q3');
  assert.equal(t('liveBadge', params), 'LIVE · Q3');
  assert.equal(strings.hasString('liveBanner'), true);
  assert.equal(strings.hasString('liveBadge'), true);
  assert.equal(strings.hasString('noSuchString'), false);
});

test('the season header and result row strings', () => {
  assert.equal(t('seasonRecord', { w: 3, l: 1 }), '3 W · 1 L');
  assert.equal(t('seasonRecordDraws', { w: 3, l: 1, d: 2 }), '3 W · 1 L · 2 D');
  assert.equal(t('resultPen', { us: 4, them: 3 }), 'pen. 4–3');
  assert.deepEqual(['resultW', 'resultL', 'resultD'].map(key => t(key)), ['W', 'L', 'D']);
  assert.deepEqual(['resultNameW', 'resultNameL', 'resultNameD'].map(key => t(key)), ['Win', 'Loss', 'Draw']);
  assert.equal(t('resultLabel', { outcome: 'Win', score: '10 – 10, pen. 4–3', opponent: 'Rivals' }),
    'Win 10 – 10, pen. 4–3 against Rivals');
});

test('competition labels and form strings use the catalog wording', () => {
  assert.deepEqual(['league', 'cup', 'tournament', 'friendly'].map(strings.competitionLabel),
    ['League', 'Cup', 'Tournament', 'Friendly']);
  assert.equal(t('competitionField'), 'Competition');
  assert.equal(t('competitionNameLabel'), 'Tournament name');
  assert.equal(t('competitionNameRequired'), 'Enter the tournament name');
  assert.equal(t('friendliesNotCounted', { n: 2 }), 'Friendlies not counted (2)');
});

test('competition tags label non-league games and use the tournament name when present', () => {
  for (const source of [{}, null, { competition: 'league' }, { competition: 'bogus' }]) {
    assert.equal(strings.competitionTag(source), null);
  }
  assert.equal(strings.competitionTag({ competition: 'cup' }), 'Cup');
  assert.equal(strings.competitionTag({ competition: 'friendly' }), 'Friendly');
  assert.equal(strings.competitionTag({ competition: 'tournament', competitionName: 'Κύπελλο Άνοιξης' }),
    'Κύπελλο Άνοιξης');
  assert.equal(strings.competitionTag({ competition: 'tournament', competitionName: '  Summer Cup ' }), 'Summer Cup');
  assert.equal(strings.competitionTag({ competition: 'tournament' }), 'Tournament');
  assert.equal(strings.competitionTag({ competition: 'tournament', competitionName: '  ' }), 'Tournament');
});
