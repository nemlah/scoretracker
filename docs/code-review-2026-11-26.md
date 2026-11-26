# Whole-codebase review: correctness, performance, cleanup, multi-team readiness

**Reviewed:** 26/11/2026 · **Revision:** `67cd574` (main) · **Code not changed.**
**Reviewers:** Claude Opus 5.5 (main session) and Codex `gpt-6.2-sol`, high effort, read-only, run in parallel. A haiku `lookup` pass checked CSS class usage.
**Tests at HEAD:** unit 356/356 pass. Emulator and e2e suites were not re-run (no code changed since the 24/11 run: emulator 46, e2e 1039 passed / 3 WebKit load flakes).

Every finding below was checked against the code. **Source** says who found it. **Ruling** is the controller's severity after verification; it differs from the reviewer's label where noted.

## Summary

- Nothing corrupts data in the normal one-scorekeeper, one-phone flow.
- The real risks are **two writers** (two tabs, a retry with an old snapshot, a takeover race) and **listeners that die and never come back**.
- Two cheap fixes matter now that tournaments put several games on one day: the **same-day pointer** (R8) and **starting a game over a live game the cache hasn't loaded**.
- Of the 16/11 review, R1 is fixed, R6 partly. R2–R5 and R7–R11 are still open.
- The cleanup backlog is small: CSS is clean, and the release-2 compatibility code can go.
- The structural debt is the 44 checks for phones that mix modules from two releases, and the single-team data paths.

## A. Findings

### Important: fix in the next release

| # | Source | Finding | Failure scenario | Fix |
|---|---|---|---|---|
| A1 | Codex (Critical → Important) | **Duplicate event ids double-count.** `replaceEvent` is `arrayRemove(old)` + `arrayUnion(new)` (`js/repo.js:242-247`); no derivation dedupes by id (`js/model.js:194-200`). | Two tabs both change the scorer of goal A, one to B and one to C. The second remove finds nothing, so B and C both survive under one id and the score reads 2–0. The same happens when a retry uses a confirmed but outdated snapshot (`js/tracker/recovery.js:46-59`). | Short term: one `eventsOf(game)` normaliser that keeps the last entry per id, used by every derivation and by the recount, so a duplicate can never show. Long term: see the concurrency project (B). |
| A2 | Codex (Critical → Important) | **A new game can be started over a live game the cache lacks.** `formAvailable = gameLoaded && game?.status !== 'live'` (`js/tracker/views/newgame.js:124`). A cache miss arrives as `game === null` with `gameLoaded = true` (`js/tracker/app.js:517-524`). | The active phone has the team pointer but not the game itself (it took over on a weak signal). New Game is enabled; starting moves the pointer, and the real live game is stranded and unreachable from the viewer. Two tabs starting from the same final snapshot do the same. | Treat a `fromCache` null game as not loaded: only a server-confirmed absence counts. Block Start while writes are pending. |
| A3 | both | **R8: the same-day pointer.** `newerGameId` compares `date >` strictly; ties under `orderBy('date','desc')` fall back to the document id (`js/repo.js:112-123`). `deleteGame` has the same tie (`js/repo.js:310`). An offline end skips the lookup entirely (`js/repo.js:290`). | On a tournament day, reopen game 1 and end it again while game 2 (same date) exists: the viewer keeps showing game 1. | `where('date', '>=', date)` (single field, no index) and pick the newest by (date, createdAt, id) on the client. Re-run the check when an offline end syncs. |
| A4 | both | **R6: listeners that fail stay dead.** None of the tracker's listeners has an error callback (`js/tracker/app.js:686-707, 517`). The viewer shows the error but never re-subscribes the same key (`js/viewer.js:137-180`). | The daily quota runs out mid-day (README). After the reset the tracker is frozen without a message, and the viewer shows "failed" until it is reloaded. | Re-subscribe failed watches with backoff, and also on `online` and `visible`. Give the tracker a visible "connection lost, reload" state. |
| A5 | both | **R7: the service worker has no fallback when caches fail.** `caches.open` sits outside the `try` in `networkFirst` (`sw.js:124`). | Cache Storage rejects (quota, private mode). Every same-origin request fails, and Codex's probe made zero network calls. | Start the fetch first and treat every cache call as optional, as `cacheFirst` already does. |
| A6 | Codex | **Ownership and confirmation gaps.** (1) A quiet takeover is not conditioned on the server state (`js/tracker/app.js:242-260`, `firestore.rules:24-28`). (2) `reconfirm` applies a one-shot read without checking for newer listener snapshots, and confirms the game by status alone (`js/tracker/app.js:716-743`). (3) An unlock that timed out still claims control when its write finally lands (`js/repo.js:182-187`). (4) Retrying a correction re-adds a goal another device deleted (`js/tracker/taps.js:103-124`). | Each case needs two devices and a delay. Example: A shows a final game and B starts a live one; A touches its screen before B's snapshot arrives and takes control without the live-game banner. | This family is a project (B). Per the standing rule, it gets a full design and a Codex design review before any code. |
| A7 | both | **Recounts.** (1) R5: the stats queue loads storage once and writes back its own copy (`js/tracker/statsQueue.js:12-46`), so a second tab's mark is lost. (2) A slower tab can publish an older aggregate over a newer one (`js/repo.js:317-332`). (3) The repair after a takeover recounts only the current game's season (`js/tracker/app.js:546-555`), so a season the game was moved out of keeps counting it. | Two tabs, or a game moved between seasons and the phone closed before its recount ran. | (1) Re-read storage before each write, as the journal does. (2) and (3) go into project B: a server-side "dirty seasons" marker written in the same batch as the change. |

### Minor

| # | Source | Finding | Fix |
|---|---|---|---|
| M1 | both | R2: each final-game correction recounts twice (`js/tracker/recount.js:14-21`). The first drain already waits for pending writes. | Mark dirty at once; drain once, after the write settles. |
| M2 | both | R4: Past games reads every game ever with full event arrays (`js/repo.js:169`, `js/tracker/views/games.js:84`). The Competitions in-use check does the same twice (`competitions.js:44-53, 85-94`). | Query one season at a time; check entry use with `where('tournamentId', '==', id)` / `where('phaseId', '==', id)`, `limit(1)`. |
| M3 | both | R11: a roster rename leaves season names stale until the next recount (`js/model.js:406-414`). | The viewer resolves names from the live roster by id, with the stored name as fallback. |
| M4 | Codex | R9: goals against before any recorded switch belong to the lowest-cap goalie at replay time (`js/goalies.js:13-30`). A cap swap in Lineup rewrites history. | Store the starting goalie on the game, or write a `gkIn` at the first goalie's game start. |
| M5 | Codex (Important → Minor) | Corrections find their partner by `goal.ts - 1` (`js/goalies.js:74`, `js/situations.js:93`). A retrospective goal added to a past game gets today's timestamp (`js/tracker/views/events.js:146`), so situation replay sees it after Q4. The effect is small (it can't be a man-up goal), but ordering is not explicit. | Store the target event id on corrections. Give a retrospective insert a timestamp just after the last event of its quarter. |
| M6 | Codex (Important → Minor) | Game Details fills once per game (`js/tracker/views/games.js:329-338`) and Save sends opponent, date and season even when untouched. A newer server value can be reverted. | Send only the fields that changed. |
| M7 | Codex | Clearing the date on New Game can leave the season of the previous date (`js/tracker/views/newgame.js:27-39`). | Derive the season from the date that is actually saved, unless it was edited. |
| M8 | Codex | A foul logged in the shootout counts in player totals but not in the Team tab (`js/model.js:207-218`). | Disable EXCL/PEN in SO, or exclude SO fouls everywhere. |
| M9 | Codex | The tracker's `#/games/a%2Fb` decodes to a nested path and throws (`js/tracker/views/games.js:13-20`). | Reuse the viewer's `validDocId`. |
| M10 | both | R10: the closed Events sheet re-renders and replays the goalie history on every snapshot (`js/tracker/views/events.js:343-359`). | Render on open; one replay for all rows. |
| M11 | Codex | The rules have no shape or transition checks on `games`, `team` and `stats` (`firestore.rules:30-32`). | Acceptable for one trusted club. Required before strangers get edit codes (multi-team). |
| M12 | Codex | The edit code is 6 characters with no attempt limit and no expiry; restoring an old code revalidates old grants (`firestore.rules:4-22`). The rules' `get()` reads are billed, so on Spark the daily quota caps guessing. | Fine for one club. Multi-team: per-team admin sign-in, longer codes, App Check, a code version in the grant. |

### By design, verified (not bugs)

- An exclusion during our man-up closes it as "missed" and opens a man-down (man-up spec, outcome table).
- Friendlies are left out of totals and the record; shootout goals are kept separate.
- `endGame` running without the newer-game lookup offline is deliberate (no 2 s stall at the pool). A3 adds a re-check when the end syncs.

## B. Prior review (16/11) status

| ID | Status | Note |
|---|---|---|
| R1 | **Fixed** | The journal keeps one intent per event id (`js/journal.js:71-85`, `js/tracker/taps.js:89-127`). The two-writer case is new: A1. |
| R2 | Open | M1 |
| R3 | Open | The viewer reads the full game doc per tap. About 120 updates × 300 viewers × 3 games ≈ 108 k reads, above the README's ~1,000 viewer-games/day estimate. A compact `live/<gameId>` summary doc would fix it. |
| R4 | Open | M2 |
| R5 | Open | A7(1) |
| R6 | Partly fixed | The viewer surfaces errors; nothing recovers them. A4 |
| R7 | Open | A5 |
| R8 | Open | A3 |
| R9 | Open | M4 |
| R10 | Open | M10 |
| R11 | Open | M3 |

## C. Cleanup and optimisation

1. **Release-2 compatibility (remove now):** `TIMELINE_SAVES` (`js/model.js:48-49`, `js/strings.js:335, 362-363`), `.home-live-text-slots`/`.home-live-gap` (`css/viewer.css:186-188`), R2 tracker markup (`css/tracker.css:325-350`), and their tests (`tests/unit/strings.test.js:170`, `tests/unit/model.game.test.js:150`). R3 shipped 21/11 and two shell versions have replaced it since.
2. **Unused strings:** `evGoalie`, `homeHeading`, `goalPlain`, `scorerLabel`, `evDelete` (`js/strings.js`). **Unused CSS:** `.small` (`css/base.css:34`). Otherwise all 404 CSS classes are referenced.
3. **Mixed-release compatibility checks (44):** `typeof model.x`, `?.()` guards and capability flags (`competitions`, `competitionLists`, `competitionsRoute`). The root cause is unversioned module URLs + Pages `max-age=600` + a per-file network-first worker. Serving each release from an immutable path (`r/<hash>/…`), with the worker installing one complete shell, would retire most of them and the "don't deploy on game day" rule.
4. **Read volume:** a compact live summary for the viewer (R3); season-scoped history (M2); skip the recount write when the aggregate hasn't changed.
5. **Viewer rendering:** memoise derivations by input; build hidden panels when they are selected; one replay per snapshot for player counters and situations.
6. **Shared code:** quarter-score/shootout presentation exists in both the viewer and the tracker. The competition-select rendering is duplicated in `newgame.js` and `games.js`.
7. **Module size:** split the viewer's subscription lifecycle from its rendering (`js/viewer.js`, 1067 lines). Split the tracker's subscription/confirmation state from routing and banners (`js/tracker/app.js`, 769 lines).
8. **Tests:** the planner tests inject success after failure but never test re-subscription. Add terminal-error, two-tab and takeover interleavings at the subscription boundary.

## D. Single-team coupling (input to the multi-team plan)

| Area | Where | Cost |
|---|---|---|
| Branding | `js/config.js:10` (name, accent, crest); `index.html`/`track.html` titles and og tags (absolute `nemlah.github.io` URL); `manifest.webmanifest`; `img/anog-crest.png`, icons, `og.png`; `scripts/brand-assets.mjs` (hard-codes "ANOG"); accent fallbacks in `css/base.css:9-17` | Cheap per deployment. On a shared static site, link previews and the PWA name can't be per club without generated pages. |
| Data paths | `team/main` (roster, pointer, lists), `games/*`, `stats/*`, `control/tracker`, `secrets/editCode`, `editors/*` in `js/repo.js:82-86, 132-134, 185` and `firestore.rules`; the viewer's `'main'` key (`js/viewer.js:36, 1066`) | **Structural:** every read, query, batch and rule. ANOG's data needs migrating. |
| Device storage | `wp-journal` (`js/journal.js:36`), `wp-stats-dirty` (`js/tracker/statsQueue.js:7`): unqualified keys | Cheap, but required: two clubs on one phone would replay each other's taps. |
| Rules and auth | one code, one control doc, one editor set; anonymous auth only | **Structural:** per-club grants and control. Self-service needs a real sign-in for the club admin. |
| Locale and sport | `'el'` collation (`js/model.js:76, 87`), `Europe/Athens` (`js/model.js:501`), 1 August season start (`js/model.js:365-369`), `lang="el"` on names, English strings | Cheap config (locale, time zone, season start). The water-polo rules (4 quarters + SO, 3 fouls) stay. |
| Service worker | `wp-shell-v6` and a hand-kept shell list naming the ANOG crest (`sw.js:4-56`) | Cheap. Generate the list. |
| Tests | ~500 literals (`'team/main'` 224, `games/*` 187, `stats/*` 53, …) in 27 files; 24 "ANOG" literals | Mechanical but large. Route them through path helpers, and add a second club to test isolation. |
| Docs | the README assumes one club, one Firebase project, one code | Rewrite with the setup flow. |

**Firebase constraint checked 26/11:** new Cloud Storage buckets need the Blaze plan, and Spark projects lost access to existing buckets on 3/2/2026. On a free plan, crests must live in Firestore (as a data URL of a small PNG) or in the repository.
