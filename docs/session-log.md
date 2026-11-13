# Session log

## 13/11/2026 - Task 8: new game and live tracking
- Done: `js/tracker/taps.js` (journal-first tapper, per-device duplicate guard, undo, retry/discard), New game and Live views, app-level game watcher with journal reconcile, failed-taps banner.
- Reconcile waits while event writes are in flight (app.js `trackWrite`), so a snapshot taken before the SDK applies a fresh tap cannot mark it failed.
- Live tiles are updated in place so a snapshot never replaces a button mid-tap.
- `events-open` calls the optional `ctx.openEvents`; Task 9 must define it.
- Next: Task 9 (events sheet, lineup edits, end/reopen/delete, past games, stats queue).
