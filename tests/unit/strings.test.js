import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventLabel, goalCountLabel, periodLabel, scoreText, t } from '../../js/strings.js';

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
