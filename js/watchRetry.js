// Keeps a Firestore listener alive. `open(next, fail)` subscribes and returns an unsubscribe;
// `next(data, meta)` gets the repo's `meta` ({ fromCache, hasPendingWrites }). When a listener
// fails (or `open` throws), it is reopened after a growing delay, and never gives up while kept.
//
// "Failed" starts at the first failure and ends only at a snapshot with `fromCache === false`:
// a cached answer proves nothing about the server, so it neither clears the failure nor resets
// the backoff. With `holdCached`, cached snapshots are withheld while failed.
//
// Pure: no imports, no DOM, no Firebase. Timers and the clock are injectable.

const DEFAULT_DELAYS = [2000, 5000, 15000, 30000, 60000];

export function keepWatching(open, options = {}) {
  const {
    onSnapshot = () => {},
    onFail = () => {},
    holdCached = false,
    startFailed = false,
    delays: givenDelays = DEFAULT_DELAYS,
    jitter = 0.2,
    random = Math.random,
    timers = { setTimeout, clearTimeout },
    now = Date.now,
    minRetryNowMs = 10000,
  } = options;
  const delays = Array.isArray(givenDelays) && givenDelays.length > 0 ? givenDelays : DEFAULT_DELAYS;
  // Called unbound on purpose: a browser's setTimeout throws when `this` is not the window.
  const { setTimeout: setTimer, clearTimeout: clearTimer } = timers;

  let failedNow = startFailed;
  let step = 0; // index into delays; advances on a failure, resets on a server snapshot
  let stopped = false;
  let token = 0; // identifies the live attempt; 0 means none
  let counter = 0;
  let unsubscribe = null;
  let timer = null;
  // With startFailed the construction counts as the last attempt, so an early retryNow() cannot
  // skip the first delay.
  let lastOpenAt = startFailed ? now() : -Infinity;

  function release(unsub) {
    // An unsubscribe that throws must not stop the retry from being scheduled.
    try { if (typeof unsub === 'function') unsub(); } catch { /* nothing to do */ }
  }

  function cancelTimer() {
    if (timer !== null) { clearTimer(timer); timer = null; }
  }

  function schedule() {
    cancelTimer();
    if (stopped) return;
    const base = delays[Math.min(step, delays.length - 1)];
    step++;
    timer = setTimer(() => { timer = null; attempt(); }, base * (1 - jitter + 2 * jitter * random()));
  }

  // Ends the live attempt (if any) so its callbacks are ignored from now on, and hands back its
  // unsubscribe. The caller reserves its own state first and only then calls the unsubscribe:
  // the cleanup may re-enter stop() or retryNow().
  function takeAttempt() {
    token = 0;
    const unsub = unsubscribe;
    unsubscribe = null;
    return unsub;
  }

  function attempt() {
    const old = takeAttempt();
    const mine = ++counter;
    token = mine; // reserved before the old cleanup runs
    lastOpenAt = now();
    release(old);
    // The cleanup stopped the watch, or re-entered and opened a newer attempt.
    if (stopped || token !== mine) return;

    const next = (data, meta) => {
      if (stopped || token !== mine) return;
      if (meta?.fromCache === false) {
        failedNow = false;
        step = 0;
      } else if (failedNow && holdCached) {
        return;
      }
      onSnapshot(data, meta);
    };
    const fail = err => {
      if (stopped || token !== mine) return;
      const unsub = takeAttempt();
      failedNow = true;
      schedule(); // before the cleanup: a stop() in it then cancels this timer
      release(unsub);
      // The cleanup may have stopped the watch or re-entered retryNow(), which opened a newer
      // attempt (maybe already recovered): this failure is then stale and is not reported.
      if (!stopped && counter === mine) onFail(err);
    };

    let unsub;
    try {
      unsub = open(next, fail);
    } catch (err) {
      fail(err);
      return;
    }
    if (stopped || token !== mine) release(unsub); // failed or stopped before open returned
    else unsubscribe = unsub;
  }

  if (startFailed) schedule();
  else attempt();

  return {
    retryNow() {
      if (stopped || !failedNow) return;
      if (now() - lastOpenAt < minRetryNowMs) return;
      cancelTimer();
      attempt();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      cancelTimer();
      release(takeAttempt());
    },
    failed: () => failedNow,
  };
}
