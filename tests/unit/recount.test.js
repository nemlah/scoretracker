import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRedrain, recountAfter } from '../../js/tracker/recount.js';

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

test('marks at once without draining, then marks again and drains once after the write succeeds', async () => {
  const ctx = fakeCtx();
  let finish;
  const write = new Promise(resolve => { finish = resolve; });
  const returned = recountAfter(ctx, '2026-27', write);
  assert.deepEqual(ctx.calls, [['mark', '2026-27']]);
  finish();
  await returned;
  await Promise.resolve();
  assert.deepEqual(ctx.calls, [['mark', '2026-27'], ['mark', '2026-27'], ['drain']]);
});

test('a rejected write marks again and drains once, and the returned promise still rejects', async () => {
  const ctx = fakeCtx();
  const returned = recountAfter(ctx, '2026-27', Promise.reject(new Error('denied')));
  assert.deepEqual(ctx.calls, [['mark', '2026-27']]);
  await assert.rejects(returned, /denied/);
  await Promise.resolve();
  assert.deepEqual(ctx.calls, [['mark', '2026-27'], ['mark', '2026-27'], ['drain']]);
});

test('several seasons: each marked at once and again, then one drain', async () => {
  const ctx = fakeCtx();
  const returned = recountAfter(ctx, ['2025-26', '2026-27', '2025-26'], Promise.resolve());
  assert.deepEqual(ctx.calls, [['mark', '2025-26'], ['mark', '2026-27']]);
  await returned;
  await Promise.resolve();
  assert.deepEqual(ctx.calls, [
    ['mark', '2025-26'], ['mark', '2026-27'],
    ['mark', '2025-26'], ['mark', '2026-27'],
    ['drain'],
  ]);
});

test('a write that has not settled is never drained, however long it takes', async () => {
  const ctx = fakeCtx();
  recountAfter(ctx, '2026-27', new Promise(() => {}));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(ctx.calls, [['mark', '2026-27']]);
});

// A timers pair that records what was scheduled and fires only when the test says so.
function fakeTimers() {
  const pending = new Map();
  const scheduled = [];
  const cleared = [];
  let next = 1;
  return {
    scheduled,
    cleared,
    pending,
    timers: {
      setTimeout(fn, ms) {
        const id = next++;
        scheduled.push(ms);
        pending.set(id, fn);
        return id;
      },
      clearTimeout(id) { cleared.push(id); pending.delete(id); },
    },
    fire() {
      const entries = [...pending.entries()];
      pending.clear();
      entries.forEach(([, fn]) => fn());
    },
  };
}

function redrainWith(overrides = {}) {
  const clock = fakeTimers();
  const state = { active: true, dirty: true, drains: 0 };
  const redrain = createRedrain({
    drain: () => { state.drains++; return Promise.resolve(); },
    isActive: () => state.active,
    hasDirty: () => state.dirty,
    timers: clock.timers,
    ...overrides,
  });
  return { clock, state, redrain };
}

test('createRedrain schedules one drain 60 s after a result with failed seasons while active', () => {
  const { clock, state, redrain } = redrainWith();
  redrain.after({ done: ['2025-26'], failed: ['2026-27'] });
  assert.deepEqual(clock.scheduled, [60000]);
  assert.equal(state.drains, 0);
  clock.fire();
  assert.equal(state.drains, 1);
});

test('createRedrain honours delayMs', () => {
  const { clock, redrain } = redrainWith({ delayMs: 5 });
  redrain.after({ done: [], failed: ['2026-27'] });
  assert.deepEqual(clock.scheduled, [5]);
});

test('createRedrain does not schedule when inactive or nothing failed, and keeps one timer at a time', () => {
  const { clock, state, redrain } = redrainWith();
  redrain.after({ done: ['2026-27'], failed: [] });
  redrain.after({ done: [], failed: [] });
  redrain.after(undefined);
  assert.deepEqual(clock.scheduled, []);
  state.active = false;
  redrain.after({ done: [], failed: ['2026-27'] });
  assert.deepEqual(clock.scheduled, []);
  state.active = true;
  redrain.after({ done: [], failed: ['2026-27'] });
  redrain.after({ done: [], failed: ['2026-27'] });
  redrain.after({ done: [], failed: ['2025-26', '2026-27'] });
  assert.deepEqual(clock.scheduled, [60000]);
  assert.equal(clock.pending.size, 1);
  clock.fire();
  assert.equal(state.drains, 1);
});

test('when its timer fires it calls drain only if still active and dirty', () => {
  const { clock, state, redrain } = redrainWith();
  redrain.after({ done: [], failed: ['2026-27'] });
  state.active = false;
  clock.fire();
  assert.equal(state.drains, 0, 'not active any more');

  state.active = true;
  redrain.after({ done: [], failed: ['2026-27'] });
  state.dirty = false;
  clock.fire();
  assert.equal(state.drains, 0, 'nothing left dirty');

  state.dirty = true;
  redrain.after({ done: [], failed: ['2026-27'] });
  clock.fire();
  assert.equal(state.drains, 1);
});

test('after the timer fires, a new failed result schedules the next one', () => {
  const { clock, redrain } = redrainWith();
  redrain.after({ done: [], failed: ['2026-27'] });
  clock.fire();
  redrain.after({ done: [], failed: ['2026-27'] });
  assert.deepEqual(clock.scheduled, [60000, 60000]);
});

test('the timer itself does not schedule again: only a result passed to after() does', () => {
  const { clock, state, redrain } = redrainWith();
  redrain.after({ done: [], failed: ['2026-27'] });
  clock.fire();
  assert.equal(state.drains, 1);
  assert.deepEqual(clock.scheduled, [60000]);
  assert.equal(clock.pending.size, 0);
});

test('stop cancels the pending timer, so it never drains', () => {
  const { clock, state, redrain } = redrainWith();
  redrain.after({ done: [], failed: ['2026-27'] });
  redrain.stop();
  assert.equal(clock.pending.size, 0);
  clock.fire();
  assert.equal(state.drains, 0);
  assert.equal(clock.cleared.length, 1);
});

test('a drain that throws or rejects inside the timer is swallowed', async () => {
  const thrower = redrainWith({ drain: () => { throw new Error('sync'); } });
  thrower.redrain.after({ done: [], failed: ['2026-27'] });
  assert.doesNotThrow(() => thrower.clock.fire());
  const rejecter = redrainWith({ drain: () => Promise.reject(new Error('async')) });
  rejecter.redrain.after({ done: [], failed: ['2026-27'] });
  rejecter.clock.fire();
  await Promise.resolve();
  await Promise.resolve();
});

test('createRedrain works with the default timers (a real timer is never left running)', () => {
  const redrain = createRedrain({ drain: () => {}, isActive: () => true, hasDirty: () => true });
  redrain.after({ done: [], failed: ['2026-27'] });
  redrain.stop();
});
