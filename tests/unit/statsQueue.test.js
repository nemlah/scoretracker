import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStatsQueue } from '../../js/tracker/statsQueue.js';

function fakeStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}
const stored = storage => JSON.parse(storage.getItem('wp-stats-dirty'));

test('markDirty dedupes and persists', () => {
  const storage = fakeStorage();
  const queue = createStatsQueue(storage, async () => {});
  queue.markDirty('2025-26');
  queue.markDirty('2026-27');
  queue.markDirty('2025-26');
  assert.deepEqual(queue.dirty(), ['2025-26', '2026-27']);
  assert.deepEqual(stored(storage), ['2025-26', '2026-27']);
  // A new queue on the same storage starts from what was persisted.
  assert.deepEqual(createStatsQueue(storage, async () => {}).dirty(), ['2025-26', '2026-27']);
});

test('drain removes successes, keeps failures', async () => {
  const storage = fakeStorage();
  const queue = createStatsQueue(storage, async season => {
    if (season === '2025-26') throw new Error('offline');
  });
  queue.markDirty('2025-26');
  queue.markDirty('2026-27');
  assert.deepEqual(await queue.drain(), { done: ['2026-27'], failed: ['2025-26'] });
  assert.deepEqual(queue.dirty(), ['2025-26']);
  assert.deepEqual(stored(storage), ['2025-26']);
});

test('concurrent drain shares one run', async () => {
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const queue = createStatsQueue(fakeStorage(), async season => { calls.push(season); await gate; });
  queue.markDirty('2025-26');
  queue.markDirty('2026-27');
  const first = queue.drain();
  const second = queue.drain();
  assert.equal(first, second);
  release();
  assert.deepEqual(await first, { done: ['2025-26', '2026-27'], failed: [] });
  assert.deepEqual(calls, ['2025-26', '2026-27']);
  assert.deepEqual(queue.dirty(), []);
  // The next drain is a fresh run.
  assert.notEqual(queue.drain(), first);
});

test('a season marked again while it is being recomputed stays dirty and is run again', async () => {
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const queue = createStatsQueue(fakeStorage(), async season => {
    calls.push(season);
    if (calls.length === 1) await gate;
  });
  queue.markDirty('2025-26');
  const run = queue.drain();
  queue.markDirty('2025-26');
  queue.markDirty('2026-27');
  release();
  assert.deepEqual(await run, { done: ['2025-26', '2026-27'], failed: [] });
  assert.deepEqual(calls, ['2025-26', '2025-26', '2026-27']);
  assert.deepEqual(queue.dirty(), []);
});

test('unavailable or corrupt storage still works in memory', async () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const queue = createStatsQueue(broken, async () => {});
  queue.markDirty('2025-26');
  assert.deepEqual(queue.dirty(), ['2025-26']);
  assert.deepEqual(await queue.drain(), { done: ['2025-26'], failed: [] });
  const corrupt = fakeStorage();
  corrupt.setItem('wp-stats-dirty', '{not json');
  assert.deepEqual(createStatsQueue(corrupt, async () => {}).dirty(), []);
  corrupt.setItem('wp-stats-dirty', JSON.stringify([1, '2025-26']));
  assert.deepEqual(createStatsQueue(corrupt, async () => {}).dirty(), []);
});

test('a season marked right after a drain that had nothing to do is still drained', async () => {
  const calls = [];
  const queue = createStatsQueue(fakeStorage(), async season => { calls.push(season); });
  const first = queue.drain();
  queue.markDirty('2026-27');
  const second = queue.drain();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['2026-27']);
  assert.deepEqual(queue.dirty(), []);
});
