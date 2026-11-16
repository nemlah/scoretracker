# Session log

## 16/11/2026 - Goalie order, smaller goalie buttons, timeline saves (branch feat/goalie-order-timeline-saves, 9704df2)
- Live screen: the goalie in goal first, field players by cap, the other goalie(s) last. A tap on this device's goalie buttons that changes the goalie in goal (In goal, or Save / Pen save on the other goalie) swaps the two goalie tiles, pauses Save / Pen save / In goal for 1 s and scrolls to the top; Undo, Events-sheet corrections and other devices reorder without the pause or the scroll. Field tiles never move on a swap (the goalie tile head is one line; a long goalie name ends in "…").
- Goalie tiles: Goal / Excl / Pen are 36 px (were 48). In two columns (≥ 700 px) field tiles keep their own height.
- Viewer: every ordinary save is its own lighter timeline row, "✋ Save · #1 Name"; shown only when both cached model.js and strings.js carry TIMELINE_SAVES, so a phone mixing old and new files keeps saves out.
- Design: docs/superpowers/specs/2026-11-16-goalie-order-timeline-saves-design.md (the 15/11 goalies spec's no-reorder anti-goal, order rule, 48 px rule and "no saves in the timeline" non-goal are marked amended). Plan: docs/superpowers/plans/2026-11-16-goalie-order-timeline-saves.md.
- Commits: 149ecfc (Codex), 854c6e3, c3c4c4d and 9704df2 (sonnet). Per-task Codex reviews clean; opus whole-branch review "ready to merge" with 3 Minors, all fixed in 9704df2 and re-reviewed.
- Tests at 9704df2: unit 202, e2e 386 passed / 14 skipped / 0 failed; emulator 28 at c3c4c4d (the fix touched CSS, tests and docs only).
- Not merged or deployed. After deploy, on a phone: swap goalies (In goal, and Save on the other goalie) and check the smooth scroll, a long-named goalie, and landscape.
- Next in the queue: R7 (service worker cache failure).

## 16/11/2026 - R1 retry duplicate fixed, live (main 425d060)
- Bug (review R1): a goal tapped offline plus its scorer correction, both refused after another device took over, were retried as two adds of one event id; arrayUnion compares whole objects, so the score counted the goal twice. Production checked: no duplicate ids in any game (Steaua 54, ΡΟΗ 34, Delfin 50 events), so no data repair.
- Fix: `journal.record` — a correction supersedes the earlier add, remove and correction of its event, so the journal holds one entry per event (this also stops a stale refused delete from removing an event corrected afterwards). `retryFailed` sends one write per event from its latest entry, retires superseded entries left by the previous journal.js, and drops a lone add the server already holds.
- Commits: b235d0f and ee1a7b3 (Codex, high), 0bd7c1c (sonnet e2e). Reviews: Codex read-only twice, opus whole-branch; their findings (stale remove, lone add overwriting a newer correction) are fixed in ee1a7b3; the round-2 review found no issues.
- Visible change: a refused goal plus its refused correction shows "1 tap not saved" (was 2).
- Tests at ee1a7b3: unit 201, emulator 28, e2e 364 passed / 14 skipped / 0 failed. The new offline e2e is Chromium-only like the rest of that suite; on the old code it failed with goals p5 and p2 on the server.
- Deployed 16/11/2026: fast-forward to 425d060, unit 201/201. Live headless check at 360 px: the tracker reaches the unlock screen in the viewer's browser context (~2 s) with the new journal.js and taps.js; the viewer lists Steaua, ΡΟΗ, Delfin; no sideways scroll, no console errors. Old and new journal.js / taps.js mix safely in both directions. Before the next game: open tracker and viewer once on Wi-Fi on every phone.
- Next in the queue: (2) goalie order and (3) goalie button sizes (brainstorming), then R7.

## 16/11/2026 - Todo queue (after the 16/11 code review)
Open from before, in order:
1. Done 16/11 (branch feat/goalie-order-timeline-saves): the goalie in goal first, the other goalie last; see the entry above.
2. Done 16/11 (same branch): Goal / Excl / Pen on goalie tiles are 36 px; saves also added to the viewer timeline.
3. Parked: the games-list pin key check, our players' missed penalties, older seasons in the viewer, the 4 tracker issues from 14/11 (repo.endGame first).

Added from `docs/code-review-2026-11-16.md` (the findings we agree with, in the order to do them; R-numbers refer to that review):
4. Done 16/11 (R1, branch fix/retry-duplicate-events): a refused goal and its refused correction are no longer retried as two goals; see the entry above.
5. R7: `networkFirst()` (`sw.js:112-144`) awaits `caches.open()` outside its try, so a Cache Storage failure fails every same-origin request even with a good network. Treat cache open, match and put as optional.
6. R6: `watch()` (`js/repo.js:51`) passes no error callback to `onSnapshot`, so a terminal listener error leaves "Loading…" or a frozen score with no message (the 16/11 tracker hang looked like this). Show unavailable or stale with a reload path; leave transient reconnects to the SDK.
7. R8: `newerGameId()` (`js/repo.js:65`) needs a strictly later date, so ending a reopened game leaves the pointer on it when the newer game has the same date (tournament days; 14/11 already had two games). Order by date, then `createdAt`, then id, with a fallback for games without `createdAt`. Do it together with parked tracker issues 1 and 4, which touch the same `endGame`.
8. R11: season tables show the names stored in stats, so a roster rename stays stale until a recount. The viewer should take names from `team.roster` by player id, with the stats name as fallback.
9. R9: before the first save or switch, goals against go to the lowest-cap lineup goalie (`js/goalies.js:13-30`), so a cap edit, or removing a goalie (`playerHasEvents`, `js/model.js:145`, ignores opponent goals), moves past goals against to another goalie. Record the starting goalie; block removing a goalie who has goals against.
10. R2: one final-game correction runs two season recounts (`js/tracker/recount.js:9` marks the season again after the write, though `recomputeSeason` already waits for pending writes). About 2 × (games + 1) reads instead of half that; only after-game corrections. Keep the offline path working.
11. R5: two tracker tabs on one phone overwrite each other's dirty-season list (`js/tracker/statsQueue.js` reads storage once and writes its whole copy), so an older season's recount can be lost. Merge with storage before each write.
12. R3: the README free-plan estimate (about 1,000 viewer-games a day, so about 50 updates a game) predates saves and situations. Count updates per game from production and correct it; also say that going over quota blocks the tracker's writes.
13. Mixed releases (review design risk): a versioned release shell in the service worker instead of per-file refresh, so a phone can't mix old and new modules; it would retire the mixed-cache guards. Larger; later.

Not added: R4 (unbounded history list: years away at about 30 games a season), R10 (hidden Events panel: under 0.5 ms at real game sizes by the review's own numbers), the 1 MiB document limit (a game is a few KB), older-season repair being local to one device (rare; 11 covers the likely case), WebKit offline coverage (Playwright can't simulate it; the on-phone check covers it), rules schema validation (one trusted editor; 4 covers duplicate ids).

## 16/11/2026 - Tracker "Loading…" hang fixed, live (main 8071b5c)
- Cause: viewer and tracker shared the default Firebase app, so one multi-tab Firestore cache and one primary-tab election. The primary tab runs every tab's listeners with its own sign-in; a viewer tab (never signed in) opened first made the tracker's `editors/<uid>` listen fail with permission-denied (firestore.rules:17) and the tracker stayed on "Loading…".
- Fix: `initFirebase({ name })` takes an optional app name (default app unchanged); the viewer passes `'viewer'` and gets its own cache (Firestore keys its IndexedDB and tab-sync storage by app name). The tracker keeps its sign-in, ownership and pending writes. A phone mixing old and new cached modules falls back to the shared cache, as before.
- Test: tracker-access "a viewer tab opened first in the same browser does not block the tracker" failed on chromium and webkit before the fix (permission-denied) and passes after.
- Tests at fb09b1f: unit 192, emulator 28, e2e 363 passed / 13 skipped / 0 failed. Codex read-only review: one Minor, accepted.
- Accepted Minor: the viewer's cache starts empty once after deploy (open the viewer once on Wi-Fi before relying on it offline); on the scorekeeper's own phone the viewer now shows taps after server sync, like every other phone.
- Deployed 16/11/2026: fast-forward to 8071b5c, unit 192/192. Live headless check at 360 px: the viewer games list shows Steaua, ΡΟΗ, Delfin; the tracker opened in the viewer's browser context reaches the unlock screen in ~2 s; two caches (`firestore/[DEFAULT]` and `firestore/viewer`); no sideways scroll, no console errors. Before the next game: open tracker and viewer once on Wi-Fi on every phone.
- Next: (2) goalie order on the live screen (conflicts with the goalies spec, ask the owner first) and (3) smaller Goal / Excl / Pen buttons on goalie tiles; use superpowers:brainstorming for both.

## 16/11/2026 - Where we left off (handoff before /clear)
- **Owner's next request (16/11), not started, no branch yet:** (1) fix the tracker "Loading…" hang; (2) on the live screen keep the goalie in goal at the top of the list and move the other goalie to the bottom; (3) make the Goal / Excl / Pen buttons on goalie tiles smaller (rarely used). Use superpowers:systematic-debugging for (1) and superpowers:brainstorming for (2)+(3).
- **(1) The hang:** both pages call `initFirebase()` (`js/firebase.js:12`) on the default app, sharing one `persistentMultipleTabManager` cache. The viewer never signs in; when its tab is the cache's primary tab, a tracker tab opened in the same browser with no saved sign-in stays on "Loading…" with permission-denied. Also happens on 4de03d6, so it is older than 15/11. Repro: open the viewer, then `track.html` in the same browser context. A repro script from 15/11 is at /private/tmp/claude-501/-Users-nemlah-Code-scoretracker/e790e31c-8b4e-4519-95b3-480447996116/scratchpad/shared-check.cjs (gone after a reboot).
- **(1) Fix idea:** give the *viewer* its own app name (an optional `name` for `initFirebase`, default unchanged), not the tracker as proposed on 15/11. The viewer has no sign-in, so it only loses its read cache once; the tracker keeps its sign-in, game ownership and unsynced writes, so nobody re-enters the tracker code. Mixed-cache safe while the default stays the same. Confirm first that Firestore names its IndexedDB per app name.
- **(2) conflicts with the goalies design:** `docs/superpowers/specs/2026-11-15-goalies-design.md:56` (anti-goal) and `:149` say tiles never reorder when the goalie in goal changes, so a SAVE tap never lands on a moved button; `js/tracker/views/live.js:292` implements it. Ask the owner how to handle that before building (e.g. tiles move only right after an "In goal" tap).
- **(3) Sizes:** the same spec (`:153`) keeps Goal / Excl / Pen at ≥ 48 px; the goalie tile is `js/tracker/views/live.js:54-80` and `css/tracker.css:307-341`. This replaces the earlier "compact goalie tile" follow-up.
- **State:** main c7284bc, pushed and live (quarter scores). Release routine and focused e2e command are in auto-memory. Still parked: the games-list pin key check, missed penalties, older seasons in the viewer, 4 tracker issues.

## 16/11/2026 - Viewer quarter scores live (main 6870b94)
- Done: a final game's scoreboard shows `Q1 2–3 · Q2 1–4 · Q3 3–3 · Q4 2–3` under the score (our goals first, `0–0` for an empty quarter, shootout goals left to the shootout line); hidden on live games; appears when a watched game ends. Commits 0f30e4a, 7522fb8, 38f6679.
- Guard: the line is hidden if its quarters don't add up to the score shown (goals with a period outside 1–4; none exist in production — 138 events, all 1–4).
- Wrapping: each " ·" stays with the quarter before it, so a wrapped row never starts with a dot; the line fits one row down to ~300 px, the wrap test uses 240 px.
- Tests at 38f6679: unit 192, e2e 361 passed / 13 skipped / 0 failed.
- Deployed 16/11/2026: fast-forward to 6870b94, unit 192/192. Live headless check at 360 px: all 3 final games show the line and it matches the score (Steaua 8–13, ΡΟΗ 19–10, Delfin 11–14), one row each, no sideways scroll, no console errors; the tracker opens to the unlock screen in its own context.
- Next: open tracker and viewer once on Wi-Fi on every phone. Still open: the shared-cache tracker hang and the parked pin key check (entry below).

## 15/11/2026 - Viewer games list live (main 0948338)
- Done: the viewer lands on the live game when one is live, otherwise on the games list (also `#/games`); "← All games" on every game view and the unavailable message; live banner on the list; a watched game that ends stays on its final score as `#/game/<id>` (history replace). Commits 1abb7f6, 84bf044, d69a048.
- Review fixes: a non-current game ending no longer pins the page; ending a reopened older game (team pointer moves in the same batch) keeps its final score in either snapshot order; leaving the game ends a running celebration.
- Behaviour change: a final current game no longer lands on the game; existing tests open `#/game/<id>` instead (viewer.spec, tracker-events).
- Tests at d69a048: unit 192, e2e 349 passed / 13 skipped / 0 failed. One webkit flake seen once: tracker-situations "tint is removed when leaving the live screen" (90/90 on re-run).
- Parked: the team-snapshot pin should also check that the game on screen is the old current game (one condition; only reachable in the tick between a hash change and its hashchange).
- Live check (headless, 360 px): landing shows the list (ANOG, 3 results, no sideways scroll); a result opens Steaua 8–13 with "← All games" (#/games) back to the list; malformed link → unavailable with All games; no viewer console errors. Tracker reaches the unlock screen in a fresh browser.
- Found during the live check, pre-existing since the first commit (same on 4de03d6): a browser that has never signed in to the tracker, with a viewer tab open, gets a tracker stuck on "Loading…" (permission-denied). Cause: both pages share the multi-tab Firestore cache; the viewer tab, with no auth user, is the primary tab and runs the tracker's listeners. Recovery: close the viewer tab and reload the tracker. Once a browser has signed in to the tracker, it's unaffected.
- Next: decide the fix for the shared-cache tracker hang; the parked pin key check; open follow-ups from the handoff entry below.

## 15/11/2026 - Where we left off (handoff before /clear)
- **Current work:** branch `feat/games-list` (off main 4de03d6), not pushed. Approved short design `docs/superpowers/specs/2026-11-15-viewer-games-list-design.md` and a 1-task plan `docs/superpowers/plans/2026-11-15-viewer-games-list.md`. Implementation not started.
- **What it does:** the viewer lands on the live game when one is live, otherwise on a games list (also at `#/games`); "← All games" on every game view; live banner on the list; a watched game that ends stays on its final score as `#/game/<id>`.
- **Next:** run superpowers:subagent-driven-development on that plan — one sonnet implementer (e2e), fresh read-only Codex task review, controller runs unit + emulator + full e2e (`--reporter=list`), sonnet whole-branch review, then the owner chooses merge/deploy.
- **Watch out:** behaviour change by design — opening the viewer on a final current game now shows the list, so existing viewer tests that relied on that must open `#/game/<id>` (plan Step 1). Keep viewer.js mixed-cache safe (no new named imports of new model.js/strings.js functions).
- **Release routine and the focused e2e command** are in auto-memory (release-routine, e2e-focused-command).
- **Open follow-ups:** our players' missed penalties, compact goalie tile, older seasons in the viewer, the 4 parked tracker issues (repo.endGame first). Scratch dirs under `.superpowers/sdd/` are git-ignored and safe to delete.

## 15/11/2026 - Viewer past games live (main b5a2dd1)
- Season results rows link to `#/game/<id>` and open that game in the normal view; open row marked; "← Back to current game"; live banner with Watch while another game is live; "That game isn't available." for deleted or malformed ids (a malformed id used to stop the viewer starting — fixed in review).
- Tests: unit 192, emulator 28, e2e 315 / 13 skipped / 0 failed. Live check: ΡΟΗ opens from the list (19–10), back returns to Delfin, malformed link → unavailable, no console errors.
- Left as is (final review minors): stale live banner while offline (like the scoreboard), offline + never-cached shared link says "isn't available", focus drops to body after a result link, raw string keys briefly on a mixed old/new cache.
- Next: our players' missed penalties (deferred), compact goalie tile, older seasons in the viewer, the 4 parked tracker issues (repo.endGame first).

## 15/11/2026 - Goalkeeper stats live (main 7d453ac)
- Roster/lineup Goalie tick; Live goalie tiles first with SAVE (largest), PEN SAVE, In goal; lowest cap starts in goal; save/penSave/gkIn events; opponent goals count against the goalie in goal (js/goalies.js replay). Save % = (saves + pen saves) ÷ (those + GA), periods 1–4; shootout separate.
- Events sheet corrections: goalie picker on save rows, "In goal" picker on opponent-goal rows (adds a gkIn at goal ts − 1).
- Viewer: Goalkeepers tables (game with in-goal dot, season), "✋ Penalty saved" in the timeline; empty "(0 – 0 pen.)" lines hidden (Delfin fixed).
- Final-review fixes: lineup sheet writes goalie ticks back only for ticks changed there; shootout pen saves count on the tile; mixed old/new module guards (tracker refuses goalie taps the journal can't hold; viewer filters save/gkIn before timeline()).
- Tests: unit 192, emulator 28, e2e 281 / 13 skipped / 0 failed. Live check: viewer OK (no Goalkeepers table until goalies are marked), tracker loads.
- Before the next game: mark the goalies in Roster, open tracker + viewer once on Wi-Fi on every phone.
- Follow-ups: more compact goalie tile (two goalie tiles fill ~500/800 px portrait); "Exclusio/n" break on field tiles at 375 px; our players' missed penalties (deferred by owner); the 4 parked tracker issues (repo.endGame first).

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
