# Direction B, Release 3 (tracker details) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tracker boards' markup (crest, header with score and situation band, tiles, banners, home card, past games, game detail, events and goalie sheets, two-step new game, landscape split), clear the R2 carry-overs, and make game flow follow the timeline order.

**Architecture:** The tracker DOM is updated in place, as today. Each view keeps its module (`js/tracker/views/*.js`), and the app shell (header, banners, toast) stays in `js/tracker/app.js`. Styles go in `css/tracker.css`. No change to what is recorded, or to control and sync. The viewer side only loses its R2 mixed-cache shims.

**Tech Stack:** Vanilla ES modules, `h()` from `js/ui/dom.js`, Firestore web SDK 12.19.0, node:test (unit), Playwright 1.64.1 with the Firebase emulators (e2e).

**Spec:** `docs/superpowers/specs/2026-11-19-direction-b-redesign-design.md`. Read: "Constraints (all releases)", "R3 carry-overs from R2", "Release 3", "R1 findings: tracker items", "R3 scope calls".

**Boards:** local copies of the canvas boards are in `.r3-boards/` in the worktree (not committed): `TLive`, `THome`, `TEvents`, `TGoalieSheet`, `TLandscape`, `TGameDetail`, `TNewGame`, `TPast`, `TUnlock`, `Tokens`, `VGame`. They are inline-styled HTML. Copy sizes, weights, colours and order from them, and map each colour onto the existing tokens in `css/base.css` (`--board`, `--led`, `--ink`, …) instead of hard-coding hex. `{{accent}}` is `--accent`, and `{{accentOnBoard}}` is the existing on-board accent pair helper.

**Worktree:** `.worktrees/direction-b-r3`, branch `direction-b-r3`, from main at 720f124 (the live release, "previous main" below).

## Global Constraints

- **Mixed module cache:** a phone can mix R3 files with the previous main's (720f124). Rules:
  - No new named import of an export that is missing from `git show 720f124:<path>`. New exports are read through a namespace import plus `?.` with a fallback.
  - New CSS custom properties are read with a fallback.
  - New string keys degrade to key names.
  - New state fields are read with a fallback.
  - CSS for markup that R3 replaces stays one release, under `/* R2 tracker markup, kept for mixed caches; remove in R4 */`, whenever an R2 `js/tracker/**` file would still render that markup against R3 CSS.
  - Check every changed module against `git show 720f124:<path>`.
- **Keep every `data-testid`** unless the task says it replaces the element. When a test id is replaced, update its e2e in the same commit.
- **Optional modules:** `js/icons.js` is loaded only through a caught `import()`. Until it loads, or when it fails, the glyph strings stay (`tlGoalIcon`, `tlExclIcon` in `js/strings.js`).
- **Tracker stays light.** No dark mode.
- **Touch targets:** 44 px minimum, as on the boards (tile buttons 64/52 px, dock 56/48 px).
- **360 px worst case:** two-digit caps, long Greek names (e.g. `Παναγιώτης Παπαδόπουλος`), every badge on, the longest counts. No sideways page scroll, names ellipsised, never wrapped under the buttons.
- **Club colours:** blue `#0057b8`, red `#c8102e`, yellow `#f2b705`, green `#00843d`. Text 4.5:1, large text and bars 3:1.
- **Colour is never the only difference** (man-up vs man-down, ours vs theirs, out vs in, W vs L).
- **Reduced motion:** any new animation has a `prefers-reduced-motion: reduce` variant.
- **Dates** DD/MM/YYYY via `formatDate`; numbers in tabular figures.
- **Tests:**
  - No `waitForTimeout` except for "nothing happened" checks, and the test says why there is nothing to wait on.
  - Every assertion must be able to fail.
  - Writes are checked in Firestore, not only in the DOM.
  - e2e asserts test ids and text, never colours.
  - New specs import `./fixtures.js`.
- **Commands:**
  - Unit: `npm test` (expect 0 failures).
  - Spec list without ports (Codex): `npx playwright test --list`.
  - Focused e2e (controller or sonnet): `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npx firebase emulators:exec --only firestore,auth --project demo-scoretracker "playwright test <files> --reporter=list"`.
  - Full e2e: the same command with no files. It runs 3 workers.
- **Commits:** one per task (fix rounds add commits). Trailer: the implementing model's `Co-Authored-By` line. Codex can't commit here, so the controller commits Codex's work with `Co-Authored-By: GPT-6.2 Sol (Codex) <noreply@openai.com>`.

## Review Focus

1. **R2 tracker files with R3 CSS, and the reverse**, for one load: e.g. R2 `live.js` with R3 `tracker.css`, or R3 `app.js` with R2 `tracker.css`. Nothing may overlap or hide a control. Unstyled new elements are fine. Owned by Tasks 3–7 (each one's mixed-cache step).
2. **In-place updates:** a Firestore snapshot that lands mid-tap must not rebuild a button. This holds for the new header score, the situation band, the pips and the events-sheet row editors (an open `<select>` must survive a snapshot). Owned by Tasks 4 and 5.
3. **Long Greek names and two-digit caps at 360 px**, in the tile, the goalie sheet header, the events rows with their "Change scorer" button, the home live card's opponent and the past-game rows. Owned by Tasks 4–6 and 8.
4. **Shootout and live states:** a live game on the past-games list shows LIVE, not a W/L chip; a shootout final shows the pen line; a level final shows the grey D chip. The detail scoreboard handles live, final and shootout. Owned by Task 6.
5. **Read-only device** (another device has control): the moved banner shows, and the new controls (Change scorer, Next, Continue tracking) respect `data-write` the same way today's controls do. Owned by Tasks 3, 5 and 7.

---

### Task 1: Viewer carry-overs and game flow order (Codex, high)

**Files:**
- Modify: `js/viewer.js`, `js/strings.js`, `js/teamStats.js`, `css/viewer.css`, `css/base.css`
- Test: `tests/unit/teamStats.test.js` (or the existing teamStats unit file), and the e2e specs that test R1 shims (find them with `grep -rln "R1\|previous main\|mixed" tests/e2e`)

**Interfaces:**
- Consumes: `timeline(events)` from `js/model.js` (exists at 720f124).
- Produces: `goalFlow` follows timeline order. No new exports.

- [ ] **Step 1: Failing unit test** `game flow follows quarter order, not recording order`. Events: Q1 `goal`, Q2 `oppGoal`, Q2 `oppGoal`, then a Q1 `goal` recorded last (highest `ts`, period 1). Timeline order is Q1 goal, Q1 goal, Q2 oppGoal, Q2 oppGoal. Assert `biggestLead === 2`, `ties === 1`, `neverBehind === true`, `longestRun` is `{ us: 2, them: 0 }`. (Recording order would give lead 1, then 0, -1, 0: biggestLead 1, ties 2, neverBehind false.)
- [ ] **Step 2:** `npm test`. Expected: the new test fails.
- [ ] **Step 3:** In `js/teamStats.js`, run `goalFlow` in the timeline's order, oldest first. `timeline(events)` returns `[{ period, events }]` newest first at both levels (SO, Q4 … Q1, each newest `ts` first), so reverse both levels: Q1 → Q4 → SO, ascending `ts`. Shootout goals stay in, last, as today. Keep the return shape. Add a second test: equal `ts` within a quarter keeps input order.
- [ ] **Step 4: Remove the shims.**
  - Every `remove in R3` item in `js/viewer.js`, `js/strings.js` and `js/teamStats.js`. `model.x?.` and `strings.x?.` reads become named imports, but only of exports present at 720f124. Check each one with `git show 720f124:js/model.js` / `js/strings.js`. `fallbackState`, `BANNER_SLOTS` and the cached-repo deadline case go.
  - `tOr(key, fallback, params)` calls become `t(key, params)`.
  - Remove `hasString` from `js/strings.js` only if no file at 720f124 named-imports it (`git grep -n "hasString" 720f124 -- js`). Otherwise keep it and say so in the report.
  - The `TIMELINE_SAVES` check in `js/viewer.js` (~797–801) goes. The export stays in `js/model.js`, because an R2 `viewer.js` still reads it.
  - The R1-only man-up/man-down keys in `js/strings.js` (~27–31) go. First check that no `js/tracker/**` file reads them.
- [ ] **Step 5:** Remove the CSS block under `/* R1 markup, kept for mixed caches; remove in R3 */` in `css/viewer.css`, and `.rope` in `css/base.css` (check that no JS emits `rope`).
- [ ] **Step 6:** Delete or rewrite the e2e tests that only exercised the removed shims (R1 `model.js`/`strings.js`/CSS pairings, among them "the R1-CSS shootout test"). List each deleted test in the report. Tests of R2-era behaviour stay.
- [ ] **Step 7:** `npm test` passes. `npx playwright test --list` lists without errors. `grep -rn "remove in R3\|tOr(" js css` prints nothing.
- [ ] **Step 8: Commit.** `refactor(viewer): drop R2 mixed-cache shims; game flow in timeline order`.

### Task 2: E2e helper consolidation and test gaps (Codex, medium)

**Files:**
- Modify: `tests/e2e/helpers.js`, plus the specs that carry their own copies of the colour reads, the console filter, `open` and `tab` (find them with `grep -rn "function \(open\|tab\|readColour\|colour\)" tests/e2e`). Also `tests/e2e/instrument-repo.spec.js` and `tests/e2e/viewer-team.spec.js`.

**Interfaces:**
- Produces, in `tests/e2e/helpers.js`: `openViewer(page, hash = '')` (today's local `open`), `tab(page, name)`, `cssColour(locator, property)`, `consoleProblems(page)`, all with the signatures the local copies have today. Later tasks' specs import them.

- [ ] **Step 1:** Move each duplicated helper into `tests/e2e/helpers.js` once, and import it in every spec that had a copy. Behaviour stays the same. Where two copies differ, keep the stricter one and note it.
- [ ] **Step 2: Test gap.** `instrument-repo.spec.js` must see the second snapshot enter the queue. Make the instrumentation record each queued snapshot with a counter. Assert that the counter reaches 2 before the assertion that follows today.
- [ ] **Step 3: Test gap.** The season-switch Team test in `viewer-team.spec.js` must reach the stats-key gate. Seed two seasons whose stats documents differ, switch seasons, and assert that the Team tab shows the second season's numbers. Also assert that a stats snapshot for the first season arriving late does not replace them: re-write the first season's stats after the switch, then expect no change. That expect is a "nothing happened" check; give the reason in a comment.
- [ ] **Step 4:** `npm test` passes. `npx playwright test --list` lists the same test count as before, plus the new tests and minus none.
- [ ] **Step 5: Commit.** `test(e2e): shared viewer helpers; queue and season-switch gaps`.

### Task 3: Tracker shell: crest header, unlock crest, banners (Codex, medium)

**Files:**
- Modify: `js/tracker/app.js` (header, `takeoverBanner`, `failedRow`), `js/tracker/views/unlock.js`, `js/strings.js`, `css/tracker.css`
- Test: `tests/e2e/tracker-look.spec.js`, `tests/e2e/tracker-access.spec.js`, `tests/e2e/offline.spec.js`

**Interfaces:**
- Consumes: `team.crest` from `js/config.js` (exists; may be absent: then no `<img>`).
- Produces: the header DOM `header.bar > .bar-brand(img.bar-crest, h1.brand) + nav-home`, used by Task 8's landscape layout.

- [ ] **Step 1: Failing e2e** (tracker-look): the header holds the crest (`data-testid="tracker-crest"`, 32×32, `alt=""`, hidden on `error`) before the team name. The unlock screen shows a 120×120 crest (`data-testid="unlock-crest"`) above its heading.
- [ ] **Step 2: Failing e2e** (tracker-access, the takeover test): `takeover-banner` holds a title "Tracking moved to another device" and a second line "Taps here are paused." (new key `takeoverPaused`). `take-over` is still in the banner.
- [ ] **Step 3: Failing e2e** (offline, the failed-tap test): each `failed-row` shows a warning icon, the title (`tapNotSaved` / `tapsNotSaved`) and a description line (`data-testid="failed-desc"`). For the game on screen, the line reads `DD/MM/YYYY · Opponent: ` followed by the first two failed taps' labels, then `+N more` when there are more. For another game, it shows `failed-game-link` as today. `retry-failed` and `discard-failed` become two equal full-width buttons (48 px) under it.
- [ ] **Step 4: Implement.**
  - The description builds labels with the existing `eventLabel`, using the lineup of `state.game` when its id matches the group's game.
  - The journal entries already hold `type`, `playerId` and `period` (see `failedGroups`). Extend the group with `entries` (the first 2) and `more`.
  - The warning icon is inline SVG built with `createElementNS`, path from TLive's banner, `aria-hidden`.
  - New strings: `takeoverPaused`, `failedMore: '+{n} more'`.
- [ ] **Step 5: Mixed cache.** R2 `app.js` with R3 `tracker.css` must still render today's header and banners. R3 `app.js` with R2 `tracker.css` must keep the crest at most 32 px. Use width/height attributes on the `<img>`, not only CSS.
- [ ] **Step 6:** `npm test`; `npx playwright test --list`.
- [ ] **Step 7: Commit.** `feat(tracker): crest in header and unlock; two-line moved banner; failed-tap details`.

### Task 4: Live screen: score header, situation band, tiles, goalie sheet (Codex, high)

**Files:**
- Modify: `js/tracker/views/live.js`, `js/strings.js`, `css/tracker.css`
- Test: `tests/e2e/tracker-live.spec.js`, `tests/e2e/tracker-situations.spec.js`, `tests/e2e/tracker-goalies.spec.js`

**Interfaces:**
- Consumes: Task 3's header.
- Produces: `.live-top` as the header's second row (board TLive). `.situation-band` (`data-testid="situation-band"`, `data-state="manUp|manDown"`, hidden when none) with `.situation-band-label` and `.situation-band-seconds`. Task 8 places these in landscape.

- [ ] **Step 1: Failing e2e** (tracker-situations):
  - After a Man-up tap, `situation-band` is visible with "MAN-UP" and a seconds count that goes up.
  - After End, it is hidden.
  - Man-down shows "MAN-DOWN".
  - The dock `situation` button still works as today.
  - The band's seconds and `situation-seconds` read the same value, from the same tick.
- [ ] **Step 2: Failing e2e** (tracker-live):
  - `tile-goals` shows the plain number ("3"), with `aria-label` "3 goals" (`tileGoalsAria` becomes `'{n} goals'`, and "1 goal" for one).
  - `tile-excl-count` has 3 pips. The pips fill in event order: exclusions as `.pip--excl`, penalty fouls as `.pip--pen`, empty as `.pip`. The `aria-label` reads "Exclusions: 1, penalty fouls: 1".
  - The score uses a colon separator (`aria-hidden`).
  - `score-us` has an accent bar under it (`.score-bar`, `aria-hidden`).
- [ ] **Step 3: Failing e2e** (tracker-goalies): the goalie sheet (`goalie-more-sheet`) has a header row with the cap chip, the name, and `IN GOAL` (`data-testid="more-in-goal"`) only when that goalie is in goal. The goal, exclusion and pen buttons sit in the board's 2fr/1fr/1fr grid; Cancel is under them. The goalie tile's `tile-saves` line reads "8 saves · 1 pen save" (`tileSavesWithPen`, `tilePenSaves: '{n} pen save'` / `'{n} pen saves'`).
- [ ] **Step 4: Implement** in place. Elements are built once in `mount`/`buildTile` and only their text, `hidden` and `data-*` change in `update`.
  - The band reuses the existing `situationTick` and `openSituation`, and writes both the band and the dock seconds in one function.
  - The page tint during a situation stays as R1 has it.
- [ ] **Step 5: Mixed cache.** R2 `live.js` with R3 `tracker.css`: today's `.live-score`, `.score-dash` and `.pips` rules stay, under the R4 removal tag, wherever the new rules changed them. R3 `live.js` with R2 CSS: the band shows as an unstyled line, and nothing overlaps.
- [ ] **Step 6:** `npm test`; `npx playwright test --list`.
- [ ] **Step 7: Commit.** `feat(tracker): live header row, situation band, board tiles and goalie sheet`.

### Task 5: Events sheet (Codex, high)

**Files:**
- Modify: `js/tracker/views/events.js`, `js/ui/overlay.js`, `js/strings.js`, `css/tracker.css`
- Test: `tests/e2e/tracker-events.spec.js`, `tests/e2e/offline.spec.js` (it uses `ev-*`), `tests/e2e/tracker-helpers.js`

**Interfaces:**
- Consumes: `timelineRows(events)` from `js/model.js` (exists at 720f124) for the running score. `icon(name)` from `js/icons.js` through a caught `import()`.
- Produces: `editEvent(row)` in `tests/e2e/tracker-helpers.js`. It clicks the row's `ev-edit` and waits for its editor.

- [ ] **Step 1: Failing e2e** (tracker-events), for the board TEvents:
  - The sheet head holds the title, a close X (`events-close`, `aria-label` "Close events", 48 px) and one row with `open-lineup` and `end-game`.
  - The list is grouped under period headings: the newest period first, with "· newest first" on the first heading.
  - Each `ev-row` has an icon box (`data-kind` = goal | oppGoal | save | excl | pen | situation), the label (`eventLabel`), and a meta line (`data-testid="ev-meta"`). The meta line has the running score after goals and opponent goals, "Man-up · " in front of a man-up goal, and "Third · out" on a foul-out.
  - `ev-delete` is a 44 px icon button with `aria-label` "Delete {label}".
- [ ] **Step 2: Failing e2e:**
  - Goal rows have `ev-edit` labelled "Change scorer". Other rows have `ev-edit` labelled "Edit" only when they have an editor (a save with a goalie choice, an opponent goal with an in-goal choice).
  - Clicking it shows that row's editor: today's `ev-scorer`, `ev-manup`, `ev-goalie`, `ev-in-goal`, unchanged and with the same test ids. Clicking it again hides the editor.
  - The editor stays open across a snapshot. Test: open it, then write the game from Firestore. Expect the editor still open and the `<select>` still the same element (mark it with `evaluate`; the mark survives).
  - Rewrite every existing test that uses `ev-scorer`/`ev-manup`/`ev-goalie`/`ev-in-goal` to call `editEvent(row)` first.
- [ ] **Step 3: Overlay.**
  - Add a grabber bar (`.sheet-grabber`, `aria-hidden`) at the top of every bottom sheet.
  - The close button becomes an X icon with `aria-label` = `t('sheetClose')` + title ("Close events"). Its test id is unchanged.
  - Lineup and goalie sheets get the same change, and their tests keep passing.
- [ ] **Step 4: Implement** in place: one record per event id holds the row and an `editing` flag. Keep `add-unknown-goal`, `add-goal-period` and `period-prev`, in a row under the list. The same panel is used in the game detail (`createEventsPanel`), so the detail shows the same rows.
- [ ] **Step 5: Mixed cache.** R3 `events.js` with an R2 `overlay.js` still works (no new named imports from `overlay.js`). R2 `events.js` with R3 CSS keeps today's `.ev-line`/`.ev-controls` look, under the R4 removal tag.
- [ ] **Step 6:** `npm test`; `npx playwright test --list`.
- [ ] **Step 7: Commit.** `feat(tracker): board events sheet with per-row editors`.

### Task 6: Home, past games, game detail (Codex, medium)

**Files:**
- Modify: `js/tracker/views/home.js`, `js/tracker/views/games.js`, `js/strings.js`, `css/tracker.css`
- Test: `tests/e2e/tracker-live.spec.js` (home), and the past-games/detail tests (find them with `grep -rln "game-row\|games-list\|game-score" tests/e2e`)

**Interfaces:**
- Consumes: `state.game`, `state.team.roster`, `ctx.repo.listGames()`, `deriveScore`, `hasShootout`, `formatDate`, `scoreText`. All exist at 720f124.

- [ ] **Step 1: Failing e2e** (home, board THome):
  - With a live game, `home-live` is a board card: `LIVE · Q3` (Shootout: `LIVE · Shootout`), the date, team name, score `9 : 7` (`data-testid="home-live-score"`) and the opponent. `home-resume` ("Continue tracking") is inside it.
  - With no live game, there is no card and `home-new` comes first.
  - The nav is one card of rows with an icon and a chevron: `home-new`, `home-roster` with "16 players" (`data-testid="home-roster-count"`, roster entries with `archived !== true`), and `home-games` with the game count (`home-games-count`, hidden until `listGames()` answers, still hidden when it fails).
- [ ] **Step 2: Failing e2e** (past games, board TPast). Each `game-row` has:
  - a result chip (`data-testid="game-chip"`): W for won, L for lost, D for a level final. A shootout decides W/L. The chip's `aria-label` is "Won"/"Lost"/"Draw".
  - for a live game, a `LIVE` chip in its place;
  - the opponent, the date with " · pen. 4–3" for a shootout, the score, and a chevron.
  - Its `aria-label` is unchanged.
- [ ] **Step 3: Failing e2e** (game detail, board TGameDetail):
  - `games-back` reads "‹ Past games".
  - `game-score` sits in a dark scoreboard card: a FINAL or LIVE badge and the date, then two rows (team name + score, opponent + score), then the shootout line when there is one.
  - Under the card come the events panel, the info form and the actions (`reopen-game`, `delete-game`), each in a card, with every existing test id and behaviour unchanged.
- [ ] **Step 4: Implement.**
  - The home count reads once per mount and is cancelled on unmount (no write after unmount).
  - The W/L/D outcome is `resultOutcome(gameResult(game))` from `js/model.js`. Both exist at 720f124, so named imports are fine. It is shown only for `status === 'final'`.
- [ ] **Step 5: Mixed cache.** R2 `home.js`/`games.js` with R3 CSS keep their look (`.home .stack`, `.game-row` rules under the R4 tag).
- [ ] **Step 6:** `npm test`; `npx playwright test --list`.
- [ ] **Step 7: Commit.** `feat(tracker): home live card and nav, result chips, game detail scoreboard`.

### Task 7: New game in two steps (Codex, medium)

**Files:**
- Modify: `js/tracker/views/newgame.js`, `js/strings.js`, `css/tracker.css`
- Test: the new-game e2e (find it with `grep -rln "start-game" tests/e2e`), `tests/e2e/tracker-helpers.js` if it drives the form

**Interfaces:**
- Produces: `newgame-next` (button "Next: who is playing", step 1) and `newgame-back` (step 2, "‹ Game details"). `start-game` stays on step 2.

- [ ] **Step 1: Failing e2e:**
  - Step 1 shows `opponent-input`, `date-input` and `season-input`, plus `newgame-next`; `sel-list` is hidden.
  - With an empty opponent, Next shows today's opponent error and stays on step 1.
  - Next shows step 2 (`sel-list`, `start-game`) and moves focus to the step 2 heading.
  - Back returns to step 1 with the typed values kept.
  - Starting a game writes the same Firestore document as today (assert opponent, date, season and lineup in Firestore).
  - A season error found at Start returns to step 1 with `season-error` shown.
- [ ] **Step 2: Implement** as two sections in the one view, with no new route. Enter in the opponent field goes to Next.
- [ ] **Step 3:** Update every test or helper that fills the form and clicks `start-game`, so it clicks `newgame-next` first.
- [ ] **Step 4: Mixed cache.** R2 `newgame.js` with R3 CSS keeps a usable one-page form.
- [ ] **Step 5:** `npm test`; `npx playwright test --list`.
- [ ] **Step 6: Commit.** `feat(tracker): new game in two steps`.

### Task 8: Landscape split, 360 px worst case, service-worker cache (sonnet)

**Files:**
- Modify: `css/tracker.css`; `js/tracker/views/live.js` only if a wrapper is unavoidable; `sw.js` (`CACHE` to `wp-shell-v4`)
- Test: `tests/e2e/tracker-look.spec.js`

**Interfaces:**
- Consumes: Task 3's header, Task 4's `.live-top` and `.situation-band`, the dock.

- [ ] **Step 1: Failing e2e** (landscape, 844×390 and 667×375, board TLandscape): on the live screen, the header, the scoreboard row, the situation band and the dock sit in a left column no wider than 300 px. The tiles fill the right side in two columns (two tiles share a `top`). No sideways scroll. Every dock button is fully visible and at least 44 px.
- [ ] **Step 2: Implement.** Prefer CSS only, under `@media (orientation: landscape) and (max-height: 500px)` on `body.on-live`. Add a wrapper only if CSS can't place the elements. Then keep the DOM order (header, banners, scoreboard, tiles, dock) for screen readers, and keep every test id.
- [ ] **Step 3: Failing e2e** (360×740 worst case, light, every club colour):
  - live: two-digit caps, a long Greek name, 3 pips, a 2-digit goal count, man-down band, unsaved banner;
  - events sheet: a long Greek goal label with Change scorer;
  - home: live card with a long Greek opponent;
  - past games: a shootout row.

  No sideways scroll. Names are ellipsised on one line, `scrollWidth > clientWidth` on the name element. Buttons stay at least 44 px.
- [ ] **Step 4:** Fix whatever Step 3 finds, in CSS.
- [ ] **Step 5:** Bump `CACHE` in `sw.js` to `wp-shell-v4`. `tests/unit/sw-shell.test.js` passes.
- [ ] **Step 6:** Full e2e run. Expected: all pass, except flakes on the known waiver list (memory `e2e-known-flakes`), each re-run alone and passing.
- [ ] **Step 7: Commit.** `feat(tracker): landscape split; 360 px worst case; cache v4`.

### After Task 8 (controller)

- Final whole-branch review by sonnet (Codex wrote Tasks 1–7), with Codex reviewing Task 8.
- Canvas page "R3 build": design-vs-build screenshot pairs at 390 px, 360 px strips, the landscape screenshot and a club-colour row. The owner approves it there.
- After merge and deploy: re-sync the design system artifact to R3 (owner, 20/11/2026: one re-sync after R3).
