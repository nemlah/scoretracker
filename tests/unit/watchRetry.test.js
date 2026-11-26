import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepWatching } from '../../js/watchRetry.js';

const server = { fromCache: false, hasPendingWrites: false };
const cache = { fromCache: true, hasPendingWrites: false };

// A fake clock with timers, plus an `open` that records every attempt.
function harness(options = {}, openImpl) {
  let t = 0;
  let nextId = 1;
  const pending = new Map();
  const timers = {
    setTimeout(fn, ms) {
      const id = nextId++;
      pending.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimeout(id) { pending.delete(id); },
  };
  const advance = ms => {
    const target = t + ms;
    for (;;) {
      let due = null;
      for (const [id, timer] of pending) {
        if (timer.at <= target && (!due || timer.at < due.timer.at)) due = { id, timer };
      }
      if (!due) break;
      pending.delete(due.id);
      t = due.timer.at;
      due.timer.fn();
    }
    t = target;
  };
  const opens = [];
  const open = openImpl
    ? (next, fail) => openImpl({ next, fail, opens, at: t })
    : (next, fail) => {
        const attempt = { next, fail, unsubscribed: 0, at: t };
        opens.push(attempt);
        return () => { attempt.unsubscribed++; };
      };
  const got = [];
  const fails = [];
  const watch = keepWatching(open, {
    onSnapshot: (data, meta) => got.push({ data, meta }),
    onFail: err => fails.push(err),
    random: () => 0.5,
    timers,
    now: () => t,
    ...options,
  });
  return { watch, opens, got, fails, advance, now: () => t, pendingTimers: () => pending.size };
}

// Fails the newest attempt and checks that the reopen comes after exactly `ms`.
function failThenReopenAfter(h, ms) {
  const before = h.opens.length;
  h.opens[before - 1].fail(new Error('boom'));
  h.advance(ms - 1);
  assert.equal(h.opens.length, before, `no reopen before ${ms} ms`);
  h.advance(1);
  assert.equal(h.opens.length, before + 1, `reopen at ${ms} ms`);
}

test('opens once and passes snapshots through', () => {
  const h = harness();
  assert.equal(h.opens.length, 1);
  assert.equal(h.watch.failed(), false);
  h.opens[0].next({ a: 1 }, server);
  h.opens[0].next({ a: 2 }, cache);
  assert.deepEqual(h.got, [{ data: { a: 1 }, meta: server }, { data: { a: 2 }, meta: cache }]);
  h.advance(10 * 60 * 1000);
  assert.equal(h.opens.length, 1);
  assert.equal(h.fails.length, 0);
});

test('a failure calls onFail and reopens after 2 s, 5 s, 15 s, 30 s, then every 60 s', () => {
  const h = harness();
  const err = new Error('boom');
  h.opens[0].fail(err);
  assert.deepEqual(h.fails, [err]);
  assert.equal(h.watch.failed(), true);
  h.advance(1999);
  assert.equal(h.opens.length, 1);
  h.advance(1);
  assert.equal(h.opens.length, 2);
  for (const ms of [5000, 15000, 30000, 60000, 60000, 60000]) failThenReopenAfter(h, ms);
  assert.deepEqual(h.opens.map(o => o.at), [0, 2000, 7000, 22000, 52000, 112000, 172000, 232000]);
});

test('the delay gets the jitter: delay * (1 - jitter + 2 * jitter * random())', () => {
  const low = harness({ jitter: 0.25, random: () => 0 });
  low.opens[0].fail(new Error('x'));
  low.advance(1499);
  assert.equal(low.opens.length, 1);
  low.advance(1);
  assert.equal(low.opens.length, 2);
  const high = harness({ jitter: 0.25, random: () => 1 });
  high.opens[0].fail(new Error('x'));
  high.advance(2499);
  assert.equal(high.opens.length, 1);
  high.advance(1);
  assert.equal(high.opens.length, 2);
  const custom = harness({ jitter: 0.5, delays: [1000, 3000] });
  custom.opens[0].fail(new Error('x'));
  custom.advance(999);
  assert.equal(custom.opens.length, 1);
  custom.advance(1);
  assert.equal(custom.opens.length, 2);
  failThenReopenAfter(custom, 3000);
  failThenReopenAfter(custom, 3000);
});

test('a server snapshot (fromCache false) after a failure clears failed() and restarts at 2 s', () => {
  const h = harness();
  h.opens[0].fail(new Error('x'));
  h.advance(2000);
  failThenReopenAfter(h, 5000);
  assert.equal(h.watch.failed(), true);
  h.opens[2].next({ ok: true }, server);
  assert.equal(h.watch.failed(), false);
  assert.deepEqual(h.got, [{ data: { ok: true }, meta: server }]);
  failThenReopenAfter(h, 2000);
});

test('cached snapshots after a failure never reset the delays', () => {
  const h = harness();
  h.opens[0].fail(new Error('x'));
  h.advance(2000);
  h.opens[1].next({ cached: true }, cache);
  assert.equal(h.watch.failed(), true);
  failThenReopenAfter(h, 5000);
});

test('a snapshot without meta is not a server snapshot', () => {
  const h = harness({ holdCached: true });
  h.opens[0].fail(new Error('x'));
  h.advance(2000);
  h.opens[1].next({ nometa: true });
  assert.equal(h.watch.failed(), true);
  assert.equal(h.got.length, 0);
});

test('holdCached true withholds cached snapshots while failed', () => {
  const h = harness({ holdCached: true });
  h.opens[0].next({ n: 1 }, cache);
  assert.equal(h.got.length, 1, 'healthy: a cached snapshot passes');
  h.opens[0].fail(new Error('x'));
  h.advance(2000);
  h.opens[1].next({ n: 2 }, cache);
  assert.equal(h.got.length, 1, 'failed: held back');
  assert.equal(h.watch.failed(), true);
  h.opens[1].next({ n: 3 }, server);
  assert.deepEqual(h.got.map(g => g.data.n), [1, 3]);
  assert.equal(h.watch.failed(), false);
  h.opens[1].next({ n: 4 }, cache);
  assert.deepEqual(h.got.map(g => g.data.n), [1, 3, 4], 'healthy again: cached passes');
});

test('holdCached false passes cached snapshots on while failed() stays true', () => {
  const h = harness({ holdCached: false });
  h.opens[0].fail(new Error('x'));
  h.advance(2000);
  h.opens[1].next({ n: 1 }, cache);
  assert.deepEqual(h.got.map(g => g.data.n), [1]);
  assert.equal(h.watch.failed(), true);
  h.opens[1].next({ n: 2 }, server);
  assert.deepEqual(h.got.map(g => g.data.n), [1, 2]);
  assert.equal(h.watch.failed(), false);
});

test('startFailed makes the first open after the first delay', () => {
  const h = harness({ startFailed: true, holdCached: true });
  assert.equal(h.opens.length, 0);
  assert.equal(h.watch.failed(), true);
  assert.equal(h.pendingTimers(), 1);
  h.advance(1999);
  assert.equal(h.opens.length, 0);
  h.advance(1);
  assert.equal(h.opens.length, 1);
  assert.equal(h.watch.failed(), true, 'still failed until the server answers');
  h.opens[0].next({ n: 1 }, cache);
  assert.equal(h.got.length, 0, 'cached held back');
  h.opens[0].next({ n: 2 }, server);
  assert.deepEqual(h.got.map(g => g.data.n), [2]);
  assert.equal(h.watch.failed(), false);
  assert.equal(h.fails.length, 0, 'the failure before the start is not reported again');
});

test('startFailed: a failing first open goes on to the second delay', () => {
  const h = harness({ startFailed: true });
  h.advance(2000);
  assert.equal(h.opens.length, 1);
  failThenReopenAfter(h, 5000);
});

test('callbacks of a failed attempt are ignored at once, during the backoff and after the reopen', () => {
  const h = harness();
  const first = h.opens[0];
  first.fail(new Error('one'));
  assert.equal(h.fails.length, 1);
  // Late callbacks during the backoff.
  first.next({ late: 1 }, server);
  first.fail(new Error('two'));
  assert.equal(h.got.length, 0);
  assert.equal(h.fails.length, 1);
  assert.equal(h.watch.failed(), true, 'a late server snapshot does not clear the failure');
  h.advance(2000);
  assert.equal(h.opens.length, 2, 'the late fail scheduled no second reopen');
  // Late callbacks after the reopen.
  first.next({ late: 2 }, server);
  first.fail(new Error('three'));
  assert.equal(h.got.length, 0);
  assert.equal(h.fails.length, 1);
  assert.equal(h.watch.failed(), true);
  h.advance(60000);
  assert.equal(h.opens.length, 2, 'the new attempt was not failed by the old one');
  // The late fail did not advance the step either: the next delay is 5 s.
  failThenReopenAfter(h, 5000);
});

test('retryNow reopens a failed watch at once, cancels the scheduled reopen, is throttled to once per 10 s, and keeps the backoff step', () => {
  const h = harness();
  h.advance(20000);
  h.opens[0].fail(new Error('x')); // step 1: reopen scheduled for 22000
  h.watch.retryNow();
  assert.equal(h.opens.length, 2, 'reopened at once');
  assert.equal(h.opens[1].at, 20000);
  h.advance(2000);
  assert.equal(h.opens.length, 2, 'the scheduled reopen was cancelled');
  // The step was kept: the next failure waits 5 s, not 2 s.
  h.opens[1].fail(new Error('y')); // t = 22000, step 2: 5 s, scheduled for 27000
  h.advance(1000);
  h.watch.retryNow();
  assert.equal(h.opens.length, 2, 'throttled: the last attempt was 3 s ago');
  h.advance(2000); // t = 25000: 3 s after the failure, so a reset step (2 s) would have reopened
  assert.equal(h.opens.length, 2);
  h.advance(2000); // t = 27000
  assert.equal(h.opens.length, 3);
  assert.equal(h.opens[2].at, 27000);
  h.opens[2].fail(new Error('z')); // step 3: 15 s, scheduled for 42000
  h.advance(9999); // t = 36999
  h.watch.retryNow();
  assert.equal(h.opens.length, 3, 'throttled at 9.999 s');
  h.advance(1); // t = 37000
  h.watch.retryNow();
  assert.equal(h.opens.length, 4, 'allowed at 10 s');
  h.advance(10000);
  assert.equal(h.opens.length, 4, 'the cancelled reopen at 42000 never fires');
});

test('retryNow replaces a reopened attempt that is still failed', () => {
  const h = harness();
  h.opens[0].fail(new Error('x'));
  h.advance(2000);
  h.advance(10000);
  assert.equal(h.watch.failed(), true);
  h.watch.retryNow();
  assert.equal(h.opens.length, 3);
  assert.equal(h.opens[1].unsubscribed, 1, 'the replaced attempt is unsubscribed');
  h.opens[1].next({ stale: true }, server);
  assert.equal(h.got.length, 0, 'callbacks of the replaced attempt are ignored');
  assert.equal(h.watch.failed(), true);
});

test('retryNow does nothing while healthy', () => {
  const h = harness();
  h.advance(60000);
  h.watch.retryNow();
  assert.equal(h.opens.length, 1);
  assert.equal(h.opens[0].unsubscribed, 0);
  h.opens[0].fail(new Error('x'));
  h.advance(2000);
  h.opens[1].next({ ok: 1 }, server);
  h.advance(60000);
  h.watch.retryNow();
  assert.equal(h.opens.length, 2, 'healthy again: no reopen');
  assert.equal(h.opens[1].unsubscribed, 0);
});

test('stop unsubscribes, cancels the pending reopen, and ignores later callbacks', () => {
  const h = harness();
  h.watch.stop();
  assert.equal(h.opens[0].unsubscribed, 1);
  h.watch.stop();
  assert.equal(h.opens[0].unsubscribed, 1, 'stop twice unsubscribes once');
  h.opens[0].next({ late: 1 }, server);
  h.opens[0].fail(new Error('late'));
  assert.equal(h.got.length, 0);
  assert.equal(h.fails.length, 0);
  h.advance(120000);
  assert.equal(h.opens.length, 1);

  const f = harness();
  f.opens[0].fail(new Error('x'));
  assert.equal(f.pendingTimers(), 1);
  f.watch.stop();
  assert.equal(f.pendingTimers(), 0, 'the reopen timer is cancelled');
  f.advance(120000);
  f.watch.retryNow();
  assert.equal(f.opens.length, 1);
  assert.equal(f.opens[0].unsubscribed, 1, 'the failed attempt is unsubscribed once, not twice');
});

test('an open that throws counts as a failure', () => {
  const thrown = new Error('open threw');
  let calls = 0;
  const h = harness({}, ({ next, fail, opens, at }) => {
    calls++;
    if (calls === 1) throw thrown;
    const attempt = { next, fail, unsubscribed: 0, at };
    opens.push(attempt);
    return () => { attempt.unsubscribed++; };
  });
  assert.deepEqual(h.fails, [thrown]);
  assert.equal(h.watch.failed(), true);
  h.advance(1999);
  assert.equal(calls, 1);
  h.advance(1);
  assert.equal(calls, 2);
  h.opens[0].next({ ok: 1 }, server);
  assert.equal(h.watch.failed(), false);
  assert.deepEqual(h.got.map(g => g.data.ok), [1]);
});

test('an unsubscribe returned after a synchronous fail is called, and late callbacks are ignored', () => {
  let unsubscribed = 0;
  let saved = null;
  let calls = 0;
  const h = harness({}, ({ next, fail }) => {
    calls++;
    if (calls === 1) {
      saved = { next, fail };
      fail(new Error('sync'));
      next({ late: 1 }, server);
    }
    return () => { unsubscribed++; };
  });
  assert.equal(h.fails.length, 1);
  assert.equal(unsubscribed, 1, 'called once the opener returned it');
  assert.equal(h.got.length, 0);
  assert.equal(h.watch.failed(), true);
  saved.next({ later: 1 }, server);
  assert.equal(h.got.length, 0);
  h.advance(2000);
  assert.equal(calls, 2);
  assert.equal(unsubscribed, 1, 'the second attempt is still open');
});

test('startFailed: an early retryNow does not skip the first delay', () => {
  const h = harness({ startFailed: true });
  h.advance(500);
  h.watch.retryNow();
  assert.equal(h.opens.length, 0, 'throttled: the construction counts as the last attempt');
  h.advance(1499);
  assert.equal(h.opens.length, 0);
  h.advance(1);
  assert.equal(h.opens.length, 1, 'the initial timer stayed in force');
  assert.equal(h.opens[0].at, 2000);

  const slow = harness({ startFailed: true, delays: [60000] });
  slow.advance(9999);
  slow.watch.retryNow();
  assert.equal(slow.opens.length, 0, 'still throttled at 9.999 s');
  slow.advance(1);
  slow.watch.retryNow();
  assert.equal(slow.opens.length, 1, 'allowed once minRetryNowMs has passed');
  slow.advance(60000);
  assert.equal(slow.opens.length, 1, 'the initial timer was cancelled');
});

// An opener whose unsubscribe for attempt number `index` (0-based) runs `onUnsubscribe` once.
function reentrantHarness(index, onUnsubscribe, options = {}) {
  const ref = {};
  let ran = false;
  ref.h = harness(options, ({ next, fail, opens, at }) => {
    const attempt = { next, fail, unsubscribed: 0, at };
    const mine = opens.length;
    opens.push(attempt);
    return () => {
      attempt.unsubscribed++;
      if (mine === index && !ran) { ran = true; onUnsubscribe(ref.h); }
    };
  });
  return ref.h;
}

test('an unsubscribe that calls stop() leaves nothing opened or scheduled (after a failure)', () => {
  const h = reentrantHarness(0, x => x.watch.stop());
  h.opens[0].fail(new Error('x'));
  assert.equal(h.opens[0].unsubscribed, 1);
  assert.equal(h.pendingTimers(), 0, 'no reopen queued after stop');
  h.advance(120000);
  assert.equal(h.opens.length, 1);
});

test('an unsubscribe that calls stop() during a replacement opens nothing', () => {
  const h = reentrantHarness(1, x => x.watch.stop());
  h.opens[0].fail(new Error('x'));
  h.advance(12000); // the reopen at 2 s is still failed
  assert.equal(h.opens.length, 2);
  h.watch.retryNow();
  assert.equal(h.opens[1].unsubscribed, 1);
  assert.equal(h.opens.length, 2, 'no listener opened after stop');
  assert.equal(h.pendingTimers(), 0);
  h.opens[1].next({ late: 1 }, server);
  assert.equal(h.got.length, 0);
  h.advance(120000);
  assert.equal(h.opens.length, 2);
});

test('an unsubscribe that calls retryNow() during a replacement leaves exactly one live listener', () => {
  const h = reentrantHarness(1, x => x.watch.retryNow(), { minRetryNowMs: 0 });
  h.opens[0].fail(new Error('x'));
  h.advance(2000);
  assert.equal(h.opens.length, 2);
  h.watch.retryNow();
  assert.equal(h.opens.length, 3, 'one new attempt, not two');
  assert.deepEqual(h.opens.map(o => o.unsubscribed), [1, 1, 0], 'only the newest is live');
  h.opens[1].next({ stale: true }, server);
  assert.equal(h.got.length, 0);
  h.opens[2].next({ fresh: true }, server);
  assert.deepEqual(h.got.map(g => g.data), [{ fresh: true }]);
});

test('an empty or invalid delays option falls back to the default delays', () => {
  for (const delays of [[], 'x', null, 5]) {
    const h = harness({ delays });
    h.opens[0].fail(new Error('x'));
    h.advance(1999);
    assert.equal(h.opens.length, 1, `delays ${JSON.stringify(delays)}`);
    h.advance(1);
    assert.equal(h.opens.length, 2, `delays ${JSON.stringify(delays)}`);
  }
});

test('onFail is not delivered for an attempt a re-entrant retryNow already superseded and recovered', () => {
  let watch = null;
  let calls = 0;
  const h = harness({ minRetryNowMs: 0 }, ({ next, fail, opens, at }) => {
    const mine = calls++;
    const attempt = { next, fail, unsubscribed: 0, at };
    opens.push(attempt);
    if (mine === 1) next({ recovered: true }, server); // synchronous server snapshot
    return () => {
      attempt.unsubscribed++;
      if (mine === 0) watch.retryNow(); // cleanup of the failing attempt re-enters
    };
  });
  watch = h.watch;
  h.opens[0].fail(new Error('old'));
  assert.equal(h.opens.length, 2, 'the re-entrant retry opened the second attempt');
  assert.deepEqual(h.got.map(g => g.data), [{ recovered: true }]);
  assert.equal(h.watch.failed(), false);
  assert.equal(h.fails.length, 0, 'no stale onFail after the recovery');
  assert.equal(h.pendingTimers(), 0, 'the cancelled reopen stays cancelled');
});

test('onFail is not delivered for a superseded attempt that has not recovered either', () => {
  let watch = null;
  let calls = 0;
  const h = harness({ minRetryNowMs: 0 }, ({ next, fail, opens, at }) => {
    const mine = calls++;
    const attempt = { next, fail, unsubscribed: 0, at };
    opens.push(attempt);
    return () => {
      attempt.unsubscribed++;
      if (mine === 0) watch.retryNow();
    };
  });
  watch = h.watch;
  h.opens[0].fail(new Error('old'));
  assert.equal(h.opens.length, 2);
  assert.equal(h.fails.length, 0);
  assert.equal(h.watch.failed(), true);
  h.opens[1].fail(new Error('new'));
  assert.equal(h.fails.length, 1, 'a failure of the newest attempt is still reported');
});
