import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  uniqueEvents, compareGames, newestGame, newerThan, validDocId, parseGamesRoute,
} from '../../js/model.js';

const ts = n => ({ toMillis: () => n });

test('uniqueEvents keeps the last version of an id in its position', () => {
  assert.deepEqual(
    uniqueEvents([{ id: 'e1', playerId: 'a' }, { id: 'e2' }, { id: 'e1', playerId: 'b' }]),
    [{ id: 'e2' }, { id: 'e1', playerId: 'b' }],
  );
});

test('uniqueEvents keeps entries without a string id and returns the same array when nothing repeats', () => {
  const arr = [{ id: 'a' }, { id: 'b' }, { type: 'x' }];
  assert.equal(uniqueEvents(arr), arr);
  assert.deepEqual(uniqueEvents([{ type: 'x' }, { type: 'x' }]), [{ type: 'x' }, { type: 'x' }]);
  assert.deepEqual(uniqueEvents([{ id: 1 }, { id: 1 }]), [{ id: 1 }, { id: 1 }]);
});

test('compareGames orders by date, then createdAt, then id', () => {
  assert.ok(compareGames({ date: '2026-01-01', createdAt: ts(9), id: 'z' }, { date: '2026-01-02', createdAt: ts(1), id: 'a' }) < 0);
  assert.ok(compareGames({ date: '2026-01-02', createdAt: ts(1), id: 'a' }, { date: '2026-01-01', createdAt: ts(9), id: 'z' }) > 0);
  assert.ok(compareGames({ date: 'd', createdAt: ts(1), id: 'z' }, { date: 'd', createdAt: ts(2), id: 'a' }) < 0);
  assert.ok(compareGames({ date: 'd', createdAt: ts(2), id: 'a' }, { date: 'd', createdAt: ts(1), id: 'z' }) > 0);
  assert.ok(compareGames({ date: 'd', createdAt: ts(1), id: 'a' }, { date: 'd', createdAt: ts(1), id: 'b' }) < 0);
  assert.ok(compareGames({ date: 'd', createdAt: ts(1), id: 'b' }, { date: 'd', createdAt: ts(1), id: 'a' }) > 0);
  assert.equal(compareGames({ date: 'd', createdAt: ts(1), id: 'a' }, { date: 'd', createdAt: ts(1), id: 'a' }), 0);
});

test('compareGames sorts a null createdAt newest and a missing one oldest', () => {
  const t = { date: 'd', createdAt: ts(5), id: 'm' };
  const pending = { date: 'd', createdAt: null, id: 'a' };
  const missing = { date: 'd', id: 'z' };
  assert.ok(compareGames(pending, t) > 0);
  assert.ok(compareGames(t, pending) < 0);
  assert.ok(compareGames(missing, t) < 0);
  assert.ok(compareGames(t, missing) > 0);
});

test('newestGame skips the excluded id and returns null for an empty list', () => {
  const a = { id: 'a', date: '2026-01-01', createdAt: ts(1) };
  const b = { id: 'b', date: '2026-01-02', createdAt: ts(1) };
  const c = { id: 'c', date: '2026-01-01', createdAt: ts(7) };
  assert.equal(newestGame([a, b, c]), b);
  assert.equal(newestGame([a, b, c], 'b'), c);
  assert.equal(newestGame([], 'x'), null);
  assert.equal(newestGame([a], 'a'), null);
});

test('newerThan returns the later-created same-date game, null when the ended game is the newest, and null when its createdAt is null', () => {
  const ended = { id: 'e', date: 'd', createdAt: ts(5) };
  const later = { id: 'l', date: 'd', createdAt: ts(8) };
  const earlier = { id: 'o', date: 'd', createdAt: ts(2) };
  assert.equal(newerThan(ended, [earlier, ended, later]), 'l');
  assert.equal(newerThan(ended, [earlier, ended]), null);
  assert.equal(newerThan({ ...ended, createdAt: null }, [{ ...later, createdAt: ts(5) }]), null);
});

test("validDocId refuses '', '.', '..', a slash, __x__, and over 1500 bytes", () => {
  for (const bad of ['', '.', '..', 'a/b', '__x__', 'a'.repeat(1501), 'é'.repeat(751)]) {
    assert.equal(validDocId(bad), false, JSON.stringify(bad.slice(0, 10)));
  }
  for (const good of ['abc', '__x', 'x__', 'a'.repeat(1500), 'é'.repeat(750)]) {
    assert.equal(validDocId(good), true);
  }
});

test('parseGamesRoute', () => {
  assert.deepEqual(parseGamesRoute('/games'), { kind: 'list' });
  assert.deepEqual(parseGamesRoute('/games/'), { kind: 'list' });
  assert.deepEqual(parseGamesRoute('/games/abc'), { kind: 'detail', id: 'abc' });
  assert.deepEqual(parseGamesRoute('/games/list'), { kind: 'detail', id: 'list' });
  for (const bad of ['/games/a%2Fb', '/games/%ZZ', '/games/a/b', '/games/__x__']) {
    assert.deepEqual(parseGamesRoute(bad), { kind: 'invalid' }, bad);
  }
});
