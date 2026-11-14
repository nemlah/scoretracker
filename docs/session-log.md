# Session log

## 15/11/2026 - Viewer foul badges + goal celebration live (main da754d6)
- Viewer timeline: grey E (exclusion) / P (penalty foul) badges; 🟥 + "· out" only on the foul that brings a player to 3 (`foulOutIds` in js/model.js).
- Goal celebration (js/celebrate.js, firing rules in js/goalWatch.js): wave, droplets, yellow-and-blue ball into a net, "GOAL!" + scorer (+ "· man-up"), 2.5 s, tap to close, reduce-motion = banner only, landscape layout keeps the score clear. Never on load/reload, Undo, scorer change, opponent goals, final games.
- Hardening from review: viewer degrades (no blank page) if a phone mixes old cached and new modules; SW install now re-fetches same-origin shell files with cache 'reload'.
- Spec/plan: docs/superpowers/specs|plans/2026-11-14-viewer-icons-goal-celebration*. Tests: unit 164, emulator 28, e2e 229 / 13 skipped.
- Known flake: 1 e2e failure in 1 of 3 full runs, not reproduced (incl. under CPU load). Suspect offline.spec "viewer reopens offline" hitting real Google Fonts. Next time: run with --reporter=list to capture the name, then stub fonts in e2e.
- Live check 15/11 (375 px): Delfin 11–14 shows 4 E, 2 P, 1 🟥; celebration hidden on load; no console errors.
- Next: the 4 parked tracker issues from 14/11 (repo.endGame first).

## 14/11/2026 - Man-up / man-down live (merged to main, 07cd830)
- All 6 plan tasks done plus one final-review fix wave; head 97cd61e. Tasks 1–3 Codex, 4–6 sonnet, Codex review per task, Opus whole-branch review ("ready to merge").
- Tests on 97cd61e: unit 149, emulator 28, e2e 203 passed / 13 skipped / 0 failed.
- Fixed in review: PEN narrower than EXCL on narrow phones; results rows overflowing at 360 px; Man-up goal box staying ticked after an orphan end; tiles shifting 5 px when the tint opened (now inset box-shadows).
- Left as is: red/green tint differs mainly by hue (button text and header figures carry the state).
- Deploy step: merge + push only when no game is live; then open track.html and index.html once on Wi-Fi on every phone and close old tracker tabs before the next game (old cached modules + new journal.js would fail to start the tracker; an old tracker tab would wipe a journal holding new tap types).
- Merged (fast-forward) and pushed 14/11; Pages served it ~30 s later. Live check (headless, 375 px): ΡΟΗ shows "Man-up —"/"Man-down —", results row "—", no season line, no sideways scroll, no console errors; tracker reaches unlock.
- Next: owner opens tracker + viewer on Wi-Fi on every phone before the next game; then the 4 parked tracker issues from 14/11 (repo.endGame first).

## 14/11/2026 - Man-up / man-down: design and plan (branch feat/man-up)
- Spec: `docs/superpowers/specs/2026-11-14-man-up-man-down-design.md` (approved). Plan: `docs/superpowers/plans/2026-11-14-man-up-man-down.md` (6 tasks), waiting for the owner's review.
- What it adds: MAN-UP toggle (our goal = scored, end tap or any other event = missed), man-down opened by EXCL (their goal = conceded), whole-page tint + seconds counter while open, PEN button per player (counts toward 3 fouls, no man-down), "Man-up goal" switch in the Events sheet, figures on the tracker header, the viewer game section and the season results.
- Everything is derived from 4 new event types (`pen`, `manUp`, `manUpEnd`, `manDownEnd`) via `js/situations.js`; games get `situations: true` at creation.
- The one real game so far (vs ΡΟΗ, 14/11, 19–10) has no marker: it shows "—" and is left out of season man-up figures.
- Found: `js/journal.js` only accepts the 3 old event types and empties the whole journal on an unknown one. Task 1 fixes it; deploy only when no game is live.
- Execution routing: Tasks 1–3 Codex (unit-only), Tasks 4–6 sonnet (e2e), Codex read-only review per task, whole-branch Claude review before merge.

## 14/11/2026 - Where we left off (handoff)
- **Live:**
  - Viewer https://nemlah.github.io/scoretracker/, tracker `/track.html`, Firebase project `score-tracker-1be7c`, team "ANOG".
  - The owner unlocked on a phone and ran a test game, then wiped the test data. `secrets/editCode` is kept.
  - `main` = `origin/main`. Pages redeploys about 30 s after a push.
- **Next, in order:**
  1. Fix the 4 parked tracker issues (see "Merged to main; open follow-ups" below), `repo.endGame` first. Do it before the first real match.
  2. Owner: make sure the edit code was changed from the temporary test value.
  3. Owner: a real-iPhone run (unlock, tap, background/foreground, airplane mode on/off).
  4. Done: the owner deleted `feat/scoretracker` and `.superpowers`.
- **Workflow that worked:**
  - Viewer changes go to a sonnet implementer with a brief file, then a Codex read-only review, then my own full run (unit + e2e), then push.
  - E2E needs `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH`.

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

## 14/11/2026 - Viewer layout: timeline first, filtered players
- Commits b86bc75 and d5dd0bd: sonnet implementer, Codex review, 1 fix round.
- Viewer order is now: game timeline, then Our players, then This season.
- Our players lists only players with a goal, shootout goal or exclusion (`model.scoringLines`). The section is hidden until someone qualifies.
- The timeline sits in `.timeline-scroll`:
  - `max-height: 18rem`, scrolls, with sticky period headers and a pure-CSS bottom scroll shadow (`color-mix`, so no shadow on iOS older than 16.2).
  - It is a focusable region.
  - Scroll position and keyboard focus survive live re-renders (`renderGame`).
- Tests: unit 112, e2e 153 passed / 13 skipped.

## 14/11/2026 - Viewer timeline restyle
- Commit 06a1de4 (sonnet implementer; Codex read-only review found no issues):
  - Period headers are 1.5rem condensed 700 with a 2px ink rule above.
  - Events use 🏐 for goals (changed from ⚽ at the owner's request) and 🟥 for exclusions instead of words; screen readers still hear "Q2 · Goal · #5 Name".
  - Opponent goals are right-aligned and labelled with the opponent's name.
- Viewer only. `eventLabel` and the tracker wording are unchanged, because Undo and the events sheet depend on them.
- To change an emoji, edit `tlGoalIcon` or `tlExclIcon` in `js/strings.js`.
- Tests: unit 111, e2e 141 passed / 13 skipped.
- Earlier today, the unlock failure turned out to be an invisible character in the owner's `secrets/editCode` path. It was fixed by recreating the document. The owner then wiped the test data.
- Still open: the 4 parked issues from 14/11 (below).

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
