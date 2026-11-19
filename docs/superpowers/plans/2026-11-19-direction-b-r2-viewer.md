# Direction B, Release 2 (viewer structure) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the viewer direction B's structure:
- the season as the home page, with a LIVE banner;
- tabbed game and home screens;
- a centre-line timeline;
- Team tabs built from data the tracker already records.

**Architecture:**
- **Pure logic first, written by Codex.** `js/model.js` gains `timelineRows` and `resultOutcome`, and `gameResult` gains `excl`, `pens` and `quarters`. A new `js/teamStats.js` turns a game, or a season `stats` document, into plain numbers.
- **DOM work** stays in `js/viewer.js`. The viewer's routing, watches and home season are decided by a pure function, `model.viewerState` (Task 3).
- **Optional modules:** two new modules, `js/icons.js` (stroke icons) and `js/teamView.js` (the Team panels), load through caught dynamic `import()`s with visible fallbacks. A phone whose cache mixes this release with R1 keeps a working viewer.

**Tech Stack:** Vanilla ES modules, CSS custom properties, `node --test` unit tests, Playwright e2e against the Firebase emulators, service-worker app shell (`sw.js`).

**Spec:** `docs/superpowers/specs/2026-11-19-direction-b-redesign-design.md`. The plan covers these sections:
- "Release 2 — viewer structure";
- "Constraints (all releases)";
- "Testing (every release)".

Where this plan and the spec differ, the spec wins, except for the decisions listed below.

## Decisions this plan adds (for the owner to check)

1. **Optional modules:** the Team panels and the new icons load as optional modules. If a phone's cache lacks them, the Team tab says it isn't available and the timeline keeps today's glyphs. The rest of the viewer works.
2. **No season list under a game:** the game screen has no season list under it, as on the boards. "This season" at the top goes back to home.
3. **Banner on past games:** the LIVE banner also shows on a past game's screen while another game is live, as today.
4. **Date while live:** a live game's date is not on the scoreboard; the timeline heading carries it, including on an empty timeline. A final game shows it next to FINAL.
5. **Foul trouble** is counted like the Players tab, over all periods including the shootout, so "Out" agrees everywhere. The rest of the Team tab excludes the shootout, as the spec says.
6. **Season stats:** the season `stats` document is read on home only.
7. **Review rulings** (from three Codex plan-review rounds):
   - The fallback for an R1 `model.js` beside an R2 `viewer.js` is deliberately simple. It never shows a wrong season, but in rare cases it can stay on loading until the next reload.
   - The proof that a shared game link renders without waiting for the team is the Task 3 unit test; a Firestore callback can't be held back in e2e.
8. **Never behind:** "· never behind" is appended whenever the score never went below level, including a 0–0 game, as the spec's wording says.

## Global Constraints

- **Who runs what:**
  - **Codex tasks (1, 2, 3)** are unit-only. Codex cannot bind ports or commit, so the controller runs `npm run test:emu` and commits.
  - **Sonnet tasks (4–9)** run their own unit and e2e suites and commit.
- **Mixed cache:**
  - **Previous release:** R1, main `58f859d`. A phone can mix any of this release's files with that release's.
  - **New modules:** `js/teamStats.js`, `js/teamView.js` and `js/icons.js` are never statically imported by `viewer.js`.
    - `viewer.js` loads `icons.js` and `teamView.js` with caught dynamic `import()`s.
    - `teamView.js` imports `teamStats.js` statically; the two load or fail together.
  - **New exports** of existing modules (`model.timelineRows`, `model.resultOutcome`) are read off the `model` namespace with `?.` and a fallback. No new named imports.
  - **`teamConfig.crest ?? null`.**
  - **New `stats` fields** (`excl`, `pens`, `quarters`) are optional on every result. A missing or malformed field hides that figure or shows "–", never `undefined` or `NaN`.
  - **New strings** live in `js/strings.js`. They degrade to key names, and a missing string never hides a score, a date or a name.
- **CSS:**
  - Restructured elements get new class names.
  - R1 rules for class names the new DOM no longer renders stay in `css/viewer.css` under `/* R1 markup, kept for mixed caches; remove in R3 */`. An R1 `viewer.js` with this release's `viewer.css`, and the reverse, must still show a readable score and timeline.
  - New custom properties are read with a fallback. Every hex colour sits in a custom-property declaration (`tests/unit/tokens.test.js`).
- **Look:** from the canvas boards, each with its `…Dark` twin: `VSeason`, `VSeasonLive`, `VSeasonPlayers`, `VSeasonTeam`, `VGame`, `VGameFinal`, `VGamePast`, `VGamePlayers`, `VGameTeam`, `VGame360` and `VGameReconnect`.
  - The plan workspace also gets the Tokens page boards, which hold the icons, the crest plate rules and the sizes. The controller copies all of them to `boards/<Name>.dc.html` before Task 4.
  - Sample data on the boards is invented.
  - Sizes: tabs ≥ 50 px tall, the LIVE banner ≥ 56 px, every control ≥ 44 px.
- **Test ids:**
  - Keep every existing `data-testid` unless a task names it as replaced or removed.
  - At most one `role="tablist"` is in the DOM.
  - New ids are named in each task, exactly as written.
- **Icons:** stroke SVGs on a 24 grid, 2 px stroke, round caps, built with `createElementNS`, never `innerHTML`. The `tl*Sr` strings stay as the accessible text. The glyph strings (`tlSaveIcon` …) stay, as the fallback.
- **Behaviour kept:**
  - The celebration shows on the game screen only.
  - The connection note works as today.
  - `#/game/<id>` links open the game directly, without waiting for the team document.
  - Dates are DD/MM/YYYY; numbers use tabular figures.
- **360 px worst case:** two-digit caps, the longest Greek names in the seeds, all badges. No sideways page scroll, portrait and landscape. Names ellipsize on one line.
- **Dark, reduced motion, club colours:**
  - Every new screen works in light and dark.
  - Animations keep a `prefers-reduced-motion: reduce` variant.
  - Text contrast is ≥ 4.5:1, and bars and borders ≥ 3:1, for blue `#0057b8`, red `#c8102e`, yellow `#f2b705` and green `#00843d`, in both schemes.
- **e2e:**
  - No `waitForTimeout`, except to check that nothing happened; say why there is nothing to wait on.
  - Every assertion must be able to fail. Prove each new one with a temporary break and record it in the report. A check of existing behaviour that starts green is proved the same way.
  - Writes are checked in Firestore.
  - Module-failure cases use `test.use({ serviceWorkers: 'block' })`, so the worker can't serve a cached copy. They filter out exactly the injected failure's console error, as `viewer-celebration.spec.js`'s mixed-cache tests do.
  - Focused run: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npx firebase emulators:exec --only firestore,auth --project demo-scoretracker "npx playwright test <files> --reporter=list"`.
- **Retired assertions:** a task that removes or replaces behaviour migrates the assertions that pinned it in the same commit. Its report lists each deleted assertion with its replacement, or "behaviour removed by the spec".
- **Commits:** each commit carries the trailer of the model that wrote it:
  - Codex: `Co-Authored-By: GPT-6.2 Sol (Codex) <noreply@openai.com>`;
  - Sonnet: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A mixed cache on match day.** Task 10 checks each case below independently:
   - each R1 dependency (`config.js`, `model.js`, `strings.js`, `viewer.css`) beside R2 `viewer.js`;
   - R1 `viewer.js` beside R2's modules and CSS;
   - each optional module missing (`icons.js`, `teamView.js`, `teamStats.js`).

   Each must still show the score, the timeline and the home results.
2. **Home while the connection is poor.** A cached or missing current game, going offline, and the current game being deleted or moved on must never leave home stuck on loading. Home must never show one season's results under another, or flash. Task 3's unit tests and Task 4's transition tests pin it.
3. **An older season's `stats` document without the new fields.** The season Team tab shows "–" and the coverage lines, never `NaN`, `undefined` or a crash. Tasks 2 and 9 test it.
4. **Edited history.** A goal added later to an earlier quarter, a deleted man-up start, a goal with no valid quarter, or a third foul in the shootout gives consistent running scores, quarter markers, grids and Team numbers. The Task 1 and 2 unit tests cover these.
5. **A shootout game.** The quarter grid and the Team tab exclude the shootout. The timeline has a Shootout group with shootout pills. The results row shows "pen. 4–3", with W/L decided by the shootout. Tasks 1, 2, 5, 6 and 8 test it.

---

### Task 1: Model additions (Codex, high)

**Files:**
- Modify: `js/model.js` (`gameResult`, new exports)
- Test: `tests/unit/model.game.test.js`, `tests/unit/model.season.test.js`, `tests/emulator/repo.test.js`

**Interfaces:**
- Produces:
  - **`gameResult(game)`** additionally returns `excl: number`, `pens: number` and `quarters: [{us, them} ×4]`:
    - `excl` and `pens` count our `excl` and `pen` events in periods 1–4.
    - `quarters` counts `goal` and `oppGoal` events per period 1–4.
    - All three are present on every result. Existing fields are unchanged, so a goal with no valid period still counts in `us`/`them`, as today.
  - **`resultOutcome(result): 'W'|'L'|'D'|null`:**
    - `null` unless `us` and `them` are finite numbers.
    - `us > them` gives W; `us < them` gives L.
    - On a level score, a shootout decides when `soUs` and `soThem` are finite, not both 0, and differ. Otherwise D.
  - **`timelineRows(events): Array<{ period, goals: {us, them}, events: Array<Event & {score?: {us, them}}> }>`:**
    - The groups, their membership and their order are exactly `timeline(events)`.
    - `goals` is the group's own `goal`/`oppGoal` count; for the shootout group, the shootout goals.
    - Each `goal`/`oppGoal` carries `score`, the running score after it:
      - in periods 1–4, cumulative in ascending order: period, then `ts`, then array order on a tie;
      - in the shootout, starting at 0–0.
    - Other events carry no `score`.
- Consumers: Tasks 5 and 8 (`model.resultOutcome?.`, `model.timelineRows?.`); Task 2 (fixtures are built with `gameResult`).

- [ ] **Step 1: Write the failing tests.**
  - **`gameResult` fixture game:** Q1 `goal`, Q2 `pen`, Q3 `goal`, Q3 `oppGoal`, SO `goal`, SO `excl`, and a `goal` with `period: 5`.
    - `quarters` is `[{us:1,them:0},{us:0,them:0},{us:1,them:1},{us:0,them:0}]`.
    - `excl` is 0, `pens` is 1, `us` is 3 and `them` is 1. The period-5 goal counts in `us` but in no quarter.
  - **Untracked game:** has all three fields.
  - **Firestore-safe shape:** `JSON.parse(JSON.stringify(result))` deep-equals the result. `quarters` is an array of 4 plain objects with no nested arrays and no `undefined`.
  - **`aggregateSeason`:** each `results[]` entry carries the three fields. Existing tests that deep-equal a result gain exactly these fields.
  - **`resultOutcome`:**
    - `{us:9,them:7}` gives W and `{us:3,them:5}` gives L.
    - `{us:8,them:8}` gives D, and so does `{us:8,them:8,soUs:0,soThem:0}`.
    - `{us:8,them:8,soUs:4,soThem:3}` gives W; `{…soUs:2,soThem:4}` gives L.
    - `{us:'x',them:1}` gives null.
  - **`timelineRows`:**
    - **Running score:** goals at Q1 ts 10 (us), Q1 ts 20 (them), Q2 ts 30 (us), plus a Q1 goal (us) at ts 40. The Q2 goal shows `{us:3,them:1}` and the ts-40 Q1 goal `{us:2,them:1}`. The Q1 group's `goals` is `{us:2,them:1}`.
    - **Tied `ts`:** two goals with the same `ts` take the running score in array order and display in reverse array order.
    - **Shootout:** the SO group's pills run 1–0, 1–1, 2–1. Its `goals` is the shootout count.
    - **No score elsewhere:** `excl` and `save` carry no `score`.
    - **Membership:** situation events and `gkIn` are absent, as in `timeline()`.
  - **Emulator test:** `recomputeSeason` on a game with goals in two quarters stores `results[0].quarters` as 4 maps with the right counts, read back from the emulator.
- [ ] **Step 2: Run** `npm test` and confirm the unit tests fail.
- [ ] **Step 3: Implement** in `js/model.js`. `timelineRows` reuses `timeline()` for grouping and computes the running scores in one ascending pass.
- [ ] **Step 4: Run** `npm test` (Codex), then `npm run test:emu` (controller). All must pass.
- [ ] **Step 5: Commit** (controller): `feat(model): result quarters, fouls and outcome; timeline rows with running scores`.

### Task 2: Team statistics module (Codex, high)

**Files:**
- Create: `js/teamStats.js`, `tests/unit/teamStats.test.js`, `tests/fixtures/team-game.js`, `tests/fixtures/season-stats.js`
- Modify: `sw.js` SHELL: add `'./js/teamStats.js'` (`tests/unit/sw-shell.test.js` requires it).

**Interfaces:**
- **Consumes:** `replaySituations`, `isTracked`, `manUpGoalIds` (`js/situations.js`); `playerLines`, `EXCL_LIMIT`, `gameResult` (`js/model.js`).
- **`pct(part, whole): number|null`:** returns `Math.round(100 * part / whole)`. It returns null unless both are finite, `whole > 0` and `part ≥ 0`.
- **`gameTeamStats(game)`** returns:
  ```
  { tracked: boolean,
    manUp:   { quarters: [{played, scored}×4], played, scored } | null,     // null when untracked
    manDown: { quarters: [{played, stopped}×4], played, stopped } | null,
    goals:   { for, against, manUpFor: number|null, manDownAgainst: number|null },
    fouls:   { quarters: [{excl, pens}×4], excl, pens },
    trouble: [{ playerId, name, cap, fouls, out }],
    pensAgainst: { faced, saved },
    flow:    { biggestLead, longestRun: {us, them} | null, ties, neverBehind, scorers } }
  ```
- **`seasonTeamStats(stats)`** returns:
  ```
  { games: [{ gameId, opponent, date, manUp: {played, scored}|null, manDown: {played, stopped}|null, excl: number|null }],
    total:    { manUp: {played, scored}, manDown: {played, stopped}, situationGames, excl, exclGames },
    quarters: { for: [n×4], against: [n×4], diff: [n×4], totalFor, totalAgainst, totalDiff, covered, of },
    goals:    { for, against, manUpFor, manDownAgainst, situationGames, of } }
  ```
- **Fixtures** (ES modules, plain JSON-safe objects that are valid game and `stats` documents; ids are stable):
  - **`tests/fixtures/team-game.js`** exports:
    - `teamGame`: final, `situations: true`, `season: '2026-27'`, `date: '2026-11-16'`, `id: 'team-g1'`. The lineup has a two-digit cap and a long Greek name. The events cover:
      - man-ups scored and missed in different quarters;
      - man-downs stopped and conceded;
      - a player on two fouls;
      - a foul-out by penalty fouls;
      - penalties faced and saved;
      - a level score at least once.
    - `teamGameExpected`: its exact `gameTeamStats` output, written by hand as a literal, not computed.
  - **`tests/fixtures/season-stats.js`** exports four objects. `seasonStatsFull` is a `stats/2026-27` document whose `results` has 4 entries:
    - one untracked, with no `manUp`/`manDown`;
    - one without `quarters`, as an R1 tracker wrote it;
    - two complete.

    It also has `players` and `goalies` maps. `seasonStatsOld` is the same document without `excl`, `pens` and `quarters` on any result. `seasonStatsFullExpected` and `seasonStatsOldExpected` are hand-written literals.
- **Rules:**
  - **Periods:** 1–4 only. The shootout is excluded from every figure except `trouble` (Decision 5). Events are taken in `ts` order with a stable sort.
  - **`manUp`/`manDown`:** from the closed situations of `replaySituations(game)`, by `period`.
  - **Goals:**
    - `goals.for`/`against` count `goal`/`oppGoal` in periods 1–4.
    - `manUpFor` is the size of `manUpGoalIds(game)`. `manDownAgainst` counts closed man-downs with outcome `conceded`.
    - Both are `null` when untracked.
  - **Fouls:**
    - `fouls` counts our `excl`/`pen` events per quarter, periods 1–4.
    - `pensAgainst.faced` counts `pen` events and `.saved` counts `penSave` events, both in periods 1–4.
  - **`trouble`:**
    - Built from `playerLines(game.lineup, game.events)`, which counts all periods.
    - Lists players with `excl + pens ≥ 2`; `out` means `excl + pens ≥ EXCL_LIMIT`.
    - Order: players not out first, by cap ascending; then out players, by cap ascending.
  - **`flow`:** over `goal`/`oppGoal` in periods 1–4, in `ts` order.
    - `biggestLead`: the maximum of `us − them` after any goal, floored at 0. 0 means never ahead.
    - `longestRun`: the longest streak of goals by one side, from our side: `{us:3,them:0}` or `{us:0,them:3}`. Ours wins a tie in length; `null` with no goals.
    - `ties`: the number of goals that made the score level.
    - `neverBehind`: true when `us − them` never went below 0, including with no goals.
    - `scorers`: the count of distinct non-null `playerId`s of our goals.
  - **`seasonTeamStats`:**
    - `games` follow `stats.results` order.
    - A result's situations are valid only when both are valid:
      - `manUp` is `{played, scored}` with non-negative integers and `scored ≤ played`;
      - `manDown` is `{played, stopped}` likewise.

      Otherwise both are `null`. Only results with both valid count toward `situationGames`, `total.manUp/manDown`, `goals.manUpFor` (Σ `scored`) and `goals.manDownAgainst` (Σ `played − stopped`).
    - `excl` is `null` unless it is a non-negative integer. `exclGames` counts the results where it isn't null.
    - `quarters` uses a result only if it is an array of 4 objects with non-negative integer `us`/`them`. `covered` counts those and `of` is `results.length`. The totals are the sums of the quarter columns.
    - `goals.for`/`against` sum finite `us`/`them` over all results.
    - A `null`, `undefined` or garbage `stats` document gives empty arrays and zeros, never `NaN`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/teamStats.test.js`:
  - **no events:** every count is 0, `longestRun` null, `biggestLead` 0, `neverBehind` true and `trouble` empty;
  - **opponent-only game** (0–3): `biggestLead` 0, `longestRun` `{us:0,them:3}`, `neverBehind` false;
  - **untracked:** `tracked` false, `manUp`, `manDown`, `manUpFor` and `manDownAgainst` null, with goals and fouls still counted;
  - **shootout game:** shootout goals and fouls are absent from `goals`, `fouls`, `flow` and `pensAgainst`;
  - **third foul in the shootout:** the player is in `trouble` with `out` true, and `fouls.quarters` excludes the shootout foul;
  - **deleted man-up start:** an orphan `manUpEnd` changes nothing, matching `replaySituations`;
  - **foul-out by penalty fouls:** two `pen` and one `excl` give `out` true;
  - **trouble order:** two players on two fouls (caps 9 and 4) list as 4 then 9, and two out players, cap 3 on 3 fouls and cap 12 on 4 fouls, list after them as 3 then 12 (cap order, not fouls);
  - **longest-run tie:** a 2–0 run and a 0–2 run give `{us:2,them:0}`;
  - **fixtures:**
    - `gameTeamStats(teamGame)` deep-equals `teamGameExpected`;
    - `seasonTeamStats(seasonStatsFull)` deep-equals `seasonStatsFullExpected`, with `quarters.covered` 3, `of` 4 and `situationGames` 3;
    - the old fixture deep-equals its expectation, with `covered` 0 and `exclGames` 0;
  - **garbage:** `seasonTeamStats(null)`, a result with `quarters: [[1,2]]`, and a result with `manUp: {played: 2, scored: 5}`. Walking each output finds no `NaN` and no `undefined`, and the bad entries count as absent;
  - **`pct`:** `pct(3, 5)` is 60; `pct(0, 0)`, `pct(1, NaN)` and `pct(-1, 4)` are null.
- [ ] **Step 2: Run** `npm test` and confirm the new tests fail.
- [ ] **Step 3: Implement** `js/teamStats.js`, a pure module with no DOM, no strings and no Firestore.
- [ ] **Step 4: Run** `npm test` and confirm everything passes.
- [ ] **Step 5: Commit** (controller): `feat(team): game and season team statistics`.

### Task 3: Viewer state function (Codex, high)

**Files:**
- Modify: `js/model.js` (new export `viewerState`)
- Test: `tests/unit/viewerState.test.js` (new)

**Interfaces:**
- Produces `viewerState(input) → plan`. The function is pure and replaces R1's `viewMode`/`follow`/`followSeason` rules.
- **Input:**
  ```
  { route: { kind: 'home'|'game'|'invalid', id?: string },
    team:  { data, meta },                 // data: undefined | null | { currentGameId, … }
    game:  { key, data, meta },            // the routed-game watch; key = the id it watches, or null
    live:  { key, data, meta },            // the current-game watch
    stats: { key, data, meta },            // the season stats watch; key = the season it watches
    offline: boolean,                      // navigator offline, or the stale timer fired
    calendarSeason: string,                // seasonFor(todayIso()), computed by the caller
    lastSeason: string|null,               // the season this function last published, kept by the caller
    lastShown: { gameKey, mode, statsKey, results } | null }   // what the last render showed, kept by the caller
  ```
  `meta` is `{ fromCache?, error? }`. `error` marks a failed watch: an error callback, a subscribe that threw, or no first snapshot within the 6 s deadline. A failed watch is never read as a confirmed absence. Data whose `key` differs from the key the plan wants counts as `undefined`.
- **Output:**
  ```
  { watch:   { game: string|null, live: string|null, stats: string|null },
    tracked: { team: true, game: boolean, live: boolean, stats: boolean },   // which watches the stale timer awaits
    mode:    'loading'|'home'|'game'|'unavailable',
    season:  string|null,                  // the home season to show (null off home)
    results: 'loading'|'empty'|'ready'|'failed'|null,   // home only
    banner:  { gameId: string }|null }
  ```
- **Rules.** `settled(w)` is `w.data !== undefined && (w.data !== null || !w.meta?.fromCache || w.meta?.error || offline)`.
  - **Watches:**
    - `watch.game` is the routed id on a game route, else null.
    - `currentId` is `team.data?.currentGameId ?? null`.
    - `watch.live` is `currentId`, unless it is null or the route is that same game.
    - `watch.stats` is `season` on home, else null.
    - `tracked.game` is true on a game route; `tracked.live` and `tracked.stats` are true on home.
  - **The current game** is `game.data` when routed to `currentId`, else `live.data`, after the key check.
  - **Home season candidate:**
    - Unresolved while `team.data` is undefined, or null and not settled.
    - When the team watch has `error`: `lastSeason ?? calendarSeason`.
    - When `currentId` is null: the calendar season if the team snapshot is authoritative (not `fromCache`, or offline); else unresolved. A cached roster-only team may be behind a server pointer.
    - Unresolved while the current game is undefined.
    - The game's `season` when it has data, cached or not.
    - When it is null and settled, `lastSeason ?? calendarSeason`. This covers a deletion seen before the team pointer moves, and a pointer to a missing game.
    - Unresolved when it is null and not settled.

    `season` is the candidate when resolved, else `lastSeason` (retained). It is null only when nothing has resolved yet.
  - **`mode`:**
    - `invalid` gives `'unavailable'`.
    - A game route gives `'loading'` while `game` is undefined; when null, `'unavailable'` if settled, else `'loading'`; `'game'` with data. The team is never waited for.
    - Home gives `'loading'` while `team.data` is undefined, else `'home'`.
  - **`results`** (home only):
    - `'loading'` while `season` is null, or `stats` is undefined for that key.
    - `'failed'` when the stats watch has `error`.
    - When `stats.data` is null: `'empty'` if settled, else `'loading'`.
    - `'ready'` when `stats.data.results` is a non-empty array, else `'empty'`.
  - **Hold what's shown:** a cached null, settled only because the viewer was offline, stops being settled on reconnect. Until an authoritative snapshot (server or error) arrives for the same key, keep the last displayed outcome:
    - `results` keeps `lastShown.results` when `lastShown.statsKey` is the current stats key and the new value would be `'loading'`;
    - `mode` keeps `'unavailable'` when `lastShown.gameKey` is the routed id and the new value would be `'loading'`.
  - **`banner`:** the current game, when it has data with `status === 'live'`, `mode !== 'loading'`, and the route is not that game.

- [ ] **Step 1: Write the failing tests** in `tests/unit/viewerState.test.js`, each as a sequence of inputs that asserts every intermediate plan. The cases:
  - **direct link:** `#/game/g1` with the team undefined gives `mode` `'game'` once the game has data; the team never gates it;
  - **failed watch:** a game with `{data: null, meta: {error: true}}` gives `'unavailable'`. A current game with an error on home uses `lastSeason ?? calendarSeason`;
  - **cached hit:** a current game from cache resolves the season at once;
  - **online cache miss:** current game `null` with `fromCache` while online. `season` stays the retained one, and `results` stays `'ready'` when the stored stats match it. On a cold start, `season` is null and `results` is `'loading'`;
  - **cached roster-only team:** a cached team with no `currentGameId` while online leaves the season unresolved. A server snapshot that then points to a game in another season gives that game's season, with no calendar season published in between;
  - **team watch failure:** keeps `lastSeason`, or uses the calendar season on a cold start;
  - **offline fallback:** the same while offline gives the calendar season;
  - **reconnect:** going online again, before the server answers, keeps the retained calendar season and the shown `results` (`'empty'` stays `'empty'`). A routed cached-null game keeps `'unavailable'`;
  - **failed stats:** `results` is `'failed'`, not `'empty'`;
  - **errors on each watch:** an `error` meta on team, game, live and stats in turn, on home and on a game route. Nothing stays `'loading'`;
  - **pointer change, team first:** the old season is retained while the new game loads. In the same season, `watch.stats` never changes. In another season, it switches only when the new game arrives;
  - **deletion first:** the current game becomes null (server) before the pointer moves. The retained season holds, and no calendar season appears when one was already shown;
  - **stale keys:** stats stored under a key different from `plan.season` count as undefined, so results are `'loading'`, never another season's. Stats under the retained season stay `'ready'`;
  - **live game ends on home:** `banner` goes from `{gameId}` to null and `results` follows the stats;
  - **live game ends on its own route** with the pointer moving in either order: `mode` stays `'game'` and `watch.game` stays the routed id;
  - **past game while another is live:** `banner` names the live game;
  - **`#/games` and `#/`** both arrive as `route.kind === 'home'` (the caller's parser maps them); this test documents the input.
- [ ] **Step 2: Run** `npm test` and confirm the tests fail.
- [ ] **Step 3: Implement** `viewerState` in `js/model.js`, with no DOM and no Firestore.
- [ ] **Step 4: Run** `npm test` and confirm everything passes.
- [ ] **Step 5: Commit** (controller): `feat(model): viewer state function for routing, watches and the home season`.

### Task 4: Wire the state function; home is the season (sonnet)

**Files:**
- Modify:
  - `js/viewer.js`: routing parser, watches, render loop, a minimal home, the banner link and the back link;
  - `js/repo.js`: `watchTeam`, `watchGame` and `watchStats` take an optional last argument `onError(err)`, passed to `onSnapshot` as its error callback. Without it, behaviour is unchanged, so the tracker is untouched;
  - `js/strings.js`, `js/config.js`: add `crest: 'img/anog-crest.png'` to `team`;
  - `sw.js`: cache `wp-shell-v3`, and SHELL adds `'./img/anog-crest.png'`;
  - the cache-name pins `tests/unit/sw-shell.test.js`, `tests/unit/sw-fetch.test.js`, `tests/unit/brand.test.js:54` and `tests/e2e/offline.spec.js` (v2 → v3);
  - `tests/e2e/helpers.js`.
- Rewrite: `tests/e2e/viewer-games-list.spec.js` → `tests/e2e/viewer-home.spec.js`.
- Migrate every spec that expects the live game on home, or the season block under a game:
  - `viewer.spec.js` (including 94–106, 202–213, 259–286);
  - `viewer-celebration.spec.js`, `viewer-quarter-scores.spec.js`, `viewer-past-games.spec.js`, `viewer-look.spec.js`, `offline.spec.js`;
  - `tracker-access.spec.js:53–61`, `tracker-live.spec.js:217–227`, `tracker-events.spec.js:101–103,225–252,288–289`.
  - The R1 Watch focus test in `viewer-look.spec.js` moves from `watch-live` to `live-banner`.

**Wiring:**
- **Route parser:** `#/game/<id>` is a game, and an invalid id is `invalid`. Every other hash, including `#/games`, is home.
- **Watch state:** each watch stores `{ key, data, meta }`.
  - A key change unsubscribes the old watch and stores `{ key: newKey, data: undefined }`.
  - A subscribe that throws, an `onError` call, or no first snapshot within `STALE_MS` (6 s) stores `{ data: null, meta: { error: true } }` for that key. A later snapshot replaces it. The deadline also covers an R1 `repo.js` that ignores `onError`.
  - Snapshot and error callbacks carry their subscription's token and are ignored once that subscription was replaced.
- **One loop:** every event (team, game, live and stats snapshots and errors; `hashchange`; online and offline; the stale timer; a watch deadline) runs `update()`. It:
  1. computes `plan = model.viewerState(input)`;
  2. applies `plan.watch`. Resubscribing resets that watch's data; a synchronous failure stores the error state. Nothing renders here;
  3. repeats from step 1 while any active key differs from `plan.watch`, or a sync failure changed state, up to 5 times;
  4. reconciles the stale tracking against the active keys and `plan.tracked`;
  5. sets `lastSeason` from the final plan's `season` (when non-null), and `lastShown` from what it is about to render;
  6. renders once.

  R1's render calls inside `resubscribe` and `syncStaleTimer` are removed.
- **Fallback:** when `model.viewerState` is missing (an R1 `model.js`), `viewer.js` uses a small inline rule set. It never guesses a season:
  - `mode` as in Task 3, without the hold rule;
  - season is the current game's `season`, or the calendar season only when the team is server-confirmed with no current game;
  - otherwise results stay `'loading'`, and `team`, `game` and `live` are tracked as in R1.

  It is tested in Task 10.
- **Removed:** `ended`, `stayOnGame` and the `onLive` branch of the team watcher. Home never shows a game.
- **Banner:**
  - `data-testid="live-banner"` becomes `<a href="#/game/<liveId>">`.
  - Its text (`live-banner-text`) reads "LIVE · Q3 · ANOG 9–7 Vouliagmeni". `watch-live` becomes a `<span>`, "Watch", inside it.
  - It shows when `plan.banner` is set. Keyboard focus shows the ink outline (R1 Finding C, moved to the link).
  - Its look comes in Task 5.
- **Minimal home:**
  - The `games-list` header, then the season tables as today. The season MU/MD line (`season-situations`) is gone.
  - `results` `'loading'` shows a loading line; `'empty'` shows "No games yet this season." (`results-empty`); `'failed'` shows "Results aren't available right now." (`results-failed`). `empty-state` is removed.
  - The home element carries `data-season` and `data-results` from the plan, for tests.
- **Game screen:** `all-games` reads "This season" and points to `#/`, on every game screen and on unavailable. The season block under a game is removed.
- **Test helper:** `openLiveGame(page)` in `tests/e2e/helpers.js` opens home, clicks `live-banner` and waits for `score-us`.

- [ ] **Step 1: Write `viewer-home.spec.js`** (failing).

  Transition tests install, with `page.addInitScript`, a `MutationObserver` that records each distinct `(data-season, data-results, first result's opponent)` of the home element. They assert the forbidden states never appear in the record:
  - a season other than the old and new ones, including the calendar season when it is neither;
  - `results` `'loading'` or `'empty'` during a switch within one season;
  - `'empty'` during a switch between two seasons that both have results.

  Direct-link independence from the team is proven by Task 3's unit test; the e2e case checks the outcome.

  The cases:
  - **home with a live current game:** the header and the banner show, `score-us` has count 0, and clicking the banner opens `#/game/g1` with the scoreboard and "This season";
  - **`#/games`** renders the same as `#/`;
  - **no games:** `results-empty` shows and `empty-state` has count 0;
  - **ending the live game on home, pointer unchanged:** the banner goes, and a `result-row` appears once the test writes the stats document, as the tracker's recount would;
  - **ending it on home while the pointer moves to a newer game,** both write orders: the banner goes, and home settles on the newer game's season with no forbidden state recorded;
  - **ending it while on `#/game/g1`,** with the pointer moved before the game's final snapshot and in the other order: the page stays on the final score;
  - **a shared link before the team document:** open `#/game/g1` with `team/main` absent. The game renders, and nothing changes when the team is seeded;
  - **the current game deleted while on home:** the pointer moves to a game in another season, both orders. Use distinct seasons for the old game, the replacement and the calendar, and check the record;
  - **offline on home with a cached current game:** it renders with the connection note. Going online again records no loading flash;
  - **a past game's screen while another game is live:** the banner shows, and clicking it opens the live game;
  - **celebrations:** a goal written while on home adds no `.celebration`. The same write while on the game screen does, and that case sets the time bound for the negative.
  - **synchronous live failure on a cold home:** seed `team/main` with `currentGameId: 'bad/id'` (`doc()` throws). Home renders the calendar season's results, not an endless loading line;
  - **synchronous stats failure:** seed a current game whose `season` is `'20/26'`. Home shows `results-failed`;
  - **silent watches:** block Firestore's listen channel (`page.route('**/google.firestore.v1.Firestore/Listen/**', r => r.abort())`) before loading home. Within 15 s, home shows the connection note and `results-failed`, never a permanent loading line.
- [ ] **Step 2: Run** the focused spec and confirm it fails.
- [ ] **Step 3: Implement** the wiring, the `repo.js` error callback, the banner link, the back link and the minimal home, then bump the cache.
- [ ] **Step 4: Migrate** the listed specs.
  - Seeded games open `#/game/<id>`; games the tracker created use `openLiveGame(page)`.
  - Removed behaviour is listed per the Retired-assertions constraint.
- [ ] **Step 5: Run** `npm test`, the focused runs of every touched spec, then `npm run test:e2e`. All must pass.
- [ ] **Step 6: Commit:** `feat(viewer): home is the season; live game behind a banner`.

### Task 5: Home look — header, results, banner (sonnet)

**Files:**
- Modify: `js/viewer.js` (home rendering), `js/strings.js`, `css/viewer.css`
- Test: `tests/e2e/viewer-home.spec.js`, `tests/e2e/viewer-look.spec.js`, `tests/e2e/viewer-past-games.spec.js`, `tests/e2e/viewer.spec.js`

**Interfaces:**
- Consumes: `model.resultOutcome?.(result)` from Task 1. Without it, no chip shows.
- **Season header** (`games-list`, per `boards/VSeason*.dc.html`):
  - The team name, the crest (`data-testid="crest"`, 40 px, `alt=""`, plate rules from the Tokens boards) and "This season".
  - The record (`season-record`), e.g. "3 W · 1 L"; "· N D" is added when N > 0.
- **Results rows** (`result-row`, `result-link`, per `VSeason`):
  - A chip (`result-chip`: W green, L red, D grey, always with the letter).
  - The opponent and date stacked, the score, and a chevron.
  - The shootout suffix "pen. 4–3" shows when `soUs`/`soThem` are finite and not both 0, separate from the chip rule.
  - A result whose `us`/`them` are not finite shows "–" and no chip.
  - The whole row is a link of at least 44 × 44 px.
  - `result-situations` is removed.
- **Banner look** (`VSeasonLive`): amber, at least 56 px, the live dot pulsing (static with reduced motion), and a "Watch" affordance.

- [ ] **Step 1: Write the failing tests:**
  - **Record and chips:** for a seeded season of three wins, a loss and a level final, the record reads "3 W · 1 L · 1 D", and the chips read W, W, W, L, D in results order.
  - **Shootout row:** a level final won on a shootout shows a W chip and "pen. 4–3".
  - **Sizes:** the banner box is ≥ 56 px tall and each result link ≥ 44 × 44 px.
  - **Crest:** `crest` is visible and 40 px wide.
  - **360 px:** with a long Greek opponent, the banner and the result rows ellipsize, with no sideways scroll, light and dark.
  - **Reduced motion:** the banner's live dot has no running animation.
  - **Contrast:** the banner text against the banner is ≥ 4.5:1, and each chip's letter against its fill ≥ 4.5:1, in both schemes.
  - **Migrate:** the result-link checks (`viewer-past-games.spec.js:81–87`) move to the whole-row link, and the `result-situations` checks (`viewer.spec.js:415–455`) are retired (replacement in Task 9).
- [ ] **Step 2: Run** and confirm they fail.
- [ ] **Step 3: Implement** the home look.
- [ ] **Step 4: Run** `npm test`, the focused specs, then `npm run test:e2e`. All must pass.
- [ ] **Step 5: Commit:** `feat(viewer): season header, results chips and LIVE banner look`.

### Task 6: Game scoreboard (sonnet)

**Files:**
- Modify:
  - `js/viewer.js` (scoreboard skeleton and `renderGame`);
  - `js/strings.js`, `css/viewer.css`;
  - `index.html`, `track.html`, `js/tracker/views/live.js` (remove the lane-rope markup).
- Test: `tests/e2e/viewer.spec.js`, `tests/e2e/viewer-quarter-scores.spec.js`, `tests/e2e/viewer-look.spec.js`, `tests/e2e/tracker-look.spec.js`

**Interfaces:**
- **Kept:** `score-us`, `score-them`, `live-badge`, `final-badge`, `period`, `situation-badge`, `game-date`, `shootout`, `quarter-scores`.
- **Situation chip:** `situation-badge` gets `data-kind="manUp"|"manDown"` and a matching class. Man-up is a green fill with white text; man-down an orange fill with ink text.
- **Quarter grid:** `quarter-scores` becomes a `<table>`.
  - The head row reads Q1–Q4. The current quarter's head cell has `aria-current="true"` and `--led` text.
  - Body rows: `quarter-us`, labelled with the team name, and `quarter-them`, labelled with the opponent's first three characters (`Array.from`, then `toLocaleUpperCase('el')`).
  - Future quarters show "–".
  - The grid shows for live and final games whose quarter goals add up to the score. In the shootout no quarter is current.
- **Crest:** `crest`, 40 px, after the team name in the first score row.
- **Removed:** `game-manup` and `game-mandown`; they move to the Team tab in Task 9.

**Layout** (`boards/VGame*.dc.html`):
- A full-bleed board, with the "This season" bar above it.
- **Top row:** LIVE badge, situation chip (only while open) and period box. For a final game: FINAL badge and date. `game-date` is hidden while live.
- **Score rows:** two rows: team name, crest and score; then opponent and score. A 52 px club-colour bar spans the first row's height.
- **Shootout line:** as today.
- **Connection note:** restyled per `VGameReconnect`.

- [ ] **Step 1: Write the failing tests, and migrate:**
  - **Grid while live (Q3):** Q1 and Q2 show numbers, the Q3 head has `aria-current` and Q4 shows "–".
  - **Grid when final:** all four numbers show and none is current.
  - **Shootout final:** the grid excludes shootout goals and `shootout` shows.
  - **A goal in period 5** hides the grid.
  - **Situation chips:** man-up gives `data-kind="manUp"` and "MAN-UP"; man-down gives `"manDown"`; nothing open gives none.
  - **Crest and date:** the crest is visible; `game-date` shows when final and is hidden while live.
  - **360 px:** a long Greek opponent ellipsizes in its score row and its grid label, with no sideways scroll, light and dark.
  - **Rope:** `.rope` has count 0 on the viewer and on the tracker live screen.
  - **Migrate:** the old quarter-line text checks (`viewer-quarter-scores.spec.js:40–107`), the live-date check, the scoreboard selector checks (`viewer.spec.js:61–167`), the `game-manup`/`game-mandown` assertions (noted for Task 9) and the R1 look scoreboard checks (`viewer-look.spec.js:90–114`).
- [ ] **Step 2: Run** and confirm the new tests fail.
- [ ] **Step 3: Implement** with new class names, keeping R1 rules per the CSS constraint.
- [ ] **Step 4: Run** `npm test`, the focused specs, then `npm run test:e2e`. All must pass.
- [ ] **Step 5: Commit:** `feat(viewer): two-row scoreboard with quarter grid and crest`.

### Task 7: Tabs and Players panels (sonnet)

**Files:**
- Modify: `js/viewer.js`, `js/strings.js`, `css/viewer.css`, `sw.js` SHELL (add `'./js/teamView.js'`)
- Create: `js/teamView.js` (stub), `tests/e2e/viewer-tabs.spec.js`

**Interfaces:**
- **Tab bar:**
  - One tab bar, `data-testid="tabs"`, `role="tablist"`, with an accessible label. It sits under the scoreboard on a game and under the season header on home.
  - It is built when the route key changes (`'home'` or `'game:<id>'`). Selecting a tab updates attributes in place, so focus survives snapshots.
  - **Tabs:** `<button role="tab" id="tab-<name>" data-testid="tab-<name>" aria-controls="panel-<name>" aria-selected="true"|"false">`. Pass the strings "true" and "false": `h()` drops a boolean `false`.
  - **Names:** `timeline`, `players`, `team` on a game; `results`, `players`, `team` on home.
  - **Panels:** `<section role="tabpanel" id="panel-<name>" data-testid="panel-<name>" aria-labelledby="tab-<name>">`. Unselected panels are `hidden`.
- **Keyboard:** roving `tabindex`. ArrowLeft and ArrowRight select the previous or next tab, wrapping. Home and End select the first and last. Focus follows the selection.
- **Selection:** in memory per route key. It resets to the first tab when the key changes, and snapshots never change it.
- **Panels:**
  - **Game Timeline:** today's timeline; Task 8 replaces it.
  - **Players:** the player and goalkeeper tables, per `VGamePlayers`/`VSeasonPlayers`. Photos are off: a cap chip in the club colour with `--on-accent` text. Out players get a grey chip and "Out" in `--out-text`.
  - **Home Results:** Task 5's list.
  - **Team:** `state.teamView?.gamePanel?.(game)` on a game and `state.teamView?.seasonPanel?.(stats)` on home.
- **Team loader:**
  - `state.teamViewStatus` is `'pending'`, `'ready'` or `'failed'`, a string so it survives `JSON.stringify`. Each Team panel's render signature includes it, so a failed import re-renders the panel.
  - `import('./teamView.js')` runs once. The panel is empty while pending. On failure it shows "Team stats aren't available right now." (`team-unavailable`).
- **Stub:** `js/teamView.js` in this task exports `gamePanel(game)` and `seasonPanel(stats)`, each returning `[]`. Task 9 fills them in.

- [ ] **Step 1: Write `viewer-tabs.spec.js`** (failing):
  - **Tab bar:** each screen has exactly one `tablist` with its three tabs in order, each ≥ 50 px tall.
  - **ARIA wiring:** every tab's `aria-controls` names an existing panel id, and every panel's `aria-labelledby` names its tab.
  - **Clicking** selects the tab (`aria-selected="true"`, the others `"false"`) and shows only its panel.
  - **Keyboard:** ArrowRight on the last tab wraps to the first; Home and End work; focus follows.
  - **Snapshots:** with Team selected and focused on a live game, a newly written goal keeps Team selected and focus on it.
  - **Reset:** Team on a game, then "This season", gives Results; the next game opens on Timeline.
  - **Fallback:** with the SW blocked and `**/js/teamView.js` aborted, the Team tab shows `team-unavailable` and the other tabs work.
  - **Players:** a two-digit cap chip and an out player's "Out" show.
  - **Cap contrast:** the chip's text is ≥ 4.5:1 against its fill for blue, red, yellow and green, in both schemes. Set each colour with `--accent` plus `applyAccentPair` through `page.evaluate`, as `viewer-look.spec.js` does.
  - **360 px:** the tab bar fits with no sideways scroll.
  - **Migrate:** checks that read the Players tables first click `tab-players`: `viewer.spec.js` (63–71, 101–102, 210, 276–286, 350–351, 482, 515–519, 544–553, 569–589, 628–629), `viewer-look.spec.js:151,157`, `tracker-events.spec.js:252`. The 360 px Players checks run once on home Players and once on game Players, each checking overflow.
- [ ] **Step 2: Run** and confirm it fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, the focused viewer specs, then `npm run test:e2e`. All must pass.
- [ ] **Step 5: Commit:** `feat(viewer): game and home tabs`.

### Task 8: Centre-line timeline and icons (sonnet)

**Files:**
- Create: `js/icons.js`, `tests/unit/icons.test.js`
- Modify: `js/viewer.js` (`timelineSection`, `timelineItem`, icon loader), `js/strings.js`, `css/viewer.css`, `sw.js` SHELL (add `'./js/icons.js'`)
- Test: `tests/e2e/viewer.spec.js`, `tests/e2e/viewer-celebration.spec.js`, `tests/e2e/viewer-look.spec.js`

**Interfaces:**
- **`icons.js`** exports `icon(name, doc = document): SVGSVGElement`.
  - Names: `goal`, `save`, `excl`, `pen`. Paths come from the Tokens boards.
  - The SVG is `aria-hidden="true"`, with a 24 viewBox, stroke width 2 and round caps and joins. An unknown name throws.
  - The loader is `state.iconsStatus`, like `teamViewStatus`. The timeline's render signature includes `game.date` and `iconsStatus`.
- **Rows** (`timeline-item` with `data-side`, kept):
  - **`goal` and `oppGoal`:** the centre holds a `tl-score` pill reading `us–them` from `event.score`, with no `tl-icon`.
    - Ours: on `--board` with `--led` digits. Theirs: on the card background with a `--line-strong` outline and ink digits.
    - Without a `score` (an R1 `model.js`), the centre shows `tl-icon`, with the `goal` icon or the glyph.
  - **`save`, `penSave`, `excl` and `pen`:** a `tl-icon` in the centre.
    - The icon names are `save` (also used for `penSave`), `excl` (red fill) and `pen` (purple fill).
    - The glyph from `timelineEntry` shows until icons load, or if they fail.
  - **Text:** two lines. `timelineEntry` is used only for `side`, `sr` and the glyph `icon`, never its `text`, so an R1 `strings.js` can't duplicate labels.
    - **Name line:** ours use `t('celebrateScorer', {cap, name})` from the lineup ("#7 Nikos P."); theirs use the opponent's name.
    - **Event line:** the existing keys `tlGoalSr`, `tlExclSr`, `tlPenSr`, `tlSaveSr` and `tlPenSaveSr`.
    - Our goals add the `tl-manup` tag. A fouling-out event adds a separate `tl-out` span (new key `tlOutTag`: "· out") in `--out-text`, and keeps `data-out`.
  - **Names:** one line with an ellipsis, 15 px; the event line is 13 px muted.
- **Panel:**
  - **Heading:** "16/11/2026 · newest first", shown even when the timeline is empty.
  - **No scroll box:** `timeline-scroll` is removed and the page scrolls.
  - **Groups:** `model.timelineRows?.(filtered) ?? timeline(filtered)`, with today's filter for `gkIn` and saves.
  - **Columns:** three, ours | centre 64 px | theirs, with a 2 px `--line-strong` line in the centre column.
  - **Quarter markers** (`tl-quarter`): on the line, a `--board` chip with `--led` text, "Q3 2–2" from the group's `goals`, or "Shootout 4–3".
    - With R1's `timeline()` (no `goals`), the marker shows just the period: "Q3" or "Shootout".

- [ ] **Step 1: Write the failing tests:**
  - **Unit (`icons.test.js`,** with a minimal fake document providing `createElementNS` and `setAttribute`): every name returns an `svg` with `aria-hidden`, viewBox "0 0 24 24" and stroke width 2; an unknown name throws.
  - **Sides:** ours sit left and theirs right. Compare each row's text box centre with the centre line's x, not the row box.
  - **Pills:** they read the running score. The Task 1 late-added Q1 goal case shows "2–1" in Q1.
  - **Markers:** "Q2 1–0"; a shootout game shows a "Shootout" marker and shootout pills.
  - **Tags:** a man-up goal shows `tl-manup`; a third foul shows "· out".
  - **Page scroll:** a 40-event game grows the page, and there is no element with `timeline-scroll`.
  - **Icon fallback:** with the SW blocked and `**/js/icons.js` aborted, every `tl-icon` shows its glyph text and the pills still show.
  - **R1 `model.js`:** with the SW blocked and `model.js` fulfilled from `git show 58f859d:js/model.js`, there are no pills, `tl-icon` shows on goal rows, and the markers show periods.
  - **R1 `strings.js`:** with the SW blocked and `strings.js` fulfilled from `git show 58f859d:js/strings.js`, a save row and a foul-out row each show their label once, and the name line is intact.
  - **360 px:** long Greek names on both sides ellipsize; each side's text box is ≥ 100 px wide; no sideways scroll.
  - **Migrate:** the scroll-box checks, the box focus check, the `.timeline h3` size pin (`viewer.spec.js:91`), the glyph and icon checks, and the alignment checks (`viewer.spec.js`, `viewer-look.spec.js`).
- [ ] **Step 2: Run** and confirm they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, the focused specs, then `npm run test:e2e`. All must pass.
- [ ] **Step 5: Commit:** `feat(viewer): centre-line timeline with stroke icons`.

### Task 9: Team tabs (sonnet)

**Files:**
- Modify: `js/teamView.js` (replaces the stub), `js/viewer.js` (only if the Task 7 call sites need adjusting), `js/strings.js`, `css/viewer.css`
- Create: `tests/e2e/viewer-team.spec.js`, `tests/e2e/viewer-colours.spec.js`

**Interfaces:**
- **Consumes:**
  - `gameTeamStats`, `seasonTeamStats` and `pct` from `js/teamStats.js` (static import inside `teamView.js`).
  - The fixtures `tests/fixtures/team-game.js` (`teamGame`, `teamGameExpected`) and `tests/fixtures/season-stats.js` (`seasonStatsFull`, `seasonStatsOld`, `seasonStatsFullExpected`, `seasonStatsOldExpected`).
- **Produces:** `gamePanel(game): Node[]` and `seasonPanel(stats): Node[]`, called by `viewer.js` as in Task 7.

**Game Team panel** (`VGameTeam`):
- **Man-up · man-down** (`team-situations`, a table with Q1–Q4 and Total columns):
  - Row `team-manup`: scored/played per quarter, total and %.
  - Row `team-mandown`: stopped/played per quarter, total and %.
  - A quarter with none played shows "–".
  - When untracked, the line "Man-up and man-down weren't tracked in this game" (`team-untracked`) replaces the table.
- **Goals:** `team-goals-for`, e.g. "12 · 3 man-up", and `team-goals-against`, e.g. "9 · 2 while a man down", each a bar plus legend. When untracked, totals only.
- **Fouls** (`team-fouls`): columns Q1–Q4 and Total; rows Exclusions and Penalty fouls.
- **Foul trouble** (`foul-trouble-row`):
  - Three 12 px pips, then "2 of 3 fouls · one more and out", or "Out".
  - Rows follow the order `teamStats` gives.
- **Penalties against** (`team-pens-against`): "N faced · M saved".
- **Game flow:**
  - `flow-lead`: "+N", or "never ahead" when 0.
  - `flow-run`: "3–0" or "0–3", or "–" when null.
  - `flow-ties`: N, plus "· never behind" when `neverBehind`.
  - `flow-scorers`: N.

**Season Team panel** (`VSeasonTeam`). `viewer.js` calls `seasonPanel(stats)` only when `plan.results` is `'ready'` or `'empty'` for the current season. While it is `'loading'`, the panel shows a loading line.
- **By game:**
  - Rows `season-team-game-row`: opponent and date, MU "s/p" or "–", MD "s/p" or "–", EXCL or "–".
  - A total row, `season-team-total`: MU and MD with %, and EXCL per game to one decimal ("–" when `exclGames` is 0).
  - The legend: "MU: man-up goals / man-ups · MD: man-downs stopped / man-downs · EXCL: our exclusions".
- **Goals by quarter** (`season-quarters`):
  - Columns Q1–Q4 and Total; rows `sq-for`, `sq-against` and `sq-diff`.
  - A negative difference shows "−N" in `--out-text`.
  - The note `season-quarters-note` reads "Q3 is the only quarter we lose." when one quarter is negative and "We lose Q1 and Q3." when more are; it is absent when none is.
  - `season-quarters-coverage` reads "Covers N of M games" when `covered < of`.
- **Goals** (`season-goals`): for and against, with the man-up / man-down split. `season-goals-coverage` reads "Man-up figures cover N of M games" when `situationGames < of`.

- [ ] **Step 1: Write `viewer-team.spec.js`** (failing; selectors are scoped by row and cell test ids):
  - **Game fixture:** seed `teamGame` and open `#/game/team-g1` → Team. Every figure equals `teamGameExpected`: man-up and man-down per quarter, totals and %, the goals split, fouls by quarter and total, trouble rows (order, pips, text), penalties and flow.
  - **Untracked copy** of the fixture: `team-untracked` shows, with goal totals only.
  - **Season, full fixture:**
    - Seed `team/main` with `currentGameId: 'team-g1'` and `teamGame`, so home uses 2026-27 on any run date. Seed `seasonStatsFull` as `stats/2026-27` and open home → Team.
    - By-game rows, total, quarter table (including Total), note, coverage "Covers 3 of 4 games" and "Man-up figures cover 3 of 4 games" all match `seasonStatsFullExpected`.
  - **Season, old fixture:** EXCL shows "–", the quarters show "Covers 0 of 4 games", and no cell contains "NaN" or "undefined".
  - **Fallback:** with the SW blocked and `**/js/teamStats.js` aborted, `team-unavailable` shows and the other tabs work.
  - **360 px, light and dark:** both Team panels fit with no sideways scroll, and foul-trouble names ellipsize.
  - **Season switch:** while the stats for a new season are loading, the Team panel shows the loading line, never the previous season's numbers.
  - **`viewer-colours.spec.js`:** for blue, red, yellow and green, in light and dark, set through `--accent` plus `applyAccentPair`. Every element that uses the club colour meets its threshold: cap chip text (Players), the board bar against the board, and the Team bars. Text needs ≥ 4.5:1; bars and borders ≥ 3:1 against what they sit on.
  - **Migrate:** the `game-manup`/`game-mandown` and season-situations checks noted by Tasks 4 and 6 are re-expressed against `team-manup`, `team-mandown` and `season-team-total`.
- [ ] **Step 2: Run** and confirm it fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, the focused spec, then `npm run test:e2e`. All must pass.
- [ ] **Step 5: Commit:** `feat(viewer): game and season Team tabs`.

### Task 10: Release check (controller)

- [ ] **Step 1: Full suites.** `npm test`, `npm run test:emu` and `npm run test:e2e`, all green.
- [ ] **Step 2: Mixed-cache check.**
  - Write a temporary spec in the workspace, not committed, with the SW blocked. It serves R1 files (`git show 58f859d:<path>`) through `page.route`, one case at a time:
    - R1 `config.js`; R1 `model.js`; R1 `repo.js`; R1 `strings.js`; R1 `viewer.css`;
    - R1 `viewer.js` with everything else from R2;
    - `icons.js`, `teamView.js` and `teamStats.js` aborted.
  - Each case opens `#/games`, with a final current game seeded, and checks that results show. It then opens a seeded live game and checks the score and timeline items. There must be no page errors other than the injected ones.
- [ ] **Step 3: Colours, motion, landscape.**
  - `viewer-colours.spec.js` (Task 9) is part of Step 1's full run. Look at home and a live game in red and yellow by eye.
  - With reduced motion on, nothing animates.
  - At 844 × 390 landscape, there is no sideways scroll.
- [ ] **Step 4: Screenshots.**
  - At 390 and 360 px, light and dark:
    - home: no game, live banner, Players, Team;
    - game: live, final, past, Timeline, Players, Team, reconnecting.
  - Publish them as a canvas page "R2 build" in design-vs-build pairs.
  - Ask the owner to approve them.
- [ ] **Step 5: Session log** via `mechanic`. After the release, remind the owner to open the tracker and the viewer once on Wi-Fi on every phone.
