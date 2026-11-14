# Session log

## 13/11/2026 - Where we left off (whole build)
- Built on branch `feat/scoretracker`: public viewer (`index.html`), code-locked tracker (`track.html`), Firestore rules, offline app shell, README. All 11 plan tasks done, plus one fix wave from the final reviews (Codex and Opus).
- Tests at the end: unit 105/105, emulator 28/28, e2e 141 passed / 13 skipped (chromium-only offline specs on webkit). JDK 21 is keg-only: `export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"`.
- Not merged or pushed. Next steps for the owner, in README order:
  - create the Firebase project; enable Anonymous auth; create Firestore in eur3;
  - paste `firestore.rules`; create `secrets/editCode` (6 chars, 0-9A-Z);
  - fill in `js/config.js` (and the matching `<title>`s); push; enable Pages.
- Verify on the real tracker iPhone before the first game: unlock, tap, background/foreground, airplane mode on/off. Playwright can't cover a real Safari bfcache restore or iOS storage eviction.
- Design and plan: `docs/superpowers/specs/2026-11-13-waterpolo-scoretracker-design.md`, `docs/superpowers/plans/2026-11-13-waterpolo-scoretracker.md`.

## 14/11/2026 - Merged to main; open follow-ups
Merged `feat/scoretracker` into `main` (fast-forward). Unit 105, emulator 28 and e2e 141 tests pass, 13 skipped.
Four issues from the final review were parked; fix them before the first real game:
1. `repo.endGame` (js/repo.js ~176) waits up to 2 s for a server lookup before it queues the batch, and events.js navigates away right away. Closing the tab in that window loses the end, and the game stays Live. Queue the status write first, then repoint as a separate step.
2. The recount repair on becoming active (js/tracker/app.js ~345/366) is skipped when the first game snapshot is a cached `null`. Wait for a server-confirmed snapshot.
3. Auto-resume to `#/live` (app.js ~385) has the same cached-`null` cause. Same fix.
4. The endGame repoint is best-effort while offline and nothing retries it. Retry it on reconnect, or let the viewer pick the newest live game.

## 14/11/2026 - Live on Firebase
- `js/config.js` now points at Firebase project `score-tracker-1be7c` (commit ddc69d6). `measurementId` was left out because the site doesn't load Analytics.
- Live check in headless Chromium at https://nemlah.github.io/scoretracker/: the tracker reaches the unlock screen, the viewer shows "No game yet", and neither page logs a console error.
- Owner's console steps so far: project created, web app registered, Anonymous enabled, authorized domain added. Firestore, the rules and `secrets/editCode` are the owner's to confirm; the code was not shared or tested here.
- Still to do:
  - Team name and accent, in 3 places: `js/config.js` and both `<title>` tags.
  - Optionally, an API-key referrer restriction.
  - The 4 parked issues listed below.
  - A real-phone run before the first game.

## 13/11/2026 - Task 8: new game and live tracking
- Done: `js/tracker/taps.js` (journal-first tapper, per-device duplicate guard, undo, retry/discard), New game and Live views, app-level game watcher with journal reconcile, failed-taps banner.
- Reconcile waits while event writes are in flight (app.js `trackWrite`), so a snapshot taken before the SDK applies a fresh tap cannot mark it failed.
- Live tiles are updated in place so a snapshot never replaces a button mid-tap.
- `events-open` calls the optional `ctx.openEvents`; Task 9 must define it.
- Next: Task 9 (events sheet, lineup edits, end/reopen/delete, past games, stats queue).

## 13/11/2026 - Task 9: events sheet, lineup edits, end/reopen/delete, past games, stats recompute
- Done: `js/tracker/statsQueue.js` (persisted dirty seasons, drain shares one run), `recount.js` (mark dirty now, drain once the write is answered), events dialog/panel, lineup editor, past games list and detail, in-page confirm and overlay helpers in `js/ui/`.
- `ctx.stats` is created in app.js; it drains on becoming active (boot or takeover) and on `online`. Every journal-recorded write on any game is now reconciled: app.js keeps one snapshot record per game subscription.
- Live period button refuses a second tap for 1 s (same as Undo); tile label reads "1 goal".
- Overlays live inside the view root, so unmounting the view removes them; Safari does not focus a tapped button, so `overlay.open(from)` takes the opener explicitly.
- Next: Task 10.

## 13/11/2026 - Task 10: service worker and offline/takeover e2e
- Done: `sw.js` (CACHE `wp-shell-v1`, SHELL between markers; same-origin network-first, gstatic SDK and Google Fonts cache-first, Firestore/Auth untouched), `js/sw-register.js` imported by both entry modules.
- `tests/unit/sw-shell.test.js` keeps SHELL in sync with the files on disk and the import maps; add new js/css files to SHELL or it fails.
- `tests/e2e/offline.spec.js` (chromium only): offline reload into the live game, viewer connection-note, viewer offline shell, takeover with a real rejected write then Retry.
- `tracker-helpers` noise filter now also drops Firestore's "Could not reach Cloud Firestore backend" log.
- Next: Task 11.
