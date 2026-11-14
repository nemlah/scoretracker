import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventLabel, goalCountLabel, periodLabel, scoreText, t, timelineEntry } from '../../js/strings.js';

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

test('figure text', async () => {
  const { manUpText, manDownText, situationShort } = await import('../../js/strings.js');
  assert.equal(manUpText({ played: 7, scored: 3 }), 'Man-up 3/7 · 43%');
  assert.equal(manUpText({ played: 0, scored: 0 }), 'Man-up 0/0');
  assert.equal(manUpText(null), 'Man-up —');
  assert.equal(manDownText({ played: 6, stopped: 4 }), 'Man-down 4/6 stopped · 67%');
  assert.equal(manDownText({ played: 0, stopped: 0 }), 'Man-down 0/0 stopped');
  assert.equal(manDownText(null), 'Man-down —');
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
