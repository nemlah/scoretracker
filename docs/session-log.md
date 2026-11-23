# Session log

## 23/11/2026 - Safari: Past games took ~30 s after a reload, fixed with long-polling (main 5373073)
- **Symptom:** in desktop Safari 27, the tracker's Past games page sometimes showed "Loading games…" for about 30 s after a reload. Other pages draw from the cache first; Past games uses `getDocs`, which waits for the server.
- **Cause (from the owner's HAR):**
  - The Firestore Listen channel ran in streaming mode (`CI=0`, gzip, HTTP/2).
  - The server sent the games query and its CURRENT marker about 1.9 s after the page started loading (readTime 10:24:59.66), but the app only acted on it at about 31.9 s, right after the server's 30 s "noop" keep-alive.
  - So Safari's network layer held small streamed replies back from the page until more bytes arrived.
  - Playwright WebKit and Chromium don't reproduce it. Firestore's own auto-detection didn't catch it either.
- **Fix:** `experimentalForceLongPolling: true` in `initFirebase` (`js/firebase.js`), for the tracker and the viewer, production and emulator alike. Each server reply is now a complete HTTP response (`CI=1`).
  - A read-only Codex check found nothing depending on streaming timing (offline detection, stale logic, takeover, unlock and end-lookup deadlines, multi-tab).
  - Codex wrote the change plus `tests/e2e/transport.spec.js`, which checks that every Listen GET has `CI=1` in the viewer and the tracker. It fails on the old code in both browsers.
- **Tests:** unit 328, emulator 35, full e2e 940 passed / 16 skipped.
- **Deployed:** no game was live. Pages built 5373073 within ~30 s. Headless live check: Chromium and WebKit, `CI=1`, results shown, the tracker reaches unlock, no console errors.
- **Where we left off:**
  - the owner should reload Past games in Safari a few times; if it is still slow, capture another HAR;
  - this likely also fixes live-viewer updates in Safari arriving late (not verified on a phone);
  - optional: Past games could draw from the cache first, like the other pages.

## 23/11/2026 - Competition per game + timeline quarter divider deployed (main 6931a3a)
- **Built:** every game has a competition: League / Cup / Tournament (with a name) / Friendly. It is set on the new-game details step (it defaults to the previous game's) and edited in game detail. Old games read as League. Friendlies stay in Results with a tag but are left out of player and goalie totals, man-up/man-down, the Team tab and the W–L record. The viewer shows a "Friendlies not counted (n)" note. Timeline quarter starts are now full-width divider lines; dark amber chips mean goals only. Cache `wp-shell-v5`.
- **Who:**
  - Codex built Task 1 (model) and Task 4 (divider); sonnet built Tasks 2–3 (tracker, viewer) and the final fix wave.
  - Per-task reviews were all Codex. The final reviews were Codex high ("ready with fixes") and sonnet ("ready to merge"), and every Important finding was fixed.
  - Sonnet hit API 529 three times on Task 3; Task 3 round 3 and Task 4 were moved to Codex, and the controller ran their e2e.
  - Routing is back to standard CLAUDE.md (the owner said Claude has reset).
- **Tests:** unit 328, emulator 35, full e2e 936 passed / 16 skipped, no flakes.
- **Known limits (mixed module cache, no code):** a phone still on the previous `viewer.js`/`teamStats.js` counts friendlies in Team and the record until it loads fresh files. A tracker on old `repo.js` + old `model.js` can rewrite stats with friendlies until the next new-tracker recount. A new `repo.js` with an old `model.js` refuses to recount and retries. Opening every phone once on Wi-Fi after deploy covers both.
- **Parked:**
  - a second quick Save during a pending competition write, followed by a write rejection (only on a takeover), can drop the draft. The failed-write banner shows it, and the owner re-picks.
  - The capability gates and the stale-model guard have no automated test; they were checked statically by both final reviewers.
- **Owner to do after deploy:** re-tag any past friendlies in tracker → game detail; each save recounts that season.
- **Deployed:** the owner chose merge. No game was live (4 games, none live). Main was fast-forwarded to 6931a3a and pushed, and Pages served it after about 40 s (build 6931a3a). Headless check at 360 px: the viewer loads with SW cache `wp-shell-v5`; the live 21/11 game shows 4 quarter dividers with a transparent heading; the tracker reaches the unlock screen; no console errors. The competition branch and worktree are removed.
- **Where we left off:** the owner should open the tracker and viewer once on Wi-Fi on every phone, then re-tag past friendlies in game detail. Optional later: update the canvas VGame board for the divider when the design system is re-synced to R3.

## 21/11/2026 - Release 3 (Direction B tracker) deployed (main 62bcd99)
- **Built:** 8 tasks and the final-review fix wave, 17 commits on 720f124 (code head 146cdaa): viewer carry-overs and game flow in timeline order; tracker crest header and banners; live score row, situation band, board tiles, goalie sheet; events sheet by quarter with row editors; home live card, past-game chips, game detail scoreboard; new game in two steps; landscape split, 360 px worst case, cache `wp-shell-v4`.
- **Who:** Codex (gpt-6.2-sol) built Tasks 1–7; sonnet did Task 4 fix rounds 2–3, Task 8 and the final fix wave. Sonnet reviewed Codex's tasks, and Codex reviewed sonnet's. The final whole-branch review (sonnet) said "ready with fixes". Both Importants were fixed and re-reviewed by Codex.
- **Tests:** unit 315; full e2e at 146cdaa 894 passed, 16 skipped (3 workers, 3.9 min). New WebKit flakes, all passing alone: tracker-look:230, tracker-roster:103, tracker-events:423.
- **Canvas:** "R3 build" page (16 boards, 30 screenshots) for the owner to approve.
- **Parked:**
  - the landscape Pen button is ~43 px at 812×375 with notch insets;
  - `lang="el"` is also set on Latin-script opponents;
  - `display: contents` drops `<main>` on old Safari;
  - the situation band shifts the tiles ~28 px (board design);
  - Enter in a cap field no longer starts a game;
  - the viewer's `.board-name`/`.season-team` still uppercase Greek with accents.
- **Deployed:** the owner said "merge and deploy" (taken as approval of the canvas "R3 build" page). No game was live. Main was fast-forwarded to 62bcd99 and pushed. Pages served it in ~15 s. The headless check passed: the viewer loads, and the tracker reaches the unlock screen with the crest. No console errors; the SW cache is `wp-shell-v4`. Removed: the direction-b-r3 branch, the direction-b-r3 and r3-e2e worktrees, and the SDD workspace.
- **Where we left off:**
  - next, re-sync the design system artifact to R3 (once, owner's choice);
  - optional follow-up: the 812×375 landscape Pen button at 44 px;
  - tell the owner to open the tracker and viewer once on Wi-Fi on every phone before the next game.

## 20/11/2026 - E2e speed: hermetic fixture, per-worker projects, 3 workers (merged to main, not pushed)
- **Result:** the full e2e run takes 3.6 min on 3 workers (856 passed), down from 18.8 min serial. Serial (`PW_WORKERS=1`) takes 10.5 min. Unit tests: 313.
- **How:**
  - `tests/e2e/fixtures.js` serves the Firebase SDK, Sofia fonts (`tests/fixtures/fonts/`, OFL), a gapi stub and cleardot locally in every context. It fails any other external request.
  - Fixture routes abort while a context is offline, so service-worker cache misses still show.
  - WebKit blocks its service worker.
  - Each worker has its own Firestore project, `demo-scoretracker-<n>`, read only in `initFirebase`'s emulator branch. Auth stays shared.
- **Flakes fixed on the way:**
  - takeover tests wait for the app's server-confirmed control claim before seeding another holder;
  - the situations and goalies tests wait for server writes;
  - `unlockTracker` waits up to 20 s;
  - viewer-look waits for the live banner before measuring.

  Every test on the waiver list had one of these races.
- **Built by Codex** (gpt-6.2-sol): 13 commits. Codex did the plan review and the per-task reviews; the final whole-branch review was by sonnet (merge after fixes, and both were fixed). After the fix wave: 3 full runs at 3 workers and 1 serial run. One failure (viewer-look:548) was fixed in 1ff5f28. The final run at 1ff5f28 passed 856/856, and viewer-look passed 3/3 alone.
- **Deferred minors (the reviewer said they can wait):**
  - `dropNetworkNoise` filters by text alone;
  - tracker-access/offline re-read the holder after a poll;
  - tracker-look's font-host excuse doesn't check `blockedUrls`;
  - the SDK matcher accepts query variants, and the font regex rejects encoded names;
  - `waitForTrackerControl` should require the page's own UID;
  - `PW_TEST_REUSE_CONTEXT` bypasses the fixture;
  - the teardown counters are heavier than needed;
  - the fonts CSS route ignores the query;
  - handler rejections are swallowed in the drain.
- **Merged** to main locally at b606af7 (fast-forward; the branch and worktree are removed). Merged main: unit 313, e2e 856 passed in 3.8 min on 3 workers. **Not pushed:** main is 14 commits ahead of origin. The next push deploys to Pages; the only production line is the emulator-only `js/firebase.js:17`.
- **Where we left off:**
  - Next is Release 3 (Direction B), Codex mainly. Codex implements, sonnet reviews Codex code, Codex reviews the plan, and e2e-heavy tasks are routed per task (memory `credits-offload-codex`).
  - Start from the R2.1 entry's open items: re-sync the design system to R2; answer the two open spec questions (game-flow order; "Shootout" vs "SO"); plan R3 from the spec's R3 carry-overs.
  - Push main first, or with R3.
  - The flake waiver list is kept. Proposal: drop it after a week of clean runs on main.

## 20/11/2026 - Why e2e takes ~19 min and how to cut it (investigation, no code changed)
- **Measured on main:** unit 4 s, emulator 8 s, e2e 18.8 min. 872 runs in series (`workers: 1`, needed because `resetAll` wipes the one shared emulator project). WebKit 744 s, Chromium 370 s, median test 1.06 s. The 27 tests over 4 s add 173 s; fixed sleeps add about 30 s per browser.
- **CDN cost:** every test downloads the Firebase SDK (~950 KB from gstatic) and Google Fonts again with an empty cache. Serving them from `node_modules` cut viewer.spec from 60–72 s to 38 s (two runs each way).
- **Parallel experiment** (throwaway worktree): one emulator project per worker plus the CDN stub, 3 workers. Full suite in 4.7 min instead of 18.8.
  - Emulator: `singleProjectMode: false`.
  - App: in emulator mode `js/config.js` reads `globalThis.__EMU_PROJECT`, set by an init script.
  - Helpers: `demo-scoretracker-<TEST_PARALLEL_INDEX>`.
  - One fixture prepares every context, including those made with `browser.newContext`.
- **Failures in that run:**
  - 6 layout tests broke because of the experiment's empty-font stub. They wait for Sofia, so serve the real woff2 files.
  - 2 WebKit load flakes that pass alone: tracker-goalies:246 (waived) and tracker-events:419 (the console gate caught "network connection was lost").
- **Serial-run flake:** tracker-access:242 is not waived and passes alone. Root cause: `withTwoDevices` reads `activeUid()` once right after unlock (line 84), with no poll.
- **Where we left off:** waiting for the owner's go on a test-infra branch, in this order:
  1. Fix the `withTwoDevices` race and the WebKit connection-lost noise.
  2. Make the network hermetic: Firebase SDK, real fonts, apis.google.com.
  3. Per-worker projects with 3 workers.

## 20/11/2026 - R2.1: our goals stand out on the timeline (deployed)
- **Request:** the owner's canvas comment asked for our goals to pop more than other events. They picked option A, larger with no tint. The VGame board on the canvas is updated: name 17 px/700, pill 22 px, row 56 px.
- **Code** (sonnet, Codex-reviewed, one fix round), in `css/viewer.css`:
  - our goal rows are 56 px, with a 17 px bold name and a 22 px pill (nowrap, -0.03em tracking);
  - the centre column is `minmax(64px, auto)`, so a fallback-font pill widens the column instead of overflowing. It stays 64 px with Sofia, and the spine stays centred.
- **Tests:** unit 301; focused 216; full e2e 855 passed, 16 skipped, 1 WebKit flake (tracker-access:341, added to the flake list; passes alone 5/5).
- **Deployed 20/11/2026** at db664e5, with no game live. The live check matched the sizes above, found no sideways scroll or console errors, and the tracker reaches its unlock screen.
- **Where we left off:**
  - The owner opens the tracker once while in control. Its boot recount writes quarters/excl/pens into `stats/2026-27`; then check the season Team tab's goals by quarter.
  - Remove the merged worktrees `.worktrees/direction-b-r2` and `.worktrees/r2-1-our-goals` and their branches; the cleanup command was denied in-session.
  - Re-sync the design system to R2; answer the two open spec questions (game-flow order; "Shootout" vs "SO"); plan Release 3 from the spec's R3 carry-overs.
  - Resolve the canvas comment thread on VGame ("our goals pop") on the canvas. It was addressed but is not sent to Claude.

## 20/11/2026 - Direction B, Release 2 (viewer structure) built on branch direction-b-r2
- Built in `.worktrees/direction-b-r2` from `docs/superpowers/plans/2026-11-19-direction-b-r2-viewer.md`:
  - Codex: season data fields and `timelineRows`, `js/teamStats.js`, the `viewerState` planner.
  - Sonnet: the viewer loop with per-watch stale state, the season home with LIVE banner and results card, the two-row scoreboard with quarter grid, tabs and Players panels, the centre-line timeline with `js/icons.js`, the Team tabs via `js/teamView.js`.
  - Service-worker cache v3.
- **Reviews:**
  - Every task had a Codex review. From Task 9 on, fix rounds follow the owner's routing table.
  - Final whole-branch reviews by Codex (high) and Claude (opus), then one fix wave: the Team tab with an R1 model.js, the shootout class under R1 CSS, result-link accessible names, test-helper ordering, the Google Fonts stub, focusable tab panels. 4 residual test gaps are parked; they are in the spec's R3 carry-overs.
- **Tests at the end (36856e9):**
  - unit 301/301, emulator 29/29;
  - e2e 847 passed, 16 skipped, 1 WebKit tracker flake that passes alone;
  - mixed-cache matrix (9 R1/R2 pairings × 2 browsers) 18/18;
  - reduced motion and 844×390 landscape pass.
- **Canvas page "R2 build":** 20 design-vs-build pairs at 390 px, 360 px strips and a club-colour row, awaiting owner approval. R2 as-built notes and R3 carry-overs are in the spec.
- **Todos outside R2:**
  - WebKit tracker test races (`withTwoDevices`, goalie and situation timing) flake on main too.
  - Stub `apis.google.com` in e2e: a real 500 tripped the viewer-team console gate once.
- **Deployed 20/11/2026:**
  - No game was live (3 games, all final). main pushed at 11e0ca7, and Pages built it.
  - Headless live check:
    - season home with tabs and real results (1 W · 2 L);
    - Players and Team panels with no undefined or NaN;
    - game screen with the two-row board, quarter grid and 39 timeline rows;
    - no sideways scroll at 390 px;
    - the tracker reaches its unlock screen in the viewer's context;
    - no console errors.
  - The season's exclusion and quarter figures show "–" until the tracker's next boot recount writes them.
- **Next:**
  - Service-worker cache is now v3: open the tracker and the viewer once on Wi-Fi on every phone before the next game.
  - Re-sync the design system to R2.
  - Plan Release 3; the carry-overs are in the spec under "R3 carry-overs from R2".

## 19/11/2026 - Direction B, Release 1 (the look) built on branch direction-b-r1
- Built in the worktree `.worktrees/direction-b-r1` from the plan `docs/superpowers/plans/2026-11-19-direction-b-r1-look.md`: club-colour helper `js/accent.js` (Codex), tokens + Sofia fonts + contrast test (Codex), viewer and tracker CSS restyle with look e2e specs (sonnet), home-screen icons, manifest and link preview, service-worker cache v2 (sonnet). No DOM, class or test-id changes.
- Every task had a Codex review; final whole-branch reviews by Codex (high) and Claude (sonnet), then one fix wave (Events sheet stays undimmed under takeover, selected-result marker and Watch focus contrast, 44 px targets, brand script checks).
- Tests at the end: unit 243/243, emulator 28/28, e2e 496 passed (chromium + webkit). Mixed-cache check (new CSS beside the previous base.css; accent.js missing) passed.
- Canvas page "R1 build" has 24 design-vs-build pairs for the owner's approval. R2/R3 markup lists are in the spec.
- Second fix round (9be1e1b) closed the last two re-review items: the Watch focus test now reaches the link by keyboard Tab (Alt+Tab in WebKit); disabled buttons in the Events sheet keep their disabled look under takeover. Codex re-review clean.
- E2e needs host port 8080 free (CVAT's traefik container uses it; owner stopped CVAT for this run).
- Deployed 19/11/2026: no live game (3 games, all final); main pushed at 982605e; Pages built it in ~35 s. Headless live check: viewer in the new look with real data, Sofia fonts (Greek) loaded, no sideways scroll at 390 px, club colour applied; tracker reaches the unlock screen in the viewer's browser context; no console errors. Service-worker cache is now v2: open tracker and viewer once on Wi-Fi on every phone before the next game.
- Next: plan Release 2 (viewer structure: season home with LIVE banner, tabs, centre-line timeline, Team tab; spec has the R2 markup list).

## 19/11/2026 - Design workflow: direction B, pages 2–4
- Owner picked B · Shot Clock. Their canvas comments (names left, logo after the name, man-up/man-down as a plain line in the scoreboard, no cards) were applied on page 1 by the canvas's own Claude; page 1 is otherwise unchanged.
- Built page 2 Viewer (22 boards, light and dark, plus icon and link preview), page 3 Tracker (19 boards: live states, banners, toast, sheets, setup screens, landscape) and page 4 Tokens (colours with live contrast ratios, type, space, radii, targets, icons, logo, photos) on https://claude.ai/artifact/7yCTLzZXoQdD4UdnyXLGBb.
- Club logo is the real ANO Glyfada crest (uploaded to the canvas). Sample opponent is Vouliagmeni; page 1 still shows "Glyfada" as the opponent and an invented "Season 2026-27" on BViewer.
- Owner comments, round 1 (viewer): home is now This season, with an amber LIVE banner while a game is live (the "no game yet" screen is removed); the season header shows MU 17/33 · MD 24/34; the game screen gets Timeline | Players tabs; the timeline runs on a centre line with the score always on it, our events left, theirs right, quarters as markers on the line; every game screen links back to This season.
- Team tab added to the viewer game screen (Timeline | Players | Team). MU/MD moved off the scoreboard into it, per quarter; plus goals for/against split by man-up / man-down, fouls per quarter with foul trouble (out at 3 fouls, exclusions and penalty fouls together, `EXCL_LIMIT` in `js/model.js`), penalties against, and game flow (biggest lead, longest run, ties, scorers). All derivable from events already tracked. Candidates to track later: a penalty flag on our goals, sprint won/lost per quarter, shots (only with a second scorekeeper).
- Home (season) screen gets the same tabs: Results | Players | Team; its Team tab shows man-up/man-down and exclusions per game and goals by quarter. Wrote `docs/design/tracking-additions.md` (penalty-goal flag, sprints, shots; old phones currently show unknown event types as exclusions, so new event types need a tolerant-readers release first).
- Canvas is private to the owner. Design docs and this log committed on main, not pushed.
- Owner picked three releases (R1 the look on today's structure, R2 viewer structure + Team tabs, R3 tracker markup). Spec approved: `docs/superpowers/specs/2026-11-19-direction-b-redesign-design.md`. Codex builder check corrected the season data change: reuse stored per-game MU/MD, add `excl`/`pens`/`quarters` (array of `{us, them}` maps; Firestore rejects nested arrays), no version marker (tracker boot recount fills the current season).
- R1 plan: `docs/superpowers/plans/2026-11-19-direction-b-r1-look.md` — 6 tasks: accent.js (Codex), tokens + contrast test (Codex), viewer CSS (sonnet), tracker CSS (sonnet), brand files (sonnet; controller first copies the crest asset bbcc3e71cefa4897612d1a62399a6b6a from the canvas into img/), release check (controller).
- Next: owner reviews the R1 plan; then execute it subagent-driven in a worktree.

## 19/11/2026 - Design workflow: Claude Design brief
- Wrote `docs/design/claude-design-brief.md`: the prompt for a Design canvas (three directions, then Viewer, Tracker and Tokens pages), built from `css/base.css`, `css/tracker.css`, `css/viewer.css` and the screen inventory.
- Standalone claude.ai/design closes 14/12/2026; Claude Design now lives in Claude as the Design and Design System artifact types, which Claude Code can create, read and revise directly.
- Proposed flow: Design System artifact built from the CSS → directions canvas → comments on artboards → spec with a token diff against `base.css` → CSS implementation (sonnet) with Codex review → Playwright screenshots back onto the canvas → re-sync the design system from code after merge.
- Brief extended: placeholders for the club logo (one slot for a square crest or a wide wordmark, our side of the scoreboard only, plate on dark) and optional player photos (cap badge as fallback and main identifier on tracker tiles, a club-wide off switch, no faces drawn).
- Built the ANOG Scoretracker design system from the CSS (https://claude.ai/artifact/QM6gZEiJuLkTZ3tZQMedLv): light and Viewer-dark themes, type, spacing, radius, 25 components, a brand book with contrast findings (e.g. sit-up-strong vs sit-down-strong 1.01:1).
- Built the directions canvas (https://claude.ai/artifact/7yCTLzZXoQdD4UdnyXLGBb): A · Lane & Rope, refined; B · Shot Clock; C · Cap & Deck, five boards each, with logo and photo placeholders and red/yellow club-colour tests. Links in `docs/design/README.md`. Nothing committed.
- Next: the owner picks A, B or C; then pages 2 Viewer, 3 Tracker, 4 Tokens on the canvas, then spec and plan.

## 16/11/2026 - Quiet takeover, two-row goalie tile, live (main a12e267)
- Takeover: while no game is live, the device not in control shows no banner and keeps its buttons. Its first touch or key press takes control and the change it starts is saved; modifier keys and Cmd/Ctrl/Alt shortcuts don't count. A quiet takeover needs server-confirmed team, control and game snapshots, no pending writes and a connection. Until then (opened from cache, back from the background) the device behaves as during a live game, so the banner can show for about a second. During a live game and offline: as before. Views enable controls from `state.writable ?? state.active`; `roster.js` keeps its rows across renders so the first touch is not lost.
- Goalie tiles: same height as player tiles (head + one 64 px row). Head: cap · name ("…" when long) over the saves count, and one slot with the IN GOAL badge or the In goal button. The GK badge is gone, and a goalie's own goals no longer show on the tile. Row: SAVE | Pen save | ⋯; ⋯ opens a sheet with Goal / Exclusion / Pen. `.tiles` and `.tile` columns are `minmax(0, 1fr)`, so a long name no longer widens the page at 360 px.
- Design: docs/superpowers/specs/2026-11-16-quiet-takeover-and-two-row-goalie-tile-design.md. Plan: docs/superpowers/plans/2026-11-16-quiet-takeover-two-row-goalie-tile.md.
- Commits (sonnet): 91f4b5f, d58746f, 599788e (takeover); 409977c, b02b431 (goalie tile); a12e267 (final-review fixes). Per-task Codex reviews clean after fix rounds. The opus whole-branch review found that a phone on a stale cache, or back from the background, could quietly take a live game away; fixed in a12e267.
- Known gaps, merged anyway at the owner's call. Codex's re-review of a12e267 found: (1) `reconfirm()` (`js/tracker/app.js` ~600-625) writes its server read over newer listener state; (2) listeners can mark the state confirmed while the page is hidden, so on return it counts as confirmed before the server read answers; (3) a failed `confirmFromServer` is not retried, so an online device with no live game can keep the banner until the next visibility or document change. Fix: confirm only when the read agrees with the listeners (never write state from it); clear the flags again on visible and ignore listener confirmations until the read settles; retry every few seconds while visible, online and unconfirmed, and on `online`.
- Accepted: for one load, a phone mixing the new live.js with an old cached tracker.css or strings.js shows the goalie row overflowing by ~24 px, or key names such as "moreButton".
- Tests at a12e267: unit 207, e2e 432 passed / 14 skipped / 0 failed.
- Deployed 16/11/2026: fast-forward to a12e267, unit 207/207. Live headless check at 360 px: the viewer loads; the tracker reaches the unlock screen in the viewer's browser context (~2 s); no sideways scroll, no console errors. Owner's checks: two devices with no live game (no banner, first tap takes control), the ⋯ sheet, a long goalie name. Open tracker and viewer once on Wi-Fi on every phone before the next game.
- Next in the queue: the three takeover gaps above, then R7.

## 16/11/2026 - Goalie order, smaller goalie buttons, timeline saves, live (main f5f541c)
- Live screen: the goalie in goal first, field players by cap, the other goalie(s) last. A tap on this device's goalie buttons that changes the goalie in goal (In goal, or Save / Pen save on the other goalie) swaps the two goalie tiles, pauses Save / Pen save / In goal for 1 s and scrolls to the top; Undo, Events-sheet corrections and other devices reorder without the pause or the scroll. Field tiles never move on a swap (the goalie tile head is one line; a long goalie name ends in "…").
- Goalie tiles: Goal / Excl / Pen are 36 px (were 48). In two columns (≥ 700 px) field tiles keep their own height.
- Viewer: every ordinary save is its own lighter timeline row, "✋ Save · #1 Name"; shown only when both cached model.js and strings.js carry TIMELINE_SAVES, so a phone mixing old and new files keeps saves out.
- Design: docs/superpowers/specs/2026-11-16-goalie-order-timeline-saves-design.md (the 15/11 goalies spec's no-reorder anti-goal, order rule, 48 px rule and "no saves in the timeline" non-goal are marked amended). Plan: docs/superpowers/plans/2026-11-16-goalie-order-timeline-saves.md.
- Commits: 149ecfc (Codex), 854c6e3, c3c4c4d and 9704df2 (sonnet). Per-task Codex reviews clean; opus whole-branch review "ready to merge" with 3 Minors, all fixed in 9704df2 and re-reviewed.
- Tests at 9704df2: unit 202, e2e 386 passed / 14 skipped / 0 failed; emulator 28 at c3c4c4d (the fix touched CSS, tests and docs only).
- Deployed 16/11/2026: fast-forward to f5f541c, unit 202/202. Live headless check at 360 px: Steaua 8–13 shows 39 timeline rows incl. 7 lighter "Save · #1 Τίμος" rows; no sideways scroll; the games list shows Steaua, ΡΟΗ, Delfin; the tracker reaches the unlock screen in the viewer's browser context; no console errors. Owner's phone check still to do: swap goalies (In goal, and Save on the other goalie) and check the smooth scroll, a long-named goalie, and landscape; open tracker and viewer once on Wi-Fi on every phone before the next game.
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
