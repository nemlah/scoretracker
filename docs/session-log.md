# Session log

## 13/11/2026 - Task 9: events sheet, lineup edits, end/reopen/delete, past games, stats recompute
- Done: `js/tracker/statsQueue.js` (persisted dirty seasons, drain shares one run), `recount.js` (mark dirty now, drain once the write is answered), events dialog/panel, lineup editor, past games list and detail, in-page confirm and overlay helpers in `js/ui/`.
- `ctx.stats` is created in app.js; it drains on becoming active (boot or takeover) and on `online`. Every journal-recorded write on any game is now reconciled: app.js keeps one snapshot record per game subscription.
- Live period button refuses a second tap for 1 s (same as Undo); tile label reads "1 goal".
- Overlays live inside the view root, so unmounting the view removes them; Safari does not focus a tapped button, so `overlay.open(from)` takes the opener explicitly.
- Next: Task 10.

## 13/11/2026 - Task 8: new game and live tracking
- Done: `js/tracker/taps.js` (journal-first tapper, per-device duplicate guard, undo, retry/discard), New game and Live views, app-level game watcher with journal reconcile, failed-taps banner.
- Reconcile waits while event writes are in flight (app.js `trackWrite`), so a snapshot taken before the SDK applies a fresh tap cannot mark it failed.
- Live tiles are updated in place so a snapshot never replaces a button mid-tap.
- `events-open` calls the optional `ctx.openEvents`; Task 9 must define it.
- Next: Task 9 (events sheet, lineup edits, end/reopen/delete, past games, stats queue).

## 13/11/2026 - Task 10: service worker and offline/takeover e2e
- Done: `sw.js` (CACHE `wp-shell-v1`, SHELL between markers; same-origin network-first, gstatic SDK and Google Fonts cache-first, Firestore/Auth untouched), `js/sw-register.js` imported by both entry modules.
- `tests/unit/sw-shell.test.js` keeps SHELL in sync with the files on disk and the import maps; add new js/css files to SHELL or it fails.
- `tests/e2e/offline.spec.js` (chromium only): offline reload into the live game, viewer connection-note, viewer offline shell, takeover with a real rejected write then Retry.
- `tracker-helpers` noise filter now also drops Firestore's "Could not reach Cloud Firestore backend" log.
- Next: Task 11.
