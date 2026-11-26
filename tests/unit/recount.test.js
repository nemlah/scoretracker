import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRedrain, recountAfter, wrapDrain } from '../../js/tracker/recount.js';

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

test('a drain run by the timer reaches after() through the wrapped drain, and schedules the next timer', async () => {
  const clock = fakeTimers();
  const results = [{ done: [], failed: ['2026-27'] }, { done: [], failed: ['2026-27'] }];
  let queueRuns = 0;
  let afterCalls = 0;
  const redrain = createRedrain({
    drain: () => wrapped(),
    isActive: () => true,
    hasDirty: () => true,
    timers: clock.timers,
  });
  const wrapped = wrapDrain(
    () => Promise.resolve(results[queueRuns++]),
    result => { afterCalls++; redrain.after(result); },
  );
  await wrapped();
  assert.deepEqual(clock.scheduled, [60000]);
  clock.fire();
  // The timer's drain settles on the microtask queue; the next timer is the positive end condition.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(queueRuns, 2, 'the timer ran the queue');
  assert.equal(afterCalls, 2, 'its result was forwarded');
  assert.deepEqual(clock.scheduled, [60000, 60000]);
  assert.equal(clock.pending.size, 1);
});

test('the timer itself schedules nothing: without a forwarded result no next timer exists', () => {
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

test('wrapDrain: overlapping callers share one wrapped promise and the result is handled once', async () => {
  const shared = Promise.resolve({ done: [], failed: ['2026-27'] });
  const seen = [];
  const drain = wrapDrain(() => shared, result => seen.push(result));
  const first = drain();
  const second = drain();
  assert.equal(first, second);
  assert.deepEqual(await first, { done: [], failed: ['2026-27'] });
  await second;
  assert.equal(seen.length, 1);
  assert.equal(seen[0].failed[0], '2026-27');
});

test('wrapDrain: a later drain on a new queue promise is a new result', async () => {
  const seen = [];
  let n = 0;
  const drain = wrapDrain(() => Promise.resolve({ done: [], failed: [`s${n++}`] }), result => seen.push(result.failed[0]));
  await drain();
  await drain();
  assert.deepEqual(seen, ['s0', 's1']);
});

test('wrapDrain: a throwing observer does not fail the drain', async () => {
  const drain = wrapDrain(() => Promise.resolve({ done: ['x'], failed: [] }), () => { throw new Error('observer'); });
  assert.deepEqual(await drain(), { done: ['x'], failed: [] });
});

// The detached settle chain has no consumer, so its failures must be caught and logged.
async function withUnhandledWatch(t, body) {
  const unhandled = [];
  const listener = reason => unhandled.push(reason);
  process.on('unhandledRejection', listener);
  const warn = t.mock.method(console, 'warn', () => {});
  try {
    await body();
    // unhandledRejection is emitted after the microtask queue drains; one macrotask covers it.
    await new Promise(resolve => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', listener);
  }
  return { unhandled, warn };
}

test('a drain that rejects after the write is logged, not unhandled, and the write still resolves', async t => {
  const ctx = fakeCtx();
  ctx.stats.drain = () => Promise.reject(new Error('drain failed'));
  let outcome;
  const { unhandled, warn } = await withUnhandledWatch(t, async () => {
    outcome = await recountAfter(ctx, '2026-27', Promise.resolve('written'));
  });
  assert.equal(outcome, 'written');
  assert.deepEqual(unhandled, []);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0].arguments[1]), /drain failed/);
});

test('a mark that throws after a rejected write is logged, not unhandled, and the write still rejects', async t => {
  const ctx = fakeCtx();
  let marks = 0;
  ctx.stats.markDirty = () => { if (++marks > 1) throw new Error('storage full'); };
  let rejection;
  const { unhandled, warn } = await withUnhandledWatch(t, async () => {
    await recountAfter(ctx, '2026-27', Promise.reject(new Error('denied'))).catch(error => { rejection = error; });
  });
  assert.match(rejection.message, /denied/);
  assert.deepEqual(unhandled, []);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0].arguments[1]), /storage full/);
});
