import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recountAfter } from '../../js/tracker/recount.js';

function fakeCtx() {
  const calls = [];
  return {
    calls,
    stats: {
      markDirty: season => calls.push(['mark', season]),
      drain: () => { calls.push(['drain']); return Promise.resolve(); },
    },
  };
}

test('marks and drains at once, and again after the write succeeds', async () => {
  const ctx = fakeCtx();
  let finish;
  const write = new Promise(resolve => { finish = resolve; });
  const returned = recountAfter(ctx, '2026-27', write);
  assert.deepEqual(ctx.calls, [['mark', '2026-27'], ['drain']]);
  finish();
  await returned;
  await Promise.resolve();
  assert.deepEqual(ctx.calls, [['mark', '2026-27'], ['drain'], ['mark', '2026-27'], ['drain']]);
});

test('a rejected write still leaves the season marked and drained once', async () => {
  const ctx = fakeCtx();
  const returned = recountAfter(ctx, '2026-27', Promise.reject(new Error('denied')));
  await assert.rejects(returned, /denied/);
  await Promise.resolve();
  assert.deepEqual(ctx.calls, [['mark', '2026-27'], ['drain']]);
});

test('several seasons are all marked and drained, then marked again after the write', async () => {
  const ctx = fakeCtx();
  const returned = recountAfter(ctx, ['2025-26', '2026-27', '2025-26'], Promise.resolve());
  assert.deepEqual(ctx.calls, [['mark', '2025-26'], ['mark', '2026-27'], ['drain']]);
  await returned;
  await Promise.resolve();
  assert.deepEqual(ctx.calls.slice(3), [['mark', '2025-26'], ['mark', '2026-27'], ['drain']]);
});
