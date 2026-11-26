# Fix release from the 26/11 review — design (26/11/2026)

Project-sized: it changes how the tracker and viewer recover listeners and what counts as a loaded game, so it follows the full-design rule for sync changes. Source: `docs/code-review-2026-11-26.md` (findings A1–A5, M1–M3, M9, cleanup C1–C2). Base: `main` at `67cd574`.

Reviewed before planning by a builder check (opus) and a read-only Codex design review (high). Their findings and the rulings are under **Review rulings** at the end.

## Intent
- Ship the cheap, local fixes from the 26/11 review before the multi-club work starts, so that work builds on a clean base.
- Owner's words: "lets do the fixes and then revert to multiclub changes".
- What the owner should see afterwards:
  - on a tournament day the viewer always shows the newest game;
  - the tracker and viewer recover by themselves after a listener error or a quota reset;
  - a correction made from two tabs can't show a goal twice;
  - Past games and the tracker Home don't read every game.

## Goals, non-goals, anti-goals
- **Goals:** the fixes listed under Design, each with a test that fails on today's code.
- **Non-goals:**
  - **Two writers with one identity** (two tabs on one phone share the anonymous uid, so both are "the active tracker"). This covers both starting a game at once, a list entry being linked while it is removed, and the stats queue in two tabs (A7(1)). It belongs to the ownership project (A6), together with A7(2) and A7(3); there, a server-side dirty-seasons marker replaces the local queue's cross-tab role.
  - Re-pointing after an **offline** end. Skipping the lookup offline stays by design (review "By design").
  - M4–M8 and M10–M12.
  - The versioned release path (cleanup C3), the viewer read volume (R3) and the module splits (C7).
  - Any change to `firestore.rules`. Rules are published by hand in the Firebase console, and this release needs no console step.
  - Any visible redesign. New UI is limited to the Past games "Show more" button.
- **Anti-goals:**
  - Any change to the score, totals or stats of a game that has no duplicate event ids.
  - Offline use at the pool getting worse: ending a game and starting the next with no signal must still work.
  - A phone mixing this release's files with the previous release's breaking or writing wrong data, in either direction (new view with old repo, old view with new repo).
  - A retry loop that keeps a quota-exhausted project exhausted.
  - Any regression at 360 px or in dark mode.

## Constraints
- Static site, no build step, vanilla ES modules, Firebase JS SDK 12.19.0 from gstatic, Spark plan (50 k reads and 20 k writes a day).
- **Mixed module cache:** the service worker serves each file network-first with a 3 s fallback, so a phone can run this release's file beside the previous release's. The rules:
  - A new export of an existing module is read through a namespace import with `?.` and a fallback.
  - An existing export keeps its signature and return shape; new behaviour gets a new export.
  - A brand-new module file is loaded with a dynamic `import()` and a fallback, as `accent.js` and `teamView.js` are.
  - Every new file goes in the service worker's `SHELL` list (`tests/unit/sw-shell.test.js` enforces it).
- Production data (checked 26/11 through the public REST read):
  - 4 games, none with duplicate event ids, so no season needs a repair recount;
  - every game has `createdAt`;
  - one date has two games.
- Removing exports is safe: the R2 viewer reads `model.TIMELINE_SAVES` and `strings.TIMELINE_SAVES` through namespaces (checked in `c3c4c4d`), so removing them only turns off its timeline saves.
- No deploy on a game day (release routine).

## Approaches
- **One fix release, each fix local to the module with the bug, plus one new pure module for listener retry (picked).** Low risk, and each fix can be tested alone.
- **Fold the fixes into the multi-club refactor (rejected).** The refactor rewrites the same code, but mixing the two would hide behaviour changes inside a large path change and delay the tournament-day fixes.
- **Server-side guards in the rules for A1 and A2 (rejected for now).** A rule that refuses moving the pointer off a live game would also catch two tabs. But it costs a rules read per pointer write and a hand-published rules change, and it belongs with the two-writer work in the ownership project.

## Design

### A1 — one version per event id
- New pure export `uniqueEvents(events)` in `js/model.js`:
  - keeps the **last** entry for each string `id`, in that entry's position (`arrayUnion` appends, so the last is the newest write);
  - keeps every entry without a string `id`;
  - returns the input array unchanged when there are no duplicates.
- **Reads** are deduplicated at the repo boundary. `gameData()` in `js/repo.js` sets `events` to `model.uniqueEvents?.(events) ?? events` when `events` is an array. Every reader goes through `gameData`:
  - both apps' game listeners;
  - `readGameFromServer`, `confirmFromServer`, `listGames`, `listGamesFromServer`, the new `listGamesPage`;
  - `recomputeSeason`.
- The derivations themselves are unchanged.
- **Writes** remove every known version:
  - The repo remembers, per game id, the raw (undeduplicated) events of the newest snapshot it decoded for that game and of the newest server-confirmed one, from any read. A pending replace that the server later refuses must not make it forget committed versions.
  - `removeEvent(gameId, event)` removes `event` plus every other remembered entry with the same `id`, in one `arrayRemove(...)`.
  - `replaceEvent(gameId, old, new)` does the same in its remove step, then unions `new`.
  - Signatures are unchanged, so old views work.
- **Consequences:**
  - The journal reconciles against the surviving version. A tab whose correction lost shows "not saved"; its Retry then writes its version over all versions.
  - A goalie switch or situation correction with two versions under one id disappears completely when removed.
  - Two corrections with **different** ids from two tabs are a two-writer case (non-goal).

### A2 — a game the cache lacks is not loaded
- In `syncGameWatch` (`js/tracker/app.js`), a snapshot with `game === null` and `meta.fromCache === true` leaves `state.gameLoaded` false and `state.game` null.
- Only a server-confirmed absence (`fromCache === false`) sets `gameLoaded` true with no game.
- Once `gameLoaded` is true for a watch, it stays true for that watch: a later cached null (signal lost) does not block Start again.
- `reconfirm()` applies a server-confirmed absence too. When its read finds the same pointer as `watchedGameId` and `fresh.game === null`, it sets `state.game = null`, `gameLoaded = true` and `gameConfirmed = true`, under the existing background-trip check.
- Effects, all through existing code:
  - `gameLive` stays true, so New Game and Reopen stay blocked;
  - the live screen shows Loading, and the offline banner shows when the browser is offline;
  - the landing redirect and the post-takeover repair wait.
- A game created offline is in the cache (pending), so ending one game and starting the next with no signal works as today.
- A refused `createGame` rolls back the game and the pointer together. It needs no special case, but it gets its own test.
- Pending writes do **not** block Start, as the review first suggested: that would break the offline tournament-day flow.

### A3 — the newest game wins ties
- New pure exports in `js/model.js`:
  - `compareGames(a, b)` orders by `date`, then `createdAt` (a Firestore `Timestamp`, via `toMillis()`), then `id`;
  - `newestGame(games, excludeId)`.
  - Server reads still overlay this device's pending writes, so `createdAt` can be null: a game created on this device whose create has not committed yet. A null `createdAt` sorts as **newest** (it was created after every committed game). A missing field (none in production) sorts as oldest.
- `newerGameId(gameId, date)` in `js/repo.js`:
  - It runs two reads from the server in parallel: the ended game, and `where('date', '>=', date)`. `date` is the caller's (a client-set field, never pending). This is a single-field range, so it needs no composite index.
  - It returns the newest other game when that game sorts after the server's copy of the ended game.
  - It returns null when the server has no copy of the ended game, or when the reads fail.
  - An old caller passes no `date`: it then runs today's lookup unchanged.
  - When `model.compareGames` is missing (an old `model.js`), it keeps today's strict date comparison.
- `endGame(gameId, date)`: the Events sheet (`js/tracker/views/events.js:238`) passes `target.date`. The 2 s budget and the offline skip are unchanged.
- `deleteGame` picks the replacement with `newestGame` among the remaining games on the newest remaining date. It finds that date first, then queries `where('date', '==', topDate)`, instead of `limit(2)` by date.

### A4 — failed listeners come back
- **New module `js/watchRetry.js`**, pure and unit-tested, with injected timers and clock:
  - `keepWatching(open, { onSnapshot, onFail, delays, timers, now })`. `open(next, fail)` subscribes and returns an unsubscribe. `next(data, meta)` passes the repo's `meta`.
  - On `fail` it calls `onFail(err)` and reopens after the next delay: 2 s, 5 s, 15 s, 30 s, then every 60 s, with ±20 % jitter. Retries never stop while the watch is kept.
  - **Failed until the server answers.** The first snapshot with `fromCache === false` after a failure clears the failure and resets the delays. Cached snapshots never do, so a quota-exhausted watch that answers from the cache and then fails again keeps backing off.
  - Option `holdCached`: when true, cached snapshots of a failed watch are held back, not passed on (the viewer: its error state stays until the server answers). When false, they are passed on while the watch stays failed (the tracker: its own pending writes, such as an offline end, must still show).
  - Callbacks from a replaced or stopped subscription are ignored.
  - It returns `{ retryNow(), stop(), failed() }`. `retryNow()` reopens at once only when the watch is failed and its last attempt was at least 10 s ago. It does not reset the backoff step.
  - Option `startFailed: true`: the watch starts as failed and makes its first open after the first delay. The viewer uses it to take over a watch that failed before the module had loaded.
- **Loading:**
  - The viewer loads it with `import('./watchRetry.js')`.
  - The tracker loads it with `import('../watchRetry.js')`, awaited next to `signIn` in `boot()`.
  - Both catch a failed load. Without the module they behave as today.
- **`js/repo.js`:** `watchControl` and `watchOwnEditor` gain the optional `onError` the other watches already take. An old repo ignores it, so those two watches behave as today.
- **Viewer** (`js/viewer.js`): watches open as today, so a slow module load never delays the first score. When a watch fails, and the module is loaded or loads later, a `keepWatching` with `holdCached: true` and `startFailed: true` takes the watch over.
  - A failed watch keeps its error state (`data: null, meta.error`) until a server snapshot replaces it. A retry never resets it to "no snapshot yet", so the screen doesn't flash Loading.
  - The 6 s first-answer deadline stays as it is. The listener behind it is alive, so it is not reopened.
  - `online` and `visibilitychange` to visible call `retryNow()` on every watch.
- **Tracker** (`js/tracker/app.js`): the editor, control, team and current-game listeners, and every `ctx.watchGame` (past-game views), open through `keepWatching` with `holdCached: false`.
  - **Accepted limitation:** between a terminal failure and the next reopen, no listener is open, so the tracker's own writes show at the reopen: within 60 s, or at once on `online` or visible. Terminal listener errors come from quota or permission refusals, where the writes fail too and say so. A cache-only feed was considered and dropped: the SDK ends every listener on a rejected target, the cache-only one included, and the two feeds can deliver the same write twice.
  - **Listener health:** each listener has a failed flag. While it is set, its confirmed flag (`teamConfirmed`, `controlConfirmed`, `gameConfirmed`) is false, and `reconfirm()` does not set it, even from a read that started before the failure. A server snapshot clears it.
  - **Journal:** a failed game watch's `last` is cleared, so no entry is reconciled against a snapshot from before the failure. Its entries stay pending until the reopened listener's first server snapshot reconciles them. The watch stays in recovery's `watchedIds`, so orphan recovery does not race it.
  - **Visible state:** while any listener is failed, the offline banner shows with its existing text. There is no new string.
  - **Retry triggers:** `online` and visible call `retryNow()` on all listeners.
  - **Replacement:** a game watch that `syncGameWatch` replaces stops its retry.
  - A device that is active from a cached control snapshot keeps its controls, as it does offline today. A write the rules refuse goes through `onWriteError`.

### A5 — the service worker survives a failing Cache Storage
- **`networkFirst`** (`sw.js`) starts the fetch first. Every cache call is optional: failures of `caches.open`, `match` and `put` are caught and logged, and the request is answered from the network alone, as `cacheFirst` already does.
- Install and activate are unchanged. A phone whose Cache Storage fails can't install a new worker until storage works again, and then the normal install runs. A worker that installed without a shell could later strand offline clients on an empty cache, so this release does not add one.
- **Version:** bump `CACHE` to `wp-shell-v7`, because the shell list gains `js/watchRetry.js`.

### M1 — one recount per correction, after the write
- `recountAfter` (`js/tracker/recount.js`) marks the seasons dirty at once, so the mark is persisted. After the write settles, whichever way, it marks them again and drains **once**.
- The immediate drain is removed. It could finish before the write was even queued: `endGame` awaits its lookup and `deleteGame` awaits server reads before they commit, and `waitForPendingWrites` covers only writes already issued.
- The second mark stays: another drain (online, takeover, the timer below) can consume the first mark while the write is still waiting, and the settle-time mark guarantees a recount that sees the write.
- A write that never settles (page closed offline) leaves the mark, which the next boot or takeover drains, as today.
- **Wake-up:** when a drain leaves failed seasons while this device is active, the tracker drains again 60 s later, one timer at a time. When the timer fires it checks again that the device is active and seasons are dirty. This covers a recount read that fails with signal bars but no data, where neither `online` nor the active transition fires.

### M2 — Past games and Home read less
- `listGames()` keeps its signature and return value (a full array) for old callers.
- **New `repo.listGamesPage({ after, pageSize = 20 })`:**
  - returns `{ games, cursor, more }`, ordered by date descending, then by document id descending;
  - `cursor` is the page's last `DocumentSnapshot`, used with `startAfter`;
  - it fetches `pageSize + 1` documents to know `more`.
- **Past games** (`js/tracker/views/games.js`):
  - uses `listGamesPage` when it exists, showing the first 20 and a "Show more" button under the list while `more` is true;
  - offline, pages come from the cache, as the full list does today. A list that shows any cached page reloads from page one when the tracker comes back online, so an offline cursor can't skip games the cache lacked;
  - without `listGamesPage` it falls back to `listGames()`, showing the whole list with no button;
  - new string `gamesShowMore` ("Show more"), falling back to the key name.
- **Home's game count** (`js/tracker/views/home.js:65-73`):
  - uses a new `repo.countGames()` (`getCountFromServer` on `games`) when it exists;
  - offline or on error the count stays hidden, as today. Online, a game created on this device that hasn't synced is missing from the count until it syncs; accepted;
  - without `countGames` it keeps calling `listGames()`.
- **Competitions in-use check** (`js/tracker/views/competitions.js`):
  - New `repo.listEntryInUse(list, id)` waits for pending writes, then runs `getDocsFromServer(query(games, where(<tournamentId|phaseId>, '==', id), limit(1)))`.
  - The check runs for every entry in parallel on mount, and for the one entry at the moment of Remove. The existing retry after a failed check re-runs only the entries whose check failed.
  - A raw field match counts as in use, even where `competitionOf` would ignore it. So the check can block a removal but never allow a wrong one, at the moment it runs.
  - Without `listEntryInUse` it falls back to `listGamesFromServer`.

### M3 — season names follow the roster
- The viewer resolves a season row's name from the live roster by player id, falling back to the stored name. This applies to the totals and goalies tables and their sort, in every scope, and works like the existing `rosterCaps()`.
- The resolved names are part of the panel's `renderIfChanged` inputs, so a rename redraws it with no stats write.
- Stored stats are unchanged.

### M9 — tracker game routes are validated
- `validDocId` moves from `js/viewer.js` to `js/model.js` as an export. The viewer uses it through the namespace, keeping its own copy as the fallback.
- The tracker's `#/games…` route is parsed into three cases:
  - the list (`#/games`);
  - a detail (`#/games/<one segment>`, decoded, then passed through `model.validDocId?.()` or an inline fallback);
  - invalid: an undecodable segment, extra segments, or an invalid id.
- An invalid route shows the existing "not found" detail state instead of throwing.

### Cleanup
- **C1:** remove the release-2 compatibility code:
  - `TIMELINE_SAVES` in `js/model.js` and `js/strings.js`, with their comments;
  - `.home-live-text-slots` and `.home-live-gap` (`css/viewer.css:186-188`);
  - the two "R2 tracker markup … remove in R4" blocks in `css/tracker.css`;
  - the tests that assert them.
  - Keep every block tagged "Shared by R2 and R3".
- **C2:** remove the unused string keys `evGoalie`, `homeHeading`, `goalPlain`, `scorerLabel` and `evDelete`, by exact key. Similar keys such as `evGoalieFor` and `evDeleteFor` stay. Re-check each removed key for dynamic use. In `css/base.css:34`, remove only `.small` from the `small, .small` selector.

## Testing
- Each fix gets a test that fails on `67cd574`.
- **Unit:**
  - `uniqueEvents`, `compareGames` and `newestGame`.
  - `keepWatching`, with fake timers: the backoff; cached snapshots held back after a failure; reset only on a server snapshot; stale callbacks ignored; the `retryNow` throttle; `stop`.
  - `recountAfter`: one drain, after the write settles, on either outcome.
  - `networkFirst` with a throwing `caches.open`, `match` or `put`.
  - The M9 route parser.
- **Emulator** (`tests/emulator/repo.test.js`):
  - duplicate ids collapse through `gameData`;
  - `removeEvent` and `replaceEvent` clear every version of an id;
  - a same-date end re-points to the later-created game;
  - an end with an uncommitted ended game does not re-point;
  - `deleteGame` picks the later-created same-date game;
  - `listGamesPage` paging across a tied date;
  - `countGames`;
  - `listEntryInUse`.
- **E2e:**
  - the tracker with the current game missing from its cache doesn't offer New Game, and does once the server confirms the game is absent;
  - a refused create;
  - a viewer and a tracker listener made to fail recover without a reload, with no Loading flash (the instrumented repo used by `instrument-repo.spec.js` can inject the failure);
  - Past games "Show more";
  - a renamed player shows the new name in the season totals;
  - an invalid tracker game route.
- **Mixed cache:** for each changed repo export, a test with the previous release's caller, and one with the previous release's repo where the view gained a fallback. Use `git show 67cd574:<path>`.
- The full unit, emulator and e2e suites pass before merge. The controller runs the emulator and e2e suites, because Codex can't bind ports.

## Left to the builder
- Task order and split; test file placement; the exact jitter maths.
- The e2e failure-injection mechanism.
- How `syncGameWatch` holds its `keepWatching` handle, and where the repo keeps its raw-events memory (a `Map` bounded to the games currently watched or read is enough).
- The wording of code comments.

## Review rulings (26/11)
Codex design review (high) said "needs changes": 2 Critical, 15 Important, 4 Minor. The builder check asked two questions. Each item and how this document now handles it is below.

A Codex re-check (medium) of the revised mechanisms found 7 Important and 4 Minor issues, all applied above:
- the tracker passes cached snapshots on while a watch is failed (`holdCached: false`);
- failed game watches keep their journal entries pending, instead of handing them to orphan recovery;
- `retryNow` doesn't reset the backoff;
- M1 keeps the settle-time second mark;
- a pending (null) `createdAt` sorts as newest;
- activation keeps the old shell unless the new one is complete;
- cached Past games pages reload when back online;
- committed raw versions are remembered too;
- `gameLoaded` stays true for a watch once set;
- an old Events caller runs today's lookup;
- the competitions retry re-runs only failed entries.

The Codex plan review (high) found 3 Critical issues, which changed the design:
- **Tracker game watches:** between retries no listener is open, so an offline End would not show. A cache-only feed was added, then dropped after the plan re-check, and the gap is now an accepted limitation (see A4): Firestore ends that feed together with the failed listener, and the two can deliver the same write twice.
- **Viewer:** its first watches open before the retry module loads, so the module takes a watch over when it fails (`startFailed`).
- **Service worker:** an install without a shell could strand offline clients, so the install and activate changes were dropped and only the `networkFirst` fix stays.

| Finding | Ruling |
|---|---|
| A2 two tabs start at once (Codex Critical) | Two writers with one uid: moved to the ownership project (non-goal). |
| A3 post-commit re-point races a game started offline (Codex Critical); the repair is lost if the page closes | The offline re-point was dropped; offline ends stay as designed. |
| A1 dedupe hides versions that writes still need | Accepted: removes clear every remembered version of the id. |
| A1 correction replays with versions | Same-id versions are covered by the change above; different ids from two tabs are a non-goal. |
| A1 stored seasons keep old double counts | Not needed: production has no duplicates (checked). |
| A2 Loading indefinitely when absence is only known from the cache | Kept on purpose while no server answers. `reconfirm` now applies a server-confirmed absence. |
| A3 a pending `createdAt` picks the wrong game | Accepted: the ended game is read from the server; no server copy means no re-point. |
| A4 `reconfirm` sets confirmation on a failed listener; journal and orphans | Accepted: listener health and the `reconfirm` guard. Failed game watches keep their entries pending until the server answers (after the re-check). |
| A4 a cached answer erases the error and resets the backoff (also builder Q2) | Accepted: failed until the server answers. |
| A4 retry load and foreground bypass | Accepted: `retryNow` throttled to 10 s, delays capped at 60 s. A terminated client stays out of scope (the bfcache reload already covers it). |
| A4 tracker import path; old repo ignores `onError` | Accepted: `../watchRetry.js`; the old-repo behaviour is stated. |
| A5 the new worker never installs when Cache Storage fails | First accepted, then dropped after the plan review: see the note above the table. |
| A7(1) the stats queue can't tell a new mark apart | Moved to the ownership project (server-side dirty marker). |
| M1 the only drain runs before the write is queued | Accepted: one drain after the write settles, with the settle-time mark kept. |
| M1 a failed drain has no wake-up | Accepted: 60 s re-drain while active. |
| M2 `listGames` shape breaks old callers; Home reads everything (also builder Q1) | Accepted: `listGames` unchanged, new `listGamesPage` and `countGames`. |
| M2 an entry removed while another tab links it | Two writers: non-goal; the guarantee holds at the moment of the check, as today. |
| M2 cursor ties and cached pages | Accepted: document cursor, `pageSize + 1`; offline pages come from the cache. |
| M3 a rename doesn't redraw | Accepted: names are part of the render inputs. |
| M9 the route parser cases | Accepted: list / detail / invalid. |
| Cleanup `.small` and string prefixes | Accepted: selector-only and exact-key removals. |
