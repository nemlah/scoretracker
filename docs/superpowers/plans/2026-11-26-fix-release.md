# Fix Release (26/11 review) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the local fixes from the 26/11 review:
- duplicate event ids;
- the cache-miss New Game;
- same-day pointer ties;
- listener recovery;
- the service worker cache fallback;
- one recount per correction;
- lighter game reads;
- live roster names;
- validated tracker game routes;
- the release-2 cleanup.

**Architecture:** Each fix stays in the module that has the bug.
- Pure logic goes in `js/model.js`, a new pure module `js/watchRetry.js`, and `js/tracker/recount.js`, all with unit tests.
- Repo changes get emulator tests.
- The wiring in `js/tracker/app.js`, `js/viewer.js` and the views gets e2e tests.
- Every new export is read through a namespace with a fallback, so a phone mixing releases keeps working.

**Tech Stack:** Vanilla ES modules, no build step; Firebase JS SDK 12.19.0 (Firestore persistent cache, anonymous Auth); `node --test` (unit, emulator); Playwright 1.64.1 (e2e); Firebase emulators.

**Spec:** `docs/superpowers/specs/2026-11-26-fix-release-design.md`. Read it before any task: it holds the reasons, the review rulings, and what is out of scope.

## Global Constraints

- Branch `fix-release` in a worktree off `main` at `67cd574`.
- **Mixed module cache** (copied from the spec):
  - A new export of an existing module is read through a namespace import with `?.` and a fallback.
  - An existing export keeps its signature and return shape; new behaviour gets a new export.
  - A brand-new module file is loaded with a dynamic `import()` and a fallback, as `accent.js` and `teamView.js` are.
  - Every new file goes in the service worker's `SHELL` list (`tests/unit/sw-shell.test.js` enforces it).
  - For every changed module, compare against `git show 67cd574:<path>`.
- **Mixed-cache e2e pattern:** `test.use({ serviceWorkers: 'block' })`, then `execSync('git show 67cd574:<path>', { encoding: 'utf8', maxBuffer: 1 << 20 })` served with `page.route` before navigating (as `tests/e2e/tracker-access.spec.js:405-445` does). Every such test asserts an observable fallback outcome.
- **New strings:** read as `strings.hasString?.(key) === true ? t(key) : '<English text>'`. `t()` of a missing key logs a warning, and the e2e console gate catches it.
- No change to `firestore.rules`.
- **`instrumentRepo` anchors:** `tests/e2e/helpers.js` string-matches `cb(data, { fromCache, hasPendingWrites });` and `updateGameInfo(gameId, info) {` in `js/repo.js`. Keep both lines verbatim. Stubbing tests match `async listGames() {` and `async listGamesFromServer() {`; those stay verbatim too, unless the same task retargets the stubs.
- **Test rules, all tasks:**
  - No `waitForTimeout` except in a "nothing happened" check that has a comment saying why there is nothing to wait on and a positive end condition.
  - Every assertion must be able to fail on `67cd574`: run the new test there, or reason it through in the report.
  - Writes are checked in Firestore (the `get` helper, or `getDocFromServer`), not only in the DOM.
- **360 px worst case:** new UI is tested at a 360 × 740 viewport with a long Greek name, under both OS colour preferences (the tracker itself stays light), with no sideways page scroll.
- **Commands:**
  - Unit: `npm test`.
  - Emulator: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emu`.
  - One e2e file: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npx firebase emulators:exec --only firestore,auth --project demo-scoretracker "playwright test tests/e2e/<file> --reporter=list"`.
  - Full e2e: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:e2e`.
- **Implementers and reviews:**
  - A sonnet implementer does each task, and runs every test command the task names: unit, emulator and e2e.
  - It commits with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
  - A fresh, read-only Codex review (medium) checks each task. Fix rounds 1–3 go to sonnet, rounds 4–5 to opus.
  - Each task names its effort level. A fix round runs one level up (`medium` becomes `high`). Not `xhigh` or `max`.
  - The controller re-runs the full suites before accepting a task.
- Dates in the UI are DD/MM/YYYY.

## Review Focus

1. **A phone mixing releases** (Tasks 5, 9, 10):
   - **New views with the previous `repo.js`:** Past games shows the whole list with no button, the Home count still shows, Competitions still checks entries, and the tracker boots and records a goal.
   - **Previous views with the new `repo.js`:** Past games still lists games, and the old Events sheet ends a game and edits a goal.
   - **`watchRetry.js` unavailable:** both apps start and work.
2. **Signal bars but no data on the tracker** (`navigator.onLine` true, no server answer): a current game missing from the cache keeps New Game closed (Task 8).
3. **Back from the background while a listener is failed:** nothing counts as confirmed, and a non-active device keeps the takeover banner (Task 10).
4. **Two corrections of one goal against the same stale version:** one version survives, counted once (Task 3).
5. **Past games at 360 px** with "Show more" and a long Greek opponent: no side scroll (Task 5).

---

### Task 1: Pure helpers in `js/model.js`

Implementer: sonnet, effort `medium`.

**Files:**
- Modify: `js/model.js`
- Test: `tests/unit/model.fixes.test.js` (create)

**Interfaces:**
- Produces, all exported from `js/model.js`:
  - `uniqueEvents(events: object[]): object[]`
  - `compareGames(a, b): number`: negative when `a` is older. Reads `date` (a string), `createdAt` and `id`.
  - `newestGame(games: object[], excludeId?: string): object | null`
  - `newerThan(ended: object, candidates: object[]): string | null`: the id of the newest candidate other than `ended.id` when it sorts after `ended`. Returns null when `ended.createdAt` is not a Timestamp (an object with `toMillis`), or when no candidate is newer.
  - `validDocId(id: string): boolean`
  - `parseGamesRoute(route: string): { kind: 'list' } | { kind: 'detail', id: string } | { kind: 'invalid' }`

- [ ] **Step 1: Write the failing tests** in `tests/unit/model.fixes.test.js`, with `const ts = n => ({ toMillis: () => n })`:
  - **`uniqueEvents keeps the last version of an id in its position`:** `[{id:'e1',playerId:'a'},{id:'e2'},{id:'e1',playerId:'b'}]` → `[{id:'e2'},{id:'e1',playerId:'b'}]`.
  - **`uniqueEvents keeps entries without a string id and returns the same array when nothing repeats`:** `assert.equal(uniqueEvents(arr), arr)` for a duplicate-free `arr`; `[{type:'x'},{type:'x'}]` keeps both.
  - **`compareGames orders by date, then createdAt, then id`:** the date wins over `createdAt`; `createdAt` wins over `id`; with both equal, `id` decides.
  - **`compareGames sorts a null createdAt newest and a missing one oldest`.**
  - **`newestGame skips the excluded id and returns null for an empty list`.**
  - **`newerThan returns the later-created same-date game, null when the ended game is the newest, and null when its createdAt is null`:** the ended game has `createdAt: null` and a candidate has `ts(5)` → null.
  - **`validDocId refuses '', '.', '..', a slash, __x__, and over 1500 bytes`.**
  - **`parseGamesRoute`:**
    - `'/games'` and `'/games/'` → list;
    - `'/games/abc'` → `{ kind: 'detail', id: 'abc' }`;
    - `'/games/list'` → detail `list`;
    - `'/games/a%2Fb'`, `'/games/%ZZ'`, `'/games/a/b'` and `'/games/__x__'` → invalid.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL, because the exports are missing.
- [ ] **Step 3: Implement the six exports.**
  - `validDocId` takes the body of `js/viewer.js:95-98`.
  - In `compareGames`, a `null` `createdAt` counts as `+Infinity` and `undefined` as `-Infinity`. `id` compares with `<` and `>`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS, with all 356 existing tests still green.
- [ ] **Step 5: Commit**: `feat(model): uniqueEvents, compareGames, newestGame, newerThan, validDocId, parseGamesRoute`.

### Task 2: `js/watchRetry.js` — listener retry

Implementer: sonnet, effort `high`.

**Files:**
- Create: `js/watchRetry.js`
- Modify: `sw.js`: add `'./js/watchRetry.js'` to `SHELL`, after `'./js/viewer.js'`.
- Test: `tests/unit/watchRetry.test.js` (create)

**Interfaces:**
- Produces `keepWatching(open, options) → { retryNow(): void, stop(): void, failed(): boolean }`.
  - `open(next: (data, meta) => void, fail: (err) => void) => unsubscribe`. A throw counts as a failure.
  - Options and their defaults:
    - `onSnapshot(data, meta)`
    - `onFail(err)`: no-op
    - `holdCached`: `false`
    - `startFailed`: `false`
    - `delays`: `[2000, 5000, 15000, 30000, 60000]`, with the last one repeating
    - `jitter`: `0.2`
    - `random`: `Math.random`
    - `timers`: `{ setTimeout, clearTimeout }`
    - `now`: `Date.now`
    - `minRetryNowMs`: `10000`

- [ ] **Step 1: Write the failing tests**, with fake timers and `random: () => 0.5` (no jitter offset):
  - **`opens once and passes snapshots through`.**
  - **`a failure calls onFail and reopens after 2 s, 5 s, 15 s, 30 s, then every 60 s`:** assert the times of the reopens.
  - **`a server snapshot (fromCache false) after a failure clears failed() and restarts at 2 s`.**
  - **`cached snapshots after a failure never reset the delays`:** fail, reopen, a cached snapshot, fail again; the next delay is 5 s.
  - **`holdCached true withholds cached snapshots while failed; holdCached false passes them on while failed() stays true`.**
  - **`startFailed makes the first open after the first delay`.**
  - **`callbacks of a failed attempt are ignored at once, during the backoff and after the reopen`.**
  - **`retryNow reopens a failed watch at once, cancels the scheduled reopen, is throttled to once per 10 s, and keeps the backoff step`.**
  - **`retryNow does nothing while healthy`.**
  - **`stop unsubscribes, cancels the pending reopen, and ignores later callbacks`.**
  - **`an open that throws counts as a failure; an unsubscribe returned after a synchronous fail is called`.**
- [ ] **Step 2: Run** `npm test`. Expected: FAIL, because the module is missing.
- [ ] **Step 3: Implement `keepWatching`.**
  - No imports.
  - The jitter: `delay * (1 - jitter + 2 * jitter * random())`.
  - The step counter advances only on a failure, and resets only on a server snapshot.
- [ ] **Step 4: Run** `npm test`. Expected: PASS, `sw-shell.test.js` included.
- [ ] **Step 5: Commit**: `feat: keepWatching retries failed listeners with backoff`.

### Task 3: Repo — one version per event id (A1)

Implementer: sonnet, effort `high`.

**Files:**
- Modify: `js/repo.js` (`gameData`, `removeEvent`, `replaceEvent`)
- Test: `tests/emulator/repo.test.js`

**Interfaces:**
- Consumes `model.uniqueEvents` (Task 1), through the existing `import * as model`.
- Produces:
  - every game object the repo returns has deduplicated `events`;
  - `removeEvent(gameId, event)` and `replaceEvent(gameId, oldEvent, newEvent)` keep their signatures.

- [ ] **Step 1: Write the failing emulator tests.**
  - Seed duplicates with `testEnv.withSecurityRulesDisabled`.
  - Assert raw arrays with the `read()` helper, which reads the server without the repo.
  - The tests:
    - **`a game read through the repo keeps the last version of a duplicated event id`:** `readGameFromServer` returns one `e1`, with the second version's `playerId`.
    - **`removeEvent clears every version of an id the repo has seen`:** read the game through the repo first, then remove the visible version. The raw server `events` has no `e1`.
    - **`replaceEvent leaves only the new version`:** read, then replace. The raw `events` equals `[new]`.
    - **`two replacements against the same stale version leave one version`** (Review Focus 4):
      - Seed `[A]` (scorer `a`), and read it through two repo clients.
      - Client 1 replaces A → B (scorer `b`); client 2 then replaces A → C (scorer `c`) from its stale read. This is the two-writer case: both clients use the same active uid, as two tabs do.
      - After both clients `readGameFromServer` and client 2 replaces its visible version with D, the raw array holds exactly one entry with id `e1`.
      - After `endGame` and `recomputeSeason`, the season's total goals is 1.
    - **`a pending replacement does not make the repo forget the committed version`:**
      - Seed `[A]`, read it, `disableNetwork`.
      - Replace A → B (pending). The repo's `latest` now has B, and `confirmed` still has A.
      - `removeEvent(B)`, then `enableNetwork` and `waitForPendingWrites`. The raw array is empty.
- [ ] **Step 2: Run** the emulator command. Expected: the new tests FAIL. The pending test may pass by luck on HEAD; if so, say so in the report.
- [ ] **Step 3: Implement.**
  - **Raw-event memory:** a `Map` per `createRepo` call, game id → `{ latest: object[], confirmed: object[] }`.
    - It is updated wherever `gameData` decodes a document snapshot. `gameData(snapshot)` reads `snapshot.metadata`.
    - `confirmed` is updated only when `!fromCache && !hasPendingWrites`.
    - Entries are dropped by a `deleteGame` of that id.
  - **`gameData`** returns `model.uniqueEvents?.(events) ?? events` when `events` is an array.
  - **`removeEvent`** and the remove step of **`replaceEvent`** use `arrayRemove(event, ...others)`.
    - `others` are the remembered raw entries from `latest` and `confirmed` with the same `id` that are not deep-equal to `event`.
    - Duplicates among them are dropped by comparing `JSON.stringify` of their key-sorted entries.
  - The `cb(data, { fromCache, hasPendingWrites });` line stays unchanged.
- [ ] **Step 4: Run** `npm test` and the emulator command. Expected: PASS.
- [ ] **Step 5: Commit**: `fix(repo): one version per event id; removes clear every known version`.

### Task 4: Repo — the newest game wins ties (A3)

Implementer: sonnet, effort `high`.

**Files:**
- Modify: `js/repo.js` (`newerGameId`, `endGame`, `deleteGame`) and `js/tracker/views/events.js:238`
- Test: `tests/emulator/repo.test.js`

**Interfaces:**
- Consumes `model.newerThan`, `model.newestGame` and `model.compareGames` (Task 1).
- Produces `endGame(gameId: string, date?: string): Promise<void>`. `deleteGame(gameId)` is unchanged.

- [ ] **Step 1: Write the failing emulator tests.** Seed games with explicit `createdAt: Timestamp.fromMillis(...)`, rules disabled; the test sets `team/main.currentGameId`.
  - **`ending a reopened game re-points to the later-created game on the same date`:** G1 (t=1) and G2 (t=2) on one date. Reopen G1, then `endGame(G1, date)`: the pointer is G2.
  - **`ending the newest same-date game keeps the pointer`.**
  - **`an old caller without a date still ends the game and keeps today's strict comparison`:** `endGame(G1)` makes G1 final, and the pointer stays G1.
  - **`deleting the current game picks the later-created game on the newest remaining date`:** G1, G2 and G3 (t=1, 2, 3) on one date, with G3 current. Delete G3: the pointer is G2.
  - The uncommitted-ended-game rule is pinned by Task 1's `newerThan` test. Server reads overlay local pending writes, so the emulator can't hold a create pending deterministically.
- [ ] **Step 2: Run** the emulator command. Expected: FAIL in the tie cases.
- [ ] **Step 3: Implement.**
  - **`newerGameId(gameId, date)`:**
    - With `date` and `model.newerThan` available: `Promise.all` of `getDocFromServer(gameRef(gameId))` and `getDocsFromServer(query(gamesRef, where('date', '>=', date)))`, then `model.newerThan(serverCopy, candidates)`.
    - A missing server copy, or a throw, gives null.
    - Otherwise, today's body unchanged.
  - **`endGame(gameId, date)`** passes `date` through and keeps `END_LOOKUP_MS` and the offline skip.
  - **`deleteGame`:** `orderBy('date', 'desc'), limit(2)` finds the newest date among the other games; then `where('date', '==', topDate)` and `model.newestGame(…, gameId)`. Without the model export, today's `limit(2)` pick.
  - **`events.js:238`:** `ctx.repo.endGame(target.id, target.date)`.
- [ ] **Step 4: Run** `npm test` and the emulator command. Expected: PASS.
- [ ] **Step 5: Commit**: `fix(repo): same-day games are ordered by creation when ending and deleting`.

### Task 5: Lighter reads and tracker game routes (M2, M9)

Implementer: sonnet, effort `medium`.

**Files:**
- Modify: `js/repo.js`, `js/tracker/views/games.js`, `js/tracker/views/home.js:65-73`, `js/tracker/views/competitions.js:44-96`, `js/viewer.js:95-108` (`validDocId` through the namespace, its own copy kept as the fallback), `js/strings.js` (`gamesShowMore: 'Show more'`)
- Test: `tests/emulator/repo.test.js`, `tests/e2e/tracker-games-list.spec.js` (create), and the stubs in `tests/e2e/tracker-live.spec.js:421-440` and `tests/e2e/tracker-competitions.spec.js:263-275`

**Interfaces:**
- Consumes `model.parseGamesRoute` and `model.validDocId` (Task 1).
- Produces these new repo methods. `listGames()` and `listGamesFromServer()` are unchanged.
  - `listGamesPage({ after = null, pageSize = 20 } = {}): Promise<{ games: object[], cursor: DocumentSnapshot | null, more: boolean, fromCache: boolean }>`
  - `countGames(): Promise<number>`
  - `listEntryInUse(list: 'tournaments' | 'phases', id: string): Promise<boolean>`

- [ ] **Step 1: Write the failing emulator tests.**
  - **`listGamesPage pages 25 games as 20 and 5, in date then id descending order, across a tied date`:**
    - games 18–23 share one date;
    - assert the exact id sequence of both pages;
    - no id repeats or goes missing.
  - **`countGames counts the games on the server`.**
  - **`listEntryInUse is true only for an entry a game links`:** a linked and a free tournament id, and a linked and a free phase id.
- [ ] **Step 2: Write the failing e2e tests** in `tests/e2e/tracker-games-list.spec.js`, with 23 final games seeded.
  - **`Past games shows 20 games and Show more loads the rest`:**
    - testid `games-more`;
    - after one click there are 23 rows and the button is hidden;
    - a double click adds each game only once.
  - **`Past games with Show more fits 360 px`** (Review Focus 5):
    - 360 × 740;
    - opponent `Ολυμπιακός Σύνδεσμος Φιλάθλων Πειραιώς`;
    - run under `colorScheme` `'light'` and `'dark'`;
    - assert the long row and the button are visible, `clientWidth === 360`, `scrollWidth <= clientWidth`, and the button lies within the viewport.
  - **`a list built offline reloads from page one when back online`:**
    - go offline first, then open Past games, so the first page is read from the cache. Check it through `instrumentRepo`'s record, or a `window.__pageFromCache` flag set by a stub of `listGamesPage`;
    - `update` a new game on the server;
    - go back online: the new game appears at the top.
  - **`an invalid game route shows the not-found state without an error`:** `#/games/a%2Fb` and `#/games/a/b` show the `gameNotFound` text, with no console problems.
  - **Mixed cache, old `repo.js`** (Review Focus 1):
    - Past games lists all 23 with no `games-more`;
    - the Home count shows 23;
    - Competitions marks a linked entry in use and lets a free one be removed. Check the removal in Firestore.
  - **Mixed cache, old `games.js`:** Past games lists all 23.
  - **Mixed cache, old `strings.js`:** `games-more` reads `Show more`, with no "Missing string" warning.
  - **Mixed cache, old `model.js`:** `#/games/a%2Fb` still shows not-found. The inline fallback parser covers this.
- [ ] **Step 3: Retarget the existing stubs.**
  - `tracker-live.spec.js` "home list count lifecycle" stubs `async countGames() {` instead of `listGames`, and adds a check that Home makes no `listGames` call: a stub that records calls, with an assertion that it recorded none.
  - `tracker-competitions.spec.js` "a check that failed while online is retried" stubs `async listEntryInUse(` to fail once. It asserts that the retry re-runs only the failed entry: the stub counts calls per id.
- [ ] **Step 4: Run** the emulator command and the three e2e files. Expected: the new tests FAIL.
- [ ] **Step 5: Implement.**
  - **`listGamesPage`:** `getDocs(query(gamesRef, orderBy('date', 'desc'), ...(after ? [startAfter(after)] : []), limit(pageSize + 1)))`.
    - `more` = more than `pageSize` came back.
    - `cursor` = the snapshot of the page's last shown game.
    - `fromCache` = `snapshot.metadata.fromCache`.
  - **`countGames`:** `(await getCountFromServer(gamesRef)).data().count`.
  - **`listEntryInUse`:** `requireOnline()`, then `waitForPendingWrites(db)`, then `getDocsFromServer(query(gamesRef, where(list === 'tournaments' ? 'tournamentId' : 'phaseId', '==', id), limit(1)))`. The result is `!empty`.
  - **`games.js` routes:**
    - A tagged route comes from `model.parseGamesRoute?.(state.route)`. Without it, an inline fallback returns the same tagged shape, validating with the same rules: one segment, decodable, a valid id.
    - The view's mode is the tagged object, keyed by `kind` plus `id`. It is never a bare string, so a game id of `list` or `invalid` can't collide.
    - `invalid` subscribes to nothing and shows the detail view with `t('gameNotFound')`.
  - **`games.js` list:**
    - It uses `listGamesPage` when that is a function. Otherwise `await listGames()`, with no button.
    - "Show more" (class `btn btn--small`, testid `games-more`) is disabled while a page is loading. It appends the next page, and a load token drops results from a superseded load.
    - A local `wasOnline` (not the shared state object) detects the offline → online transition. If any shown page had `fromCache`, the list reloads from page one.
  - **`home.js`:** `ctx.repo.countGames ? await countGames() : (await listGames()).length`. A rejection, or being offline, keeps the count hidden.
  - **`competitions.js`:**
    - With `ctx.repo.listEntryInUse`, `readUse` checks every entry of both lists in parallel and keeps the result per entry.
    - The existing retry re-runs only failed entries.
    - `remove()` checks only the one entry.
    - Without it, the `listGamesFromServer` path stays as it is today.
- [ ] **Step 6: Run** `npm test`, the emulator command, `tracker-games-list.spec.js`, `tracker-live.spec.js`, `tracker-competitions.spec.js` and `tracker-look.spec.js`. Expected: PASS.
- [ ] **Step 7: Commit**: `perf(tracker): page Past games, count games on the server, check list entries one query each; validate game routes`.

### Task 6: Service worker answers when Cache Storage fails (A5)

Implementer: sonnet, effort `medium`.

**Files:**
- Modify: `sw.js` (`CACHE` → `wp-shell-v7`, `networkFirst` only; install and activate stay unchanged)
- Test:
  - `tests/unit/sw-fetch.test.js`: `boot()` gains independent `openImpl`, `matchImpl` and `putImpl` controls, and `CACHE_NAME` becomes v7.
  - Every other `v6` assertion: `tests/unit/sw-shell.test.js:73`, `tests/unit/brand.test.js:54`, `tests/e2e/offline.spec.js:414`.

- [ ] **Step 1: Write the failing tests:**
  - **`networkFirst answers from the network when caches.open rejects`:** one fetch, the network response returned, a warning logged.
  - **`networkFirst answers from the network when match rejects on a slow response`:** a fetch that resolves after `NETWORK_TIMEOUT_MS`, so the match branch runs.
  - **`networkFirst returns a fast response when put rejects`.** This already passes on HEAD; keep it as a guard and say so.
  - Update the v7 cache-name assertions, including the project-scope ones (`sw-fetch.test.js:111` and `:161`).
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The fetch starts before any cache call.
  - `cache` is a promise that resolves to `null` when opening fails, so every use guards it.
  - Bump `CACHE` and update every v6 assertion in this commit.
- [ ] **Step 4: Run** `npm test`, then `offline.spec.js` and `transport.spec.js` e2e. Expected: PASS.
- [ ] **Step 5: Commit**: `fix(sw): network-first works when Cache Storage fails; v7`.

### Task 7: One recount per correction, and a wake-up (M1)

Implementer: sonnet, effort `high`.

**Files:**
- Modify: `js/tracker/recount.js`, `js/tracker/app.js:280-285` (`ctx.stats.drain`)
- Test: `tests/unit/recount.test.js`

**Interfaces:**
- Produces:
  - `recountAfter(ctx, season, write)`: same signature. It still returns `Promise.resolve(write)`, so callers see the write's own result and rejection.
  - `createRedrain({ drain, isActive, hasDirty, delayMs = 60000, timers = { setTimeout, clearTimeout } }) → { after(result: { done: string[], failed: string[] }): void, stop(): void }`.

- [ ] **Step 1: Rewrite the tests**, using the real `['mark', season]` tuples of `fakeCtx`:
  - **`marks at once without draining, then marks again and drains once after the write succeeds`:** at first `[['mark','2026-27']]`; after the write settles `[['mark','2026-27'],['mark','2026-27'],['drain']]`.
  - **`a rejected write marks again and drains once, and the returned promise still rejects`.**
  - **`several seasons: each marked at once and again, then one drain`.**
  - **`createRedrain schedules one drain 60 s after a result with failed seasons while active`.**
  - **`createRedrain does not schedule when inactive or nothing failed, and keeps one timer at a time`.**
  - **`when its timer fires it calls drain only if still active and dirty`.**
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`recountAfter`:** the settle handler is attached separately (`settled.then(again, again)`), and the function returns `settled`.
  - **`app.js`:** `import * as recount from './recount.js'`. The redrain is created with:
    - `drain` = the wrapped `ctx.stats.drain`;
    - `isActive: () => state.active`;
    - `hasDirty: () => stats.dirty().length > 0`.
  - The wrapped `ctx.stats.drain` alone calls `redrain?.after(result)`. The redrain's timer only calls `drain()`, so each result is handled once.
  - Without `recount.createRedrain`, `ctx.stats.drain` stays as it is today.
- [ ] **Step 4: Run** `npm test`, then `tracker-events.spec.js`, `tracker-competition.spec.js` and `tracker-goalies.spec.js` e2e, which cover the recounts. Expected: PASS.
- [ ] **Step 5: Commit**: `fix(tracker): recount once, after the write settles; redrain after a failed recount`.

### Task 8: A game the cache lacks is not loaded (A2)

Implementer: sonnet, effort `high`.

**Files:**
- Modify: `js/tracker/app.js` (`syncGameWatch`, `reconfirm`)
- Test: `tests/e2e/tracker-loaded.spec.js` (create), `tests/emulator/repo.test.js`

**Interfaces:**
- Produces a guard: `gameConfirmed` may be set true only when the current game's listener isn't failed. Task 10 adds the failed flag; until then the guard reads `!gameWatchFailed`, a `let` that starts false.

- [ ] **Step 1: Write the failing e2e tests.**
  - **Setup for every test:**
    - `instrumentRepo` and `test.use({ serviceWorkers: 'block' })`;
    - open `HOME_URL` and `unlockTracker`;
    - move by setting `location.hash` in `page.evaluate`, never by a tap (a tap can claim control).
  - **`a current game the cache lacks keeps New Game closed until the server answers`:**
    - The rule is `{ 'games/g1': { miss: true, hold: true } }`, with `g1` live on the server.
    - Wait for `__queued['games/g1'] === 1` (the miss was delivered).
    - On `#/new`, `opponent-input` is hidden.
    - After `__releaseHeld('games/g1')`, `resume-live` is visible and the New Game form is still hidden.
  - **`a pointer whose game the server never confirms keeps New Game closed (signal bars, no data)`** (Review Focus 2):
    - The pointer is `gone`, with no `games/gone` document, and the rule is `{ 'games/gone': { cached: true } }`.
    - The page stays online, and `opponent-input` stays hidden. This is a "nothing happened" check, ended by a `__snaps` entry for `games/gone`.
    - Hide and show the page with the `setVisibility` helper (`tracker-access.spec.js:125`). `reconfirm` reads the server's absence, and `opponent-input` appears.
  - **`once the server confirmed the game absent, a later cached null keeps New Game open`:**
    - Baseline: on `67cd574` this test passes, because a cached null opens the form. It stays as a guard against the sticky rule regressing.
    - The server-confirmed null comes first. Then a cached null, injected through a new `instrumentRepo` rule `{ cachedNullAfterServer: true }`, which delivers one extra `cb(null, { fromCache: true, ... })` after the first server snapshot.
    - `opponent-input` stays visible.
- [ ] **Step 2: Write the emulator test `a refused createGame rolls back the game and the pointer in the client's cache`:**
  - A valid editor that is not active calls `createGame`.
  - Before `done` settles, `getDocFromCache(team/main)` shows the new pointer.
  - `done` rejects with `permission-denied`.
  - Afterwards `getDocFromCache(team/main)` shows the previous pointer, and `getDocFromCache(games/<newId>)` rejects or doesn't exist.
- [ ] **Step 3: Run** the e2e file and the emulator command.
  - Expected: the first two e2e tests FAIL; the sticky guard passes.
  - The emulator test passes: it pins the SDK behaviour the fix relies on.
- [ ] **Step 4: Implement.**
  - **`syncGameWatch`:** a callback with `game === null && meta.fromCache` sets `state.game = null` and leaves `gameLoaded` unchanged. `gameLoaded` turns true from a server snapshot or a non-null game. Once true, it stays true until the watch is replaced.
  - **`reconfirm`:** after the existing trip check, when all of these hold, set `state.game = null`, `state.gameLoaded = true`, and `gameConfirmed = true` (through the guard):
    - `fresh.game === null`;
    - `watchedGameId !== null`;
    - `watchedGameId === (fresh.team?.currentGameId ?? null)`.
- [ ] **Step 5: Run** the e2e file, then `tracker-live.spec.js`, `tracker-access.spec.js`, `offline.spec.js` and `tracker-events.spec.js`. Expected: PASS.
- [ ] **Step 6: Commit**: `fix(tracker): a current game missing from the cache is not treated as absent`.

### Task 9: Failure injection, and viewer listeners recover (A4, viewer)

Implementer: sonnet, effort `high`.

**Files:**
- Modify: `tests/e2e/helpers.js` (`instrumentRepo`), `js/viewer.js` (`startWatch`, `fail`, the `online` and visibility hooks)
- Test: `tests/e2e/instrument-repo.spec.js`, `tests/e2e/viewer-recovery.spec.js` (create)

**Interfaces:**
- Consumes `keepWatching` (Task 2), loaded with `import('./watchRetry.js').catch(() => null)`.
- Produces `instrumentRepo` rules, tracked per `watch()` call:
  - **`{ fail: n }`:** for the first `n` `watch()` calls on that path, once that listener's first server snapshot has been delivered, the call's own `onError` (in scope in `watch()`) is called once with `{ code: 'unavailable' }`. Every later snapshot of that listener is dropped.
  - **`{ fail: n, holdReopen: true }`:** additionally holds the first server snapshot of the next `watch()` call on that path until `__releaseHeld(path)`. Held callbacks stay tied to their own subscription.
  - **Window counters:** `window.__failures[path]` counts injected failures, and `window.__attempts[path]` counts `watch()` calls.
  - The `cb(...)` and `updateGameInfo` anchors stay matched.

- [ ] **Step 1: Extend `instrumentRepo`** and write `instrument-repo.spec.js` tests:
  - `a fail rule ends a listener once after its first server snapshot, and later snapshots of that listener are dropped`;
  - `holdReopen holds the reopened listener's first server answer`.
- [ ] **Step 2: Write the failing tests** in `viewer-recovery.spec.js`, with `test.use({ serviceWorkers: 'block' })`:
  - **`a failed live game watch comes back without a reload`:**
    - the rule is `{ 'games/g1': { fail: 1 } }`;
    - wait for `__failures` to be 1;
    - `update` the game's events with a goal;
    - `score-us` shows it.
  - **`a failed stats watch shows Failed until the server answers, never a cached result`:**
    - the rule is `{ 'stats/2026-27': { fail: 1, holdReopen: true } }` on the Results tab;
    - after the failure, `results-failed` is visible;
    - while the reopen is held, an init-script `MutationObserver` records any visibility of `results-loading`, and any row from before the failure. Both must be empty: a nothing-happened check, ended by the release;
    - after `__releaseHeld`, the server's new result row shows. It was written with `update` during the hold.
  - **`the viewer starts and shows the score when watchRetry.js fails to load`:** `page.route('**/js/watchRetry.js', route => route.abort())`. A failure then leaves today's Failed state, the behaviour on `67cd574`.
  - **`a watch that fails before watchRetry.js has loaded is retried exactly once it loads`:**
    - delay the module's route until `__failures` is 1, then fulfil it with the real file;
    - the watch recovers;
    - `__attempts[path]` shows exactly one reopen per backoff step.
- [ ] **Step 3: Run** the two files. Expected: the new viewer tests FAIL.
- [ ] **Step 4: Implement.**
  - **Unchanged:** `startWatch` opens as it does today, and the 6 s deadline stays as it is.
  - **On failure:** `fail` stores `{ data: null, meta: { error: true } }`, as today. Then, if the module is loaded, or as soon as it loads, a failed sub is taken over by `keepWatching(open, { holdCached: true, startFailed: true, onSnapshot: store, onFail: failState })`.
    - `failState` only updates the state.
    - A synchronous throw from the opener in `startWatch` goes through the same takeover.
    - **Takeover rules:**
      - After `store()` renders, re-check the sub's token: a sub replaced during that render is not taken over.
      - Dispose of the original listener.
      - Install exactly one keeper per token.
    - A reopen never resets the state to `data: undefined`.
    - `sub.off` calls the keeper's `stop()`.
    - The 6 s deadline and the stale timer stay as written. Neither one implies a dead listener.
  - **Retry triggers:** `online` and `visibilitychange` (to visible) call `retryNow()` on every keeper.
- [ ] **Step 5: Run** both files, then `viewer.spec.js`, `viewer-home.spec.js`, `viewer-past-games.spec.js` and `offline.spec.js`. Expected: PASS.
- [ ] **Step 6: Commit**: `fix(viewer): failed listeners reconnect with backoff`.

### Task 10: Tracker listeners recover (A4, tracker)

Implementer: sonnet, effort `high`.

**Files:**
- Modify:
  - `js/repo.js`: `watchControl(cb, onError?)` and `watchOwnEditor(uid, cb, onError?)`.
  - `js/tracker/app.js`: `boot`, `subscribe`, `syncGameWatch`, `watchGameWithJournal`, `reconfirm` (both paths), `syncChrome`, and the `online` and visibility hooks.
- Test: `tests/e2e/tracker-recovery.spec.js` (create)

**Interfaces:**
- Consumes:
  - `keepWatching` (Task 2), loaded with `import('../watchRetry.js').catch(() => null)`, awaited in `boot()` next to `signIn`;
  - the `fail` and `holdReopen` rules (Task 9);
  - Task 8's `gameConfirmed` guard.
- Produces: `ctx.watchGame(gameId, cb)`, with the same signature, now retried.

- [ ] **Step 1: Write the failing e2e tests**, with `test.use({ serviceWorkers: 'block' })`:
  - **`a failed team listener shows the offline banner and recovers`:**
    - rule `{ 'team/main': { fail: 1 } }`;
    - `offline-banner` becomes visible, then hidden;
    - a roster rename made with `update` shows on Roster.
  - **`a failed game listener keeps a tap pending until the reopened server answer, then confirms it`:**
    - rule `{ 'games/g1': { fail: 1, holdReopen: true } }`;
    - tap a goal after the failure;
    - while held, the journal entry is pending: read `localStorage['wp-journal']` in `page.evaluate`, and `failed-banner` is hidden;
    - after the release the entry is gone, and the goal is in `get('games/g1').events`.
  - **`back from the background, a failed control listener keeps a non-active device unconfirmed`** (Review Focus 3):
    - Unlock. Then `otherDeviceTakesControl()`, with no game live, and reload with the rule `{ 'control/tracker': { fail: 99 } }`.
    - `setVisibility` hidden, then visible, and wait until the `confirmFromServer` read has completed (`window.__confirmed`, set by an init-script wrapper).
    - `takeover-banner` stays visible. A tap on `.brand` doesn't claim control: `get('control/tracker').activeUid` is unchanged.
  - **`a write made while the game listener is failed shows at the next reopen`** (the spec's accepted limitation):
    - rule `{ 'games/g1': { fail: 1, holdReopen: true } }`;
    - wait for `__failures` to be 1, then tap a goal;
    - `offline-banner` is visible;
    - after `__releaseHeld`, `score-us` shows the goal.
  - **Mixed cache, old `repo.js`:** the tracker boots, unlocks, records a goal (checked in Firestore), and the old control and editor watches keep working.
  - **Mixed cache, old `events.js`:** edit a goal's scorer, delete a goal, and end the game, all checked in Firestore.
  - **`the tracker starts and records a goal when watchRetry.js fails to load`.**
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Listeners:** the editor, control, team and game listeners open through `keepWatching(…, { holdCached: false })`.
  - **Failed flags:** each listener has one. It is set in `onFail` and cleared by a server snapshot.
    - While it is set, that listener's confirmed flag is false.
    - Both `reconfirm` paths, and Task 8's absence assignment, leave failed listeners unconfirmed.
  - **Game watch failure:** `last` is cleared at once in `onFail`, and the watch stays in `gameWatches`.
  - **Banner:** `offlineBanner.hidden = (state.online && !anyListenerFailed) || current.slot === 'unlock'`.
  - **Retry triggers:** `online` and visible call `retryNow()` on every keeper.
  - **Replacement:** replacing the game watch calls `stop()`.
  - Without the module, every listener opens as it does today.
- [ ] **Step 4: Run** the file, then `tracker-access.spec.js`, `tracker-live.spec.js`, `tracker-events.spec.js` and `offline.spec.js`. Expected: PASS. A WebKit failure counts only if it is on the known-flakes list and passes alone.
- [ ] **Step 5: Commit**: `fix(tracker): failed listeners reconnect; the screen stays unconfirmed while one is down`.

### Task 11: Season names follow the roster (M3)

Implementer: sonnet, effort `medium`.

**Files:**
- Modify: `js/viewer.js`: `rosterNames()` beside `rosterCaps()`, `seasonPlayersPanel`, `seasonWho`, and the `renderIfChanged` inputs at `:912`
- Test: `tests/e2e/viewer-season-names.spec.js` (create)

- [ ] **Step 1: Write the failing e2e tests:**
  - **`season totals show the roster's current name, falling back to the stored one`:**
    - `stats` has `players.p1.name = 'Παλιό'`, and the roster names `p1` `Νέο`;
    - the row shows `Νέο`;
    - a player the roster lacks keeps the stored name.
  - **`a rename redraws the totals and goalies and their order without a stats write`:**
    - two players and two goalkeepers are tied;
    - a rename through `update('team/main', …)` flips the alphabetical order in both tables;
    - `get('stats/<season>')` is unchanged.
  - **`a scoped Players view uses the current names too`.**
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `rosterNames()` returns a `Map` from id to name, with `rosterCaps()`'s guards.
  - The resolved name replaces `name` before sorting, in both tables and in scoped rows.
  - `[...names]` joins the panel's `renderIfChanged` inputs.
- [ ] **Step 4: Run** the file, `viewer-scope.spec.js` and `viewer-tabs.spec.js`. Expected: PASS.
- [ ] **Step 5: Commit**: `fix(viewer): season totals use the roster's current names`.

### Task 12: Cleanup (C1, C2)

Implementer: sonnet, effort `medium`.

**Files:**
- Modify:
  - `js/model.js:48-49`;
  - `js/strings.js:335` and `362-363`, plus the five unused keys;
  - `css/viewer.css:186-188`;
  - the two "R2 tracker markup … remove in R4" blocks in `css/tracker.css` (about `:325-350`);
  - `css/base.css:34`.
- Test: `tests/unit/strings.test.js:170`, `tests/unit/model.game.test.js:150`, and a new `tests/unit/cleanup.test.js`.

- [ ] **Step 1: Write `tests/unit/cleanup.test.js`:**
  - the removed exports, string keys and CSS selectors are absent from the source;
  - `small {` is still present in `css/base.css`;
  - `evGoalieFor` and `evDeleteFor` still exist.
- [ ] **Step 2: Check each removal for use.**
  - `rg -n "TIMELINE_SAVES|\bevGoalie\b|\bhomeHeading\b|\bgoalPlain\b|\bscorerLabel\b|\bevDelete\b|home-live-text-slots|home-live-gap" js css tests` should show only the definitions and the two compatibility tests.
  - `rg -n "class: ['\"]([^'\"]* )?small( [^'\"]*)?['\"]" js` should show no `small` class token.
  - Keys built at runtime (`t(\`…${x}\`)`) are checked by reading their callers.
- [ ] **Step 3: Remove.**
  - Delete the code and its two compatibility tests.
  - Delete only the named string keys.
  - Delete only the `.small` selector.
  - Keep every block tagged "Shared by R2 and R3".
- [ ] **Step 4: Run** `npm test`, then `tracker-look.spec.js`, `viewer-look.spec.js` and `tracker-live.spec.js`. Expected: PASS.
- [ ] **Step 5: Commit**: `chore: remove release-2 compatibility code and unused strings`.

### Finish

- [ ] The controller runs `npm test`, the emulator suite, and the full e2e with `--reporter=list`. A WebKit failure counts only if it is on the known-flakes list and passes alone.
- [ ] One Codex (high, read-only) review of the whole branch. Fix rounds go to sonnet.
- [ ] The owner picks from the finish menu. A deploy follows the release routine: no live game, ff-merge, Pages check, headless check.
