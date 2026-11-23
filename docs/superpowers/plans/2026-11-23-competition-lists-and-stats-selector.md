# Competition lists + viewer stats selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pick tournaments and league phases from managed lists. Store each game's player and goalie lines in its season result row. Add a viewer "Showing" selector that filters the Players and Team tabs by Season, League, phase, tournament or Cup.

**Architecture:**
- **Pure logic** (validation, per-game lines, summing, scopes) lives in `js/model.js` as new exports. The tracker's stored totals and the viewer's sums therefore come from one function.
- **Storage:** `js/repo.js` writes the list entries into `team/main` maps and the ids onto games.
- **Tracker:** the forms and a lazily loaded Competitions screen edit the lists.
- **Viewer:** filters the season's result rows on the client.

**Tech Stack:** vanilla ES modules, Firebase JS SDK 12.19.0 (Firestore), node:test unit tests, Firestore emulator tests, Playwright e2e (Chromium + WebKit).

**Spec:** `docs/superpowers/specs/2026-11-23-competition-lists-and-stats-selector-design.md`

## Global Constraints
- **Team doc lists:** `team/main.tournaments: { <id>: { name } }` and `team/main.phases: { <id>: { name } }`.
  - Ids come from `crypto.randomUUID()`.
  - Each write touches one entry only, with `set(..., { merge: true })`. Removal uses `deleteField()`.
- **List names:** trimmed, 1–40 characters (`MAX_COMPETITION_NAME`), and unique within a list. Two names match when they are equal after `trim().toLocaleLowerCase('el')`.
- **Game doc:**
  - A tournament game carries `tournamentId` plus `competitionName` (the entry's name at save time).
  - A league game may carry `phaseId`.
  - Cup and friendly games carry neither.
  - An id always wins over `competitionName` for grouping and labels.
- **Id validation:** an id is a non-empty string of at most 64 characters. `tournamentId` is valid only on a tournament, and `phaseId` only on a league game. Otherwise it is dropped.
- **Result row** (stats doc `results[]`), in addition to today's fields:
  - `tournamentId` or `phaseId` when present;
  - `players: { <playerId>: { name, goals, excl, pens } }`, one entry per lineup player;
  - `goalies: { <playerId>: { name, games: 0|1, saves, penSaves, goalsAgainst } }`.
- **Stored totals:** the stats doc keeps `players`, `goalies` and `situations`. `players` and `goalies` equal `sumLines` over the non-friendly rows.
- **Strings (exact English):**

  | Key | Text |
  |---|---|
  | `showingLabel` | Showing |
  | `scopeSeason` | Season |
  | `scopePhase` | League – {name} |
  | `tournamentField` | Tournament |
  | `phaseField` | Phase |
  | `noPhase` | No phase |
  | `addNewEntry` | Add new… |
  | `newTournamentName` | New tournament name |
  | `newPhaseName` | New phase name |
  | `listNameRequired` | Enter a name (up to 40 characters) |
  | `listNameDuplicate` | That name is already in the list |
  | `listEntryRemoved` | That entry was removed. Pick again |
  | `homeCompetitions` | Competitions |
  | `tournamentsHeading` | Tournaments |
  | `phasesHeading` | Phases |
  | `listAdd` | Add |
  | `listRename` | Rename |
  | `listRemove` | Remove |
  | `listInUse` | Used by games |

  The League and Cup option labels reuse `competitionLeague` and `competitionCup`.
- **Mixed module cache** (the service worker is network-first with a 3 s fallback, so a client can mix this release's files with the previous release's):
  - New exports are reached through namespace imports with `?.` and a fallback.
  - New UI appears only when `ctx.repo?.competitionLists === true`, the needed `model` functions exist, and `strings.hasString?.('phaseField') === true`.
  - `app.js` must not statically import the new Competitions view.
  - Check every changed module against `git show main:<path>`.
- **Service worker:** the new file `js/tracker/views/competitions.js` goes into the `sw.js` SHELL, and the cache becomes `wp-shell-v6`.
- **Tests:**
  - No `waitForTimeout` except for "nothing happened" checks, each with its reason.
  - Every assertion must be able to fail.
  - Writes are checked in Firestore, not only in the DOM.
  - Test at 360 px with long Greek names (40 characters), light and dark, with no sideways page scroll.
  - New e2e specs import `./fixtures.js`.
- **Commands:**
  - Unit: `npm test`.
  - Emulator: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emu`.
  - Focused e2e: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npx firebase emulators:exec --only firestore,auth --project demo-scoretracker "playwright test <file> --reporter=list"`.

## Review Focus
1. **A game re-tagged while the viewer shows its scope:** the selection falls back to Season, with no empty or stale panel (Task 6).
2. **A duplicate name differing only in case** ("Splash - Volos" vs "SPLASH - VOLOS", Greek "Α' ΦΆΣΗ" vs "α' φάση"): refused in the form and on the Competitions screen (Tasks 1, 4, 5).
3. **A player in some rows but not others, and a goalie who only came on** (`games: 0`): the scope sums are still correct (Task 1).
4. **A stats doc rewritten without lines** (an older tracker recounted): the Players tab shows the stored totals and the selector is hidden (Task 6).
5. **A legacy tournament row** (a name but no id) beside linked rows of the same name: it counts in Season only. After a one-Save relink it appears under the tournament (Tasks 1, 4, 6).

---

### Task 1: Model — ids, per-game lines, sums, scopes, list names (Codex, high)

**Files:**
- Modify: `js/model.js` (`competitionOf`, `competitionFields`, `gameResult`, `aggregateSeason`; new exports below)
- Test: `tests/unit/model.competition.test.js`, `tests/unit/model.season.test.js`, new `tests/unit/model.scopes.test.js`

**Interfaces:**
- **Produces:**
  - `competitionOf(source) → { competition, competitionName?, tournamentId?, phaseId? }`, following the id validation rules in the Global Constraints.
  - `competitionFields(competition, name, ids = {}) → fields | null`. It is unchanged for existing callers. `ids` is `{ tournamentId?, phaseId? }`. A tournament still requires a valid name; its id is optional, which keeps legacy free-text saves valid.
  - `gameResult(game)` also carries `phaseId` for a league game that has one. Non-league games already carry their competition fields, and now their `tournamentId` too.
  - `seasonRow(game, names: Map<id,name>) → gameResult(game) + { players, goalies }`, the line shapes in the Global Constraints. Names come from `names.get(id)`, falling back to the lineup or line name. `goalies` is `{}` when `goalieStats(game)` is null.
  - `sumLines(rows) → { players, goalies }`, the same shape as today's `aggregateSeason` totals.
    - Each row adds `games: 1` per player entry. Goalie `games` comes from the row.
    - The name comes from the first row that has the player. Rows arrive newest first.
    - It sums the rows it is given: friendlies are excluded by the caller.
  - `aggregateSeason(games, roster)`:
    - `results` = `seasonRow` for each final game, newest first.
    - `players` and `goalies` = `sumLines` over the non-friendly results.
    - `situations` is unchanged.
  - `countedRows(results) → rows`: rows that are not friendlies. Non-arrays and nulls give `[]`.
  - `hasLines(results) → boolean`: every counted row has a plain-object `players`.
  - `scopeRows(results, key) → rows` for keys `'season' | 'league' | 'cup' | 'phase:<id>' | 'tournament:<id>'`. Counted rows only. A legacy tournament row (no id) matches only `'season'`.
  - `seasonScopes(results) → key[]`:
    - Order: `'season'`, `'league'`, the phases, the tournaments, `'cup'`. Phases and tournaments are each ordered by their earliest row date.
    - Only keys with at least one counted row are included.
    - A non-season key whose row set equals Season's is dropped.
    - `'season'` is always first when any row is counted, else `[]`.
  - `listName(raw) → string | null`: trimmed, 1–40 characters.
  - `sameListName(a, b) → boolean`, using the Global Constraints rule.
  - `listEntries(map) → [{ id, name }]`: skips invalid entries and sorts by `name.localeCompare(other, 'el')`.

- [ ] **Step 1: Write the failing tests**
  - **`model.competition.test.js`:**
    - `competitionOf({competition:'tournament', competitionName:'Splash - Volos', tournamentId:'t1'})` keeps `tournamentId:'t1'`.
    - `tournamentId` on a league game is dropped.
    - `phaseId:'p1'` on a league game is kept, and on a cup game it is dropped.
    - An id of 65 characters is dropped.
    - `competitionFields('tournament','X',{tournamentId:'t1'})` includes the id.
    - `competitionFields('league','',{phaseId:'p1'})` returns `{competition:'league', phaseId:'p1'}`.
    - `gameResult` of a league game with a phase carries `phaseId`, and one without carries no `competition` key (as today).
  - **`model.season.test.js`:**
    - `seasonRow` for a final game with two players (one scoring 2 goals, 1 excl) and a goalie line gives exact `players` and `goalies` maps, with names from the `names` map.
    - The deep-equality guard: for a fixture of 3 games (league, tournament, friendly), `aggregateSeason(...).players` deep-equals `sumLines(countedRows(results)).players`, and the same for `goalies`. It must also equal hand-computed totals.
    - A goalie who came on by `gkIn` but wasn't the lineup goalie gets `games: 0`.
  - **`model.scopes.test.js`:**
    - **Rows used:** league with no phase, league `p1` (2026-11-01), league `p2` (2026-12-01), tournament `t1` (2026-11-14), cup, friendly. `seasonScopes` gives `['season','league','phase:p1','phase:p2','tournament:t1','cup']`.
    - **All league with no phases:** `['season']`. All league with phase `p1` only: `['season']`, because `league` and `phase:p1` both equal Season.
    - **A legacy tournament row plus a linked `t1` row:** `scopeRows(rows,'tournament:t1')` has only the linked row, and `'season'` has both.
    - **Friendlies only:** `[]`.
    - `hasLines` is false when one counted row lacks `players`, and true when only a friendly lacks it.
    - `sumLines` with a player present in only one of two rows sums correctly.
    - `sameListName('Splash - Volos','  SPLASH - VOLOS ')` is true.
    - `sameListName("Α' ΦΆΣΗ","α' φάση")` is true.
    - `listName('')` and a 41-character name give null.
    - `listEntries({b:{name:'Β'}, a:{name:'Α'}, bad:{}})` gives `[{id:'a',name:'Α'},{id:'b',name:'Β'}]`.
- [ ] **Step 2: Run** `node --test tests/unit/model.competition.test.js tests/unit/model.season.test.js tests/unit/model.scopes.test.js`. Expected: FAIL (missing exports or fields).
- [ ] **Step 3: Implement the interfaces above in `js/model.js`.** `gameResult` stays free of lines: `teamStats.js` and `games.js` call it. Only `seasonRow` and `aggregateSeason` add the lines.
- [ ] **Step 4: Run** `npm test`. Expected: all pass, including the existing season and competition tests.
- [ ] **Step 5: Commit** `feat(model): competition ids, per-game lines, sumLines, season scopes, list names`.

### Task 2: Repo — list entries, game ids, recount guard (Codex, high)

**Files:**
- Modify: `js/repo.js` (`checkedCompetition`, `createGame`, `updateGameInfo`, `recomputeSeason`, new methods)
- Test: `tests/emulator/repo.test.js` (the controller runs it; the Codex sandbox can't bind ports)

**Interfaces:**
- **Consumes:** Task 1's `competitionFields(c, name, ids)`, `listName`, `sumLines`.
- **Produces (repo object):**
  - **`competitionLists: true`.**
  - **`createGame({ ..., competition, competitionName, tournamentId, phaseId, newEntry })`:**
    - `newEntry` is `{ list: 'tournaments'|'phases', name }`. The repo creates the id, writes `team/main.<list>.<id> = { name }` in the same batch as the game, and puts that id on the game as `tournamentId` or `phaseId`.
    - Throws `'invalid competition'` when `newEntry.list` doesn't match the competition, or when `listName(name)` is null.
  - **`updateGameInfo(gameId, { ..., competition, competitionName, tournamentId, phaseId, newEntry })`:**
    - It becomes a batch: the game update, plus the team entry when `newEntry` is given.
    - **`competition: 'tournament'`:** a given `tournamentId` or `newEntry` id is written. If neither is given, the stored id is left as it is: an older cached form's free-text save keeps the link. `phaseId` is deleted.
    - **`'league'`:** a given `phaseId` string or `newEntry` id is written. `phaseId: null` deletes it. `undefined` leaves it. `tournamentId` is deleted.
    - **`'cup'` / `'friendly'`:** both ids are deleted.
    - **No `competition`:** nothing competition-related is written (as today).
  - **`addListEntry(list, name) → { id, done }`, `renameListEntry(list, id, name) → Promise`, `removeListEntry(list, id) → Promise`.**
    - Each writes one entry with `setDoc(teamRef, updated({ [list]: { [id]: … } }), { merge: true })`. Remove writes `deleteField()` as the entry's value.
    - `list` must be `'tournaments'` or `'phases'`, and the name must pass `listName`, otherwise they throw.
    - Uniqueness is checked by the callers (the forms and the Competitions screen).
  - **`recomputeSeason`** throws `'stale model'` when `typeof model.sumLines !== 'function'`. This joins the existing `competitionOf` check.

- [ ] **Step 1: Write the failing emulator tests:**
  - `createGame` with `newEntry {list:'tournaments', name:'Splash - Volos'}` writes the game with a `tournamentId` equal to the new key in `team/main.tournaments`, whose name is 'Splash - Volos'. Both appear after one `done`.
  - Two `addListEntry('phases', …)` calls one after the other both survive.
  - `renameListEntry` changes only that entry's name. The other entries and `roster` are unchanged.
  - `removeListEntry` deletes only that key.
  - `updateGameInfo` on a linked tournament game with `{competition:'tournament', competitionName:'New text'}` (no id) keeps the `tournamentId`.
  - `{competition:'league', phaseId:null}` deletes `phaseId` and `tournamentId`.
  - `{competition:'cup'}` deletes both.
  - `updateGameInfo` with `newEntry` for phases writes the entry and the game's `phaseId` in one batch.
  - `recomputeSeason` writes rows with `players` maps, and its `players` totals exclude a friendly.
- [ ] **Step 2: Run** `npm test` (unit, still green). The controller runs `npm run test:emu`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement the interfaces above in `js/repo.js`.**
- [ ] **Step 4: The controller runs the emulator tests.** Expected: PASS. `npm test`: PASS.
- [ ] **Step 5: Commit** `feat(repo): tournament and phase lists in team doc, ids on games, recount guard`.

### Task 3: Strings + tags resolve list names (Codex, medium)

**Files:**
- Modify: `js/strings.js` (the new keys from the Global Constraints; `competitionTag(source, lists)`)
- Test: `tests/unit/strings.test.js`

**Interfaces:**
- **Produces:** `competitionTag(source, lists = {})`, where `lists` is `{ tournaments, phases }` from the team doc.
  - **Tournament:** `lists.tournaments?.[tournamentId]?.name`, else the valid `competitionName`, else "Tournament".
  - **League with a phase:** `lists.phases?.[phaseId]?.name`, else `t('phaseField')`.
  - **League with no phase:** null.
  - **Cup and friendly:** as today.
  - It stays self-contained: no import from `model.js`.
- [ ] **Step 1: Write the failing tests:**
  - A tagged tournament with the list name 'Splash – Volos 2026' and a snapshot 'old' gives 'Splash – Volos 2026'.
  - With no list, it gives 'old'.
  - A league game with `phaseId:'p1'` and the list `{p1:{name:'Play-offs'}}` gives 'Play-offs'.
  - A league game with no phase gives null.
  - Each new key resolves to its exact text.
- [ ] **Step 2: Run** `node --test tests/unit/strings.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(strings): list-name tags and keys for competition lists`.

### Task 4: Tracker game forms — tournament and phase selects (sonnet)

**Files:**
- Modify: `js/tracker/views/newgame.js`, `js/tracker/views/games.js` (info form, list-row tag, meta tag), `css/tracker.css` if needed
- Test: `tests/e2e/tracker-competition.spec.js`

**Interfaces:**
- **Consumes:** `model.listEntries`, `listName`, `sameListName`, `competitionFields(c, name, ids)`, `competitionOf`; `ctx.repo.createGame` / `updateGameInfo` with `tournamentId`, `phaseId`, `newEntry`; `strings.competitionTag(source, lists)`; lists from `ctx.state.team` (`tournaments`, `phases`).
- **Gate:** `listsOn = competitionsOn && ctx.repo?.competitionLists === true && typeof model.listEntries === 'function' && strings.hasString?.('phaseField') === true`. When it is false, today's free-text form stays exactly as it is.
- **Test ids:**

  | Element | New-game form | Info form |
  |---|---|---|
  | Tournament select | `tournament-select` | `info-tournament` |
  | Phase select | `phase-select` | `info-phase` |
  | Tournament new-name input | `tournament-new-name` | `info-tournament-new-name` |
  | Phase new-name input | `phase-new-name` | `info-phase-new-name` |
  | Error | `competition-error` (existing) | `info-competition-error` (existing) |

  Option values: an entry id, `''` for "No phase", and `'__new'` for "Add new…".

- [ ] **Step 1: Write the failing e2e tests** (in `tracker-competition.spec.js`; check Firestore writes with the existing helpers):
  - **New game, Tournament + Add new… "Splash - Volos":**
    - The game has a `tournamentId`.
    - `team/main.tournaments[id].name` is 'Splash - Volos'.
    - The next new game defaults to Tournament with that entry selected.
  - **League + Add new… phase "Regular season"** writes the `phaseId`. A league game with "No phase" has no `phaseId`.
  - **Duplicate names:** adding "SPLASH - VOLOS" as a new tournament shows `listNameDuplicate`, and Next/Start stay disabled.
  - **Legacy game** (a seeded tournament game with `competitionName:'Splash - Volos'` and no id, the entry seeded in `team/main`):
    - The info form preselects that entry.
    - Saving only the opponent writes the `tournamentId` (relink as a hand edit).
  - **Entry removed while the form is open:**
    - After the form opens, remove the selected entry from `team/main` in Firestore.
    - Save shows `listEntryRemoved`, and no game write happens.
  - **Display:**
    - A past-games row and the detail meta show the phase name for a league game with a phase, and the list name for a tournament after a rename in `team/main`.
    - At 360 px with a 40-character Greek tournament name: no sideways scroll, and the selects fit.
- [ ] **Step 2: Run the focused e2e.** Expected: FAIL.
- [ ] **Step 3: Implement the selects:**
  - **Visibility:** the Tournament select shows for Tournament and the Phase select for League. A new-name input shows only for `'__new'`.
  - **Defaults:** the previous game's competition and its id, if that entry still exists. A previous legacy game matches by `sameListName`, else uses `'__new'` with the name filled in.
  - **Validation:** a tournament needs an entry or a valid, non-duplicate new name. A phase may be `''`.
  - **At Save:** a selected id missing from the current lists shows `listEntryRemoved` and refuses.
  - **Payload:** `competitionName` = the entry's or the new name; `newEntry` for `'__new'`; `phaseId: null` for "No phase" in the info form.
  - **Info form:**
    - The existing `competitionTouched` / `competitionEdits` / `releaseCompetition` logic covers the two new selects and inputs.
    - A legacy relink preselect sets `competitionTouched`.
    - Snapshot re-renders keep the draft.
  - **Tags:** `strings.competitionTag?.(game, lists)`.
- [ ] **Step 4: Run the focused e2e, then `npm test`.** Expected: PASS. Also run `tests/e2e/tracker-events.spec.js` (it checks the game-meta text).
- [ ] **Step 5: Commit** `feat(tracker): pick tournament and phase from lists in game forms`.

### Task 5: Tracker Competitions screen + service worker (sonnet)

**Files:**
- Create: `js/tracker/views/competitions.js`
- Modify: `js/tracker/app.js` (lazy route `competitions`), `js/tracker/views/home.js` (nav row after Roster, icon), `sw.js` (SHELL entry, `wp-shell-v6`), `css/tracker.css`
- Test: new `tests/e2e/tracker-competitions.spec.js`; `tests/unit/sw-shell.test.js` / `brand.test.js` if they pin the cache name or the file list

**Interfaces:**
- **Consumes:** `ctx.repo.addListEntry`, `renameListEntry`, `removeListEntry`, `listGames`; `model.listEntries`, `listName`, `sameListName`, `competitionOf`.
- **Route:** `#/competitions`. `app.js` loads `./views/competitions.js` with `import()` when the route is entered. If the load fails, it shows a muted "unavailable" line in the view slot instead of throwing.
- **Home nav row:** `home-competitions`, shown only with the Task 4 gate (`repo.competitionLists`, `model.listEntries`, `strings.hasString('homeCompetitions')`).
- **Test ids:**
  - Sections: `competitions-tournaments`, `competitions-phases`.
  - Rows: `list-entry`, each with a rename input or button and `list-remove`.
  - Add: `list-add-input` and `list-add` in each section.
  - Errors: `list-error`.

- [ ] **Step 1: Write the failing tests:**
  - **e2e:**
    - The home row opens the screen, which lists the seeded entries sorted by name.
    - Add "Play-offs" to Phases, and Firestore has the entry.
    - Adding a duplicate in a different case shows `listNameDuplicate`.
    - Rename a tournament, and Firestore and the past-games tag show the new name.
    - Remove is disabled and `listInUse` shows for an entry a game uses. It is enabled for an unused entry, and removing it deletes only that key.
    - All write controls are disabled while not writable (follow `tracker-roster.spec.js`).
    - 360 px with a 40-character Greek name: no sideways scroll.
  - **Unit:** the SHELL contains `./js/tracker/views/competitions.js` and the cache name is `wp-shell-v6`.
- [ ] **Step 2: Run the focused e2e and `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement**, following `roster.js` patterns (draft survives snapshots, `data-write` gating). Remove re-checks `listGames()` at click time (each game's id through `competitionOf`).
- [ ] **Step 4: Run the focused e2e, `npm test`, and `tests/e2e/offline.spec.js`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(tracker): Competitions screen to add, rename and remove list entries`.

### Task 6: Viewer — Showing selector, scoped Players and Team, list-name tags (sonnet)

**Files:**
- Modify: `js/viewer.js` (`renderSeason`, `seasonPlayersPanel`, `friendliesNote`, `competitionTag` call sites, a namespace import of `model.js`), `css/viewer.css`
- Test: `tests/e2e/viewer-competition.spec.js` (or a new `tests/e2e/viewer-scope.spec.js`)

**Interfaces:**
- **Consumes:** `model.seasonScopes`, `scopeRows`, `sumLines`, `hasLines`, `countedRows`; `strings.competitionTag(source, lists)`; keys `showingLabel`, `scopeSeason`, `scopePhase`, `competitionLeague`, `competitionCup`.
- **Selector** (testid `scope-select`):
  - **Element:** created once and reused across renders, so focus and the open state survive a snapshot.
  - **Placement:** above the content of the Players and Team panels, visible on those two tabs only.
  - **Shown only when all of these hold:** the home mode, results `'ready'`, `model.seasonScopes` exists, at least 2 scopes, `hasLines(results)`, and the team doc loaded.
  - **Option labels:**

    | Scope | Label |
    |---|---|
    | `'season'` | `scopeSeason` |
    | `'league'` | `competitionLeague` |
    | `'phase:<id>'` | `scopePhase` with the list name, else `t('phaseField')` |
    | `'tournament:<id>'` | the list name, else the newest row's `competitionName`, else `competitionTournament` |
    | `'cup'` | `competitionCup` |

- **State:** `{ season, key }` in memory.
  - It resets to `'season'` when the season shown changes.
  - It falls back to `'season'` when the key is no longer in `seasonScopes`.
- **Season** (or the selector hidden): exactly today's rendering, using the stored totals, plus the friendlies note.
- **Another scope:**
  - Players = `sumLines(scopeRows(results, key))`, rendered by the existing tables.
  - Team = `teamView.seasonPanel({ ...stats, results: scopeRows(results, key) })`.
  - No friendlies note.
  - The `renderIfChanged` signatures include the key and the lists.
- **Unfiltered:** the W–L record and the Results tab.
- **Tags:** result rows and the game board use `strings.competitionTag?.(x, { tournaments, phases })` from `state.team.data`.

- [ ] **Step 1: Write the failing e2e tests:**
  - **Seeds:** a team doc with lists. A stats doc with rows (with lines) for league `p1`, league `p2`, tournament `t1`, cup and a friendly, using `aggregateSeason` from `js/model.js` as `viewer-competition.spec.js` does.
  - **Options:** the selector shows exactly Season, League, "League – Regular season", "League – Play-offs", the tournament name and Cup, in that order.
  - **Picking a phase:**
    - The Players totals table shows only that phase's goals.
    - Team's by-game block lists only that phase's games.
    - The selection persists when switching from Players to Team.
  - **Picking Season:** the original totals come back, with the friendlies note.
  - **Hidden selector:**
    - Hidden when every counted game is league with no phase.
    - Hidden when one counted row lacks `players`, and then Players shows the stored totals.
  - **Re-tag while a scope is selected:**
    - Re-seed the stats doc so the selected phase's only game moves to the other phase.
    - The select shows Season and the panels show the Season figures.
  - **Tags:**
    - A result row shows the phase tag "Play-offs".
    - A tournament row shows the list name after a rename in `team/main`. The legacy row shows its snapshot name.
  - **360 px:** with 40-character Greek names in the options, no sideways page scroll and the select fits. Light and dark.
  - **Focus:** the select keeps focus after a stats snapshot arrives.
- [ ] **Step 2: Run the focused e2e.** Expected: FAIL.
- [ ] **Step 3: Implement** as specified in the Interfaces.
- [ ] **Step 4: Run the focused e2e, `npm test`, then the viewer specs** (`viewer*.spec.js`). Expected: PASS.
- [ ] **Step 5: Commit** `feat(viewer): Showing selector filters Players and Team by league, phase, tournament or cup`.
