# Competition per Game + Timeline Quarter Divider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag every game with its competition, keep friendlies out of the season figures (they still show in Results with a tag), and make the viewer timeline's quarter starts read as dividers instead of goal pills.

**Architecture:** Game docs gain `competition` (+ `competitionName` for tournaments). One pure helper set in `js/model.js` reads it, with missing → league. `aggregateSeason` drops friendlies from players, goalies and situations, and tags the result rows. The viewer's record and Team tab skip friendly rows by reading the stored field inline. The tracker forms write the field; the viewer and the tracker show a tag for anything but League. The timeline divider is CSS on the existing `.tl-quarter` markup.

**Tech Stack:** Vanilla ES modules, Firebase JS SDK 12 (Firestore), `node:test`, Playwright 1.64 + Firebase emulators.

**Spec:** `docs/superpowers/specs/2026-11-23-competition-and-quarter-divider-design.md`

**Base:** main @ df314cb. Work in a worktree on branch `competition`.

## Global Constraints

- Competition values, in this order: `'league' | 'cup' | 'tournament' | 'friendly'`. A missing or unknown value is `'league'`.
- `competitionName`: trimmed, 1–40 chars, stored only when `competition === 'tournament'`, otherwise absent (deleted with `deleteField()` on update).
- Labels (English, `js/strings.js`): League, Cup, Tournament, Friendly. Field labels: "Competition", "Tournament name". Error: "Enter the tournament name". Note: "Friendlies not counted ({n})".
- Tag rule: League (or missing) → no tag; Cup → "Cup"; Friendly → "Friendly"; Tournament → its name, or "Tournament" when the name is missing.
- Friendlies are excluded from player totals, goalie totals, `situations`, the Team tab and the W–L record. They are never dropped from `results`.
- **Mixed module cache** (the SW serves each file network-first with a 3 s fallback, so a phone can mix this release with the previous one):
  - no new *named* imports of new exports; use `import * as model from '…/model.js'` / `import * as strings from '…/strings.js'` and call with `?.` plus a fallback (`strings.competitionTag?.(game) ?? null`);
  - `repo.createGame` and `repo.updateGameInfo` write the competition fields only when `competition !== undefined`, because an old form passes none and Firestore refuses `undefined`;
  - check every changed module against `git show df314cb:<path>`;
  - **capability gates.** `createRepo` returns `competitions: true`. The tracker forms show the competition fields only when `ctx.repo.competitions === true && typeof model.competitionFields === 'function' && strings.hasString?.('competitionField')`. Otherwise they behave exactly as at df314cb: no fields, no competition written. The viewer shows tags and the friendlies note only when `typeof strings.competitionTag === 'function'`;
  - **stale-model guard.** `repo.recomputeSeason` throws `Error('stale model')` when `typeof model.competitionOf !== 'function'` (repo.js adds `import * as model from './model.js'` next to its existing named imports). The stats queue then keeps the season dirty and retries on the next drain, instead of writing totals that include friendlies (`js/tracker/statsQueue.js:56-60`);
  - **known limit (document it in the session log, no code):** a phone still on the previous `viewer.js`/`teamStats.js` counts friendlies in the Team tab and the record until it loads fresh files, and a fully old tracker can rewrite stats unfiltered until the next new-tracker recount. The release routine's "open every phone once on Wi-Fi" covers both.
- Dates DD/MM/YYYY via the existing `formatDate`.
- **E2e tests:**
  - no `waitForTimeout` except for "nothing happened" checks, with a comment saying why there is nothing to wait on;
  - every assertion must be able to fail;
  - check writes in Firestore (`get` from `tests/e2e/helpers.js`), not only in the DOM;
  - new specs import `./fixtures.js`.
- **360 px worst case:** a 40-char tournament name with Greek text, no sideways page scroll.
- Focused e2e command (the npm script ignores file args): `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npx firebase emulators:exec --only firestore,auth --project demo-scoretracker "playwright test <file> --reporter=list"`.
- Unit tests: `npm test`. Emulator tests: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emu`.

## Review Focus

1. **Every production game today has no `competition`.** They must look and count exactly as before: no tag, same totals, same record. Pinned by unit tests in Task 1 and by the existing e2e suites passing unchanged.
2. **Mixed cache:** new `viewer.js`/`games.js`/`newgame.js` running against the previous `strings.js`/`model.js`/`repo.js` (and the reverse) must not throw at import or on save, and must not silently drop a chosen competition. Pinned by Task 2's "old form, new repo" emulator tests; the capability gates and the stale-model guard are checked line by line in each review (there's no harness for loading mixed module versions).
3. **Re-tagging a final game** League → Friendly must recount the season so the player totals drop that game. Pinned by Task 2's e2e.
4. **The info form keeps what is being typed:** a game snapshot arriving while the tournament name is half typed must not reset the competition fields. Pinned by Task 2's e2e.
5. **Long tournament names at 360 px** (40 chars, Greek): no sideways scroll in the tracker list, the viewer results row or the board meta. Pinned in Tasks 2 and 3.

---

### Task 1: Competition model, season aggregation, tags (pure) — Codex, medium

**Files:**
- Modify: `js/model.js` (new exports; `gameResult`, `aggregateSeason`, the `Game` typedef)
- Modify: `js/teamStats.js` (`seasonTeamStats`)
- Modify: `js/strings.js` (new keys, `competitionLabel`, `competitionTag`)
- Test: `tests/unit/model.competition.test.js` (create), `tests/unit/teamStats.test.js`, `tests/unit/strings.test.js`

**Interfaces:**
- Produces (`js/model.js`):
  - `COMPETITIONS: readonly ['league','cup','tournament','friendly']`, `MAX_COMPETITION_NAME = 40`
  - `competitionOf(source: {competition?, competitionName?} | null | undefined) → { competition: string, competitionName?: string }`: normalised, missing/unknown → `{ competition: 'league' }`; the name is kept (trimmed) only for a tournament with a non-blank string name.
  - `isFriendly(source) → boolean`
  - `competitionFields(competition: string, name: string) → { competition, competitionName? } | null`: the form validator; `null` for an unknown competition, or a tournament whose trimmed name is empty or longer than 40.
- Produces (`js/strings.js`):
  - `competitionLabel(competition: string) → string` (for select options)
  - `competitionTag(source) → string | null`. Self-contained: it must **not** import from `model.js`, because of the mixed cache.
- Produces (data): `gameResult(game)` adds `competition` (and `competitionName` for a tournament) **only when the competition is not league**. Existing league/missing results keep their exact shape.

- [ ] **Step 1: Write the failing tests** in `tests/unit/model.competition.test.js`:
  - `competitionOf`: `{}`, `null`, `{competition:'bogus'}` → `{competition:'league'}`; `{competition:'friendly', competitionName:'x'}` → `{competition:'friendly'}`; `{competition:'tournament', competitionName:'  Summer Cup '}` → `{competition:'tournament', competitionName:'Summer Cup'}`; `{competition:'tournament', competitionName:'  '}` → `{competition:'tournament'}`.
  - `isFriendly`: true only for `{competition:'friendly'}`.
  - `competitionFields`: `('tournament','  ')` → null; `('tournament','x'.repeat(41))` → null; `('tournament',' Summer Cup ')` → `{competition:'tournament', competitionName:'Summer Cup'}`; `('cup','ignored')` → `{competition:'cup'}`; `('bogus','')` → null.
  - `gameResult`: a friendly → `competition:'friendly'` and no `competitionName` key; a tournament → both keys; league and missing → neither key (`'competition' in result === false`).
  - `aggregateSeason([leagueFinal, friendlyFinal], roster)`, where the same player scores 2 in league and 3 in the friendly and both games are tracked with situations and goalie events: `players.<id>` → `{games:1, goals:2, …}`; goalie `games`/`saves` count the league game only; `situations` equals the league game's counts; `results` has 2 rows and the friendly row has `competition:'friendly'`. With only the friendly final: `players` `{}`, `goalies` `{}`, `situations` null, and `results.length === 1`.
  - In `tests/unit/teamStats.test.js`: `seasonTeamStats({ results: [...seasonStatsFull.results, { ...seasonStatsFull.results[0], gameId:'fr', competition:'friendly' }] })` deep-equals `seasonStatsFullExpected` (friendly ignored, `of` unchanged).
  - In `tests/unit/strings.test.js`: `competitionTag` gives `{}` → null, `{competition:'league'}` → null, cup → 'Cup', friendly → 'Friendly', `{competition:'tournament', competitionName:'Κύπελλο Άνοιξης'}` → 'Κύπελλο Άνοιξης', tournament without a name → 'Tournament'; `competitionLabel('league')` → 'League'.
- [ ] **Step 2:** Run `npm test`. Expected: the new tests FAIL (missing exports / wrong totals) and everything else passes.
- [ ] **Step 3: Implement.**
  - `aggregateSeason`: skip `isFriendly(game)` finals in the goalie/situation/player loops only; `results` still maps every final.
  - `seasonTeamStats`: filter `result?.competition !== 'friendly'` before the loop, and compute `of` from the filtered list. This is an inline check on purpose: no new named import into a module the viewer loads.
  - Add the string keys from Global Constraints: `competitionField` ('Competition'), `competitionLeague`, `competitionCup`, `competitionTournament`, `competitionFriendly`, `competitionNameLabel` ('Tournament name'), `competitionNameRequired`, `friendliesNotCounted`.
  - Add `competition`/`competitionName` to the `Game` typedef.
- [ ] **Step 4:** Run `npm test`. Expected: all pass (315 existing + new).
- [ ] **Step 5:** Commit `feat(model): competition per game; friendlies out of season totals` (the controller commits Codex's changes with the Codex trailer).

### Task 2: Tracker — write, edit and show the competition — sonnet

**Files:**
- Modify: `js/repo.js` (`createGame`, `updateGameInfo`; import `deleteField`)
- Modify: `js/tracker/views/newgame.js`, `js/tracker/views/games.js`, `css/tracker.css` (only if the fields need layout)
- Test: `tests/emulator/repo.test.js`, `tests/e2e/tracker-competition.spec.js` (create)

**Interfaces:**
- Consumes (from Task 1, through `import * as model` / `import * as strings`): `model.COMPETITIONS`, `model.competitionOf`, `model.competitionFields`, `strings.competitionLabel`, `strings.competitionTag`.
- Produces:
  - `repo.createGame({ opponent, date, season, lineup, roster, competition?, competitionName? })`
  - `repo.updateGameInfo(gameId, { opponent, date, season, competition?, competitionName? })`: when `competition` is given, it writes it and `competitionName` (or `deleteField()`).
- DOM test ids:
  - new game: `competition-select`, `competition-name-input`, `competition-name-field` (wrapper, hidden unless tournament), `competition-error`;
  - info form: `info-competition`, `info-competition-name`, `info-competition-name-field`;
  - existing: `game-meta`, `game-row`.

- [ ] **Step 1: Write the failing emulator tests** in `tests/emulator/repo.test.js`:
  - `createGame` with `competition:'tournament', competitionName:'Summer Cup'` stores both;
  - `createGame` without competition stores no `competition` key (old-form safety);
  - `updateGameInfo` tournament → friendly stores `competition:'friendly'` and removes `competitionName`;
  - `updateGameInfo` called the old way (no competition) leaves an existing `competition` untouched;
  - write-boundary validation: `createGame`/`updateGameInfo` with `competition:'tournament'` and no or blank name, or `competition:'bogus'`, throw `Error('invalid competition')` synchronously and write nothing. Both normalise through `model.competitionFields(competition, competitionName ?? '')`, so a stored name is always trimmed and no field is ever `undefined`;
  - `createRepo(db).competitions === true`.
- [ ] **Step 2: Write the failing e2e tests** in `tests/e2e/tracker-competition.spec.js`:
  - New game: `competition-select` defaults to `league` with no previous game. Choosing `tournament` shows the name field, and with the name empty `newgame-next` is disabled and `competition-error` reads "Enter the tournament name". Fill "Summer Cup" → start → `games/<id>` in Firestore has `competition:'tournament', competitionName:'Summer Cup'`.
  - Next new game (after ending the first): the select shows `tournament` and the name field "Summer Cup". Switch to `cup` → the stored doc has `competition:'cup'` and no `competitionName`.
  - Game detail of a seeded final league game (the season's only game) where `p5` scored 2, with `stats/<season>` seeded as its aggregate (`players.p5.goals === 2`): change `info-competition` to `friendly` and save → the Firestore doc has `competition:'friendly'`, and the save's recount rewrites `stats/<season>` with `players` `{}` while `results` keeps the row tagged `competition:'friendly'` (poll the stats doc; no sleep). `game-meta` ends with "· Friendly", and the list `game-row` shows "· Friendly" after the date.
  - Typing guard: in the info form select `tournament` and type "Sum". Then an admin `update('games/<id>', { opponent: 'Harbour WPC' })` and wait for the detail title to read "Harbour WPC". `info-competition-name` still reads "Sum" and the select is still `tournament`.
  - Untouched refresh: on a detail whose competition fields were not touched, an admin `update('games/<id>', { competition: 'cup' })` → `info-competition` shows `cup` and `game-meta` ends "· Cup". A following opponent-only save leaves `competition:'cup'` in Firestore, because untouched competition is not sent.
  - 360 px: a final game tagged with a 40-char unbroken Greek tournament name. Wait until that full name is visible in the games-list row and in the info form, then `document.documentElement.scrollWidth <= document.documentElement.clientWidth`.
  - Update the two existing exact `game-meta` assertions in `tests/e2e/tracker-events.spec.js` (`:541` → `'01/10/2026 · 2026-27 · League'`, `:557` → `'01/07/2026 · 2025-26 · League'`).
- [ ] **Step 3:** Run the emulator suite and the focused e2e file. Expected: the new tests FAIL.
- [ ] **Step 4: Implement.**
  - **New game:** a Competition `<select>` (options in `COMPETITIONS` order, labels from `competitionLabel`) and a Tournament name field after Season. Prefill in `init(state)` from `model.competitionOf?.(state.game)`, else league. The validity rule `competitionFields(...) !== null` gates `next` and `start` along with the season. `startGame` spreads the fields into `createGame`.
  - **Info form:** the same two fields, disabled with the others. A `competitionTouched` flag (like `seasonTouched`, reset in the `infoFor !== game.id` block) is set by either field's input. While it is false, every snapshot refreshes both fields from `competitionOf(game)`; once it is true, snapshots leave them alone. `onSaveInfo` validates with `competitionFields` (error `competitionNameRequired`). It sends `competition`/`competitionName` to `updateGameInfo` only when the flag is set and the normalised value differs from `competitionOf(game)`. The no-change early return considers that too. The save goes through the existing `recountAfter` call.
  - **Meta:** `${date} · ${season} · ${strings.competitionTag?.(game) ?? t('competitionLeague')}`.
  - **List row:** `formatDate(game.date) + (tag ? ' · ' + tag : '') + penalty`; add `overflow-wrap: anywhere` to `.game-row--board .game-date`.
- [ ] **Step 5:** Run `npm test`, `npm run test:emu`, the focused e2e file, then the full e2e: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npx firebase emulators:exec --only firestore,auth --project demo-scoretracker "playwright test --reporter=list"`. Expected: all pass, apart from the known WebKit flakes listed in memory, which must pass alone.
- [ ] **Step 6:** Commit `feat(tracker): competition on new game and game detail`.

### Task 3: Viewer — tags, record and friendlies note — sonnet

**Files:**
- Modify: `js/viewer.js` (`resultItem`, `renderRecord`, the board meta near `gameDate`, `renderSeason`'s Players/Team panels)
- Modify: `css/viewer.css` (only if the tag needs styling; reuse `.board-date` / `.result-meta`)
- Test: `tests/e2e/viewer-competition.spec.js` (create)

**Interfaces:**
- Consumes: `strings.competitionTag` (namespace import, `?.` fallback → null); the stored `results[].competition` from Task 1.
- Produces: test ids `result-competition`, `game-competition`, `friendlies-note`.

- [ ] **Step 1: Write the failing e2e tests** in `tests/e2e/viewer-competition.spec.js`. Seed `team/main` (no current game) and `stats/<calendar season>` with results:
  - a league W 10–5;
  - a friendly L 4–9;
  - a tournament W 8–7, `competitionName:'Κύπελλο Άνοιξης'`.

  Assertions:
  - Home: three `result-row`s. Only the friendly row has `result-competition` "Friendly", the tournament row has "Κύπελλο Άνοιξης", the league row has none. The link's `aria-label` includes the tag.
  - `season-record` reads "2 W · 0 L".
  - The Players tab and the Team tab each show `friendlies-note` "Friendlies not counted (1)". The Team tab's by-game block lists 2 games. With no friendly in `results`, `friendlies-note` is absent.
  - Game route: a seeded final friendly game → `game-competition` "Friendly"; a live tournament game → `game-competition` shows its name; a league game → `game-competition` hidden.
  - 360 px: a 40-char unbroken Greek tournament name. Wait until it is fully visible in a result row and on the board, then `scrollWidth <= clientWidth` on `documentElement`.
  - Live update: on the same page, an admin rewrite of `stats/<season>` without the friendly row → `friendlies-note` disappears and `season-record` reads "2 W · 0 L" unchanged.
  - Tracker → viewer, end to end: seed two final league games, g1 (`p5` scores 2) and g2 (`p5` scores 3), plus their `stats/<season>`. In the tracker, unlock, open g2's detail, set `friendly`, save, and poll `stats/<season>` until `players.p5.goals === 2`. Then open the viewer home: the g2 result row has the "Friendly" tag, and on the Players tab `p5` has games 1 and goals 2.
- [ ] **Step 2:** Run the focused e2e file. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `resultItem`: the tag goes in `result-meta` after the date (`date · tag · pen`), and is appended to the link label.
  - `renderRecord`: skip rows with `competition === 'friendly'` (an inline check).
  - Board: a `span.board-date` sibling `game-competition`, hidden when the tag is null; shown live and final.
  - `renderSeason`: when `stats.results` holds n > 0 friendly rows, append `p.muted[data-testid=friendlies-note]` to the Players and Team panels. `renderIfChanged` already serialises `stats`, so no extra input is needed.
  - The board tag gets `min-width: 0; overflow-wrap: anywhere`.
- [ ] **Step 4:** Run the focused file, then the full e2e. Expected: all pass (known flakes pass alone).
- [ ] **Step 5:** Commit `feat(viewer): competition tags; friendlies out of record and Team tab`.

### Task 4: Timeline quarter divider + cache bump — sonnet

**Files:**
- Modify: `css/viewer.css:469-483` (`.tl-quarter`, `.tl-quarter h3`, `.tl-quarter-label`, `.tl-quarter-score`)
- Modify: `sw.js:4` (`wp-shell-v4` → `wp-shell-v5`)
- Test: `tests/e2e/viewer.spec.js:99-110` and `:925-944` (update the marker assertions); `tests/e2e/viewer-colours.spec.js` (the accent matrix)
- Test (v4 → v5 expectations): `tests/unit/sw-shell.test.js:75`, `tests/unit/sw-fetch.test.js:9` and `:161`, `tests/unit/brand.test.js:55`, `tests/e2e/offline.spec.js:414`

**Interfaces:** none (CSS on unchanged markup; the marker text stays "Q2 1–1", and the screen-reader text is unchanged).

- [ ] **Step 1: Update the tests first.**
  - At `viewer.spec.js:99-110`, the marker's `h3` has `backgroundColor` `rgba(0, 0, 0, 0)` and `position` `static`. `.tl-quarter-label`'s colour equals `--v-muted` and `.tl-quarter-score`'s equals `--ink`. Resolve both tokens on the marker element itself, not on `documentElement`: they are defined on `body.viewer` (`css/viewer.css:3`), and `cssVariableColour` reads the root. The h3's `fontSize` is `15px`. The marker's `::before` and `::after` each have computed `height` `1px` and a width over 40 px at the default viewport.
  - A goal's `tl-score` still has the board background (contrast check: the divider's h3 background differs from the us-goal pill's).
  - In the dark-scheme test (`:937`), the expected `.tl-quarter h3` background becomes `rgba(0, 0, 0, 0)`.
  - In `viewer-colours.spec.js`'s existing light/dark × red #c8102e / yellow #f2b705 matrix at 360 px, add: the divider h3 is transparent, and an us-goal `tl-score` keeps the board background.
  - Change the v4 expectations listed under Files to v5.
- [ ] **Step 2:** Run `viewer.spec.js`. Expected: those assertions FAIL.
- [ ] **Step 3: Implement the divider.**
  - `.tl-quarter`: `display:flex; align-items:center; gap:0.625rem; padding:0.625rem 0.75rem;` and no spine background (the spine breaks at each quarter).
  - `::before`/`::after`: `content:''; flex:1; height:1px; background:var(--v-line-strong)`.
  - `h3`: no background, no box-shadow, no padding; `font: 800 0.9375rem/1.3 var(--font-num)`, tabular numbers, `letter-spacing:0.06em`.
  - Label `var(--v-muted)`, score `var(--ink)`.
  - Then bump the `sw.js` cache.
- [ ] **Step 4:** Run `npm test` (the sw-shell test), the full e2e and a 360 px light/dark visual check of a game with three quarters. Expected: all pass, and the dividers span the card with the label centred.
- [ ] **Step 5:** Commit `feat(viewer): quarter starts as full-width dividers; cache v5`.

## After the tasks
- Final whole-branch review (sonnet, as on R3 — credits routing: the reviewer is from the other model family than the code's author; this branch mixes both, so sonnet reviews the whole branch and Codex reviews the sonnet tasks).
- Session-log entry (mechanic). Then the finish menu.
