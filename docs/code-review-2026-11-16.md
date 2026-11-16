# Repository review: performance and correctness

**Reviewed:** 16 November 2026  
**Revision:** `6870b94` — `docs: session log for viewer quarter scores`  
**Scope:** application JavaScript, Firestore repository and rules, offline persistence and recovery, service worker, HTML/CSS, development configuration, and relevant test coverage. Application code was not changed.

## Assessment

The most urgent finding is a reproducible recovery bug that can count one goal twice. The largest performance concerns are database reads: each spectator receives every game-document update, season corrections trigger duplicate full recounts, and opening tracker history downloads every game with its complete event history.

Rendering is comparatively inexpensive at ordinary game sizes in the measured desktop browser. There is avoidable work in the hidden Events panel, but it should be addressed after score correctness and database-read amplification.

The code has useful safeguards: stable live-tile DOM nodes, journal-before-write ordering, explicit ownership rules, offline persistence, and substantial automated coverage. Passing tests do not cover the failure combinations described below.

### Priorities

- **P1:** fix before relying on the affected workflow; can corrupt the displayed result.
- **P2:** meaningful correctness, reliability, or scaling issue; schedule a fix.
- **P3:** lower-impact improvement, with limits stated explicitly.

| ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| R1 | P1 | Retrying a goal and its scorer correction duplicates the goal | Reproduced with Firestore emulator |
| R2 | P2 | One correction performs two full season recounts | Reproduced with Firestore emulator |
| R3 | P2 | Viewer read volume can substantially exceed the documented capacity estimate | Code trace and documented Firestore accounting |
| R4 | P2 | Tracker history reads all games and all event arrays without a limit | Code trace |
| R5 | P2 | Multiple tabs overwrite each other's persisted recount queue | Reproduced with two queue instances |
| R6 | P2 | Terminal snapshot errors are neither surfaced nor recovered | Code trace and documented listener lifecycle |
| R7 | P2 | Cache Storage failure prevents an otherwise healthy network request | Reproduced in the service-worker harness |
| R8 | P2 | Ending a reopened game mishandles newer games on the same date | Reproduced with Firestore emulator |
| R9 | P2 | Lineup changes can silently reassign historical conceded goals | Reproduced with the production model functions |
| R10 | P3 | Hidden Events panel repeats goalkeeper replays on every live update | Browser benchmark and code trace |
| R11 | P3 | Renaming a roster player leaves season-table names stale | Code trace |

## Performance findings

### R2 — One correction performs two full season recounts

**Locations:** [recount.js](../js/tracker/recount.js#L9), lines 9–20; [statsQueue.js](../js/tracker/statsQueue.js#L43), lines 43–67; [repo.js](../js/repo.js#L205), lines 205–215.

`recountAfter()` marks a season dirty and starts draining immediately. When the write succeeds, it marks that same season again. Meanwhile, `recomputeSeason()` already waits for pending writes before reading. The second mark changes the generation of the running recount, forcing another pass even when the first pass reads the corrected data.

**Verified:** a single successful final-game correction invoked the real `recomputeSeason()` twice against the emulator. The isolated queue reproduction produced the same result.

Each pass downloads every game in the season, reads the team, aggregates all final-game events, and overwrites the stats document with a new `updatedAt`. For a season containing `G` games, this means approximately `2 × (G + 1)` document reads and two stats writes per correction, before rules-related reads. Those stats writes also produce updates for connected season listeners. Moving a game between seasons multiplies the work further.

**Recommended change:** persist the dirty marker immediately, then schedule one recount after the associated mutation settles. Keep generation tracking for genuinely newer mutations and startup recovery. Coalesce correction bursts, and avoid rewriting a stats document whose aggregate has not changed. Preserve the queued-write wait needed for offline recovery.

**Regression check:** count real recount invocations for one correction, a burst of corrections, an offline correction followed by reload, and a mutation made during an existing recount. Assert eventual correctness without an obligatory second scan for an isolated mutation.

### R3 — Viewer read volume can exceed the documented capacity estimate

**Locations:** [repo.js](../js/repo.js#L140), lines 140–157; [viewer.js](../js/viewer.js#L153), lines 153–159; [README.md](../README.md#L59), lines 59–63.

Every goal, exclusion, save, penalty save, goalkeeper switch, situation event, and period change updates the same game document. Every spectator following that game listens to this document. A spectator viewing a past game can also retain a current-game listener for the live banner.

Consequently, the read budget depends on **all observed game-document updates**, not just goals. Firestore counts listener document updates as reads; the documented free allowance is 50,000 reads per day. See [listener read accounting](https://firebase.google.com/docs/firestore/pricing#listening_to_query_results) and [Firestore quotas](https://firebase.google.com/docs/firestore/quotas#free_quota).

For illustration, ignoring startup reads, reconnections, stats updates, and tracker activity:

| Updates received per spectator per game | Approximate viewer-games consuming 50,000 reads |
| ---: | ---: |
| 50 | 1,000 |
| 120 | 416 |
| 200 | 250 |

At 120 updates per game, 300 spectators watching three complete games produce approximately **108,000 game-listener reads** alone. This is a workload example, not a measurement of production traffic. The README's approximately 1,000 viewer-games estimate needs an explicit event-rate assumption, particularly after the addition of saves and situation tracking.

The game snapshot also contains the entire accumulated event array, so payload size grows during play. Splitting events into documents alone would not eliminate per-event spectator reads.

**Recommended change:** measure actual updates per match and revise the capacity estimate. Remove redundant stats writes first. If the intended audience exceeds the measured budget, consider a separate spectator summary with an explicit refresh/coalescing policy and load detailed history only when needed. Evaluate the real-time behavior and backend choice against that audience requirement before restructuring storage.

### R4 — Tracker history downloads every game and event array

**Locations:** [repo.js](../js/repo.js#L101), lines 101–103; [games.js](../js/tracker/views/games.js#L43), lines 43–61 and 222–229.

`listGames()` has neither a season filter nor a limit/cursor. Every entry into the history list issues that query, materializes all game documents, derives every score from its event array, and creates every row. Returning from a detail page reloads the list.

Network reads grow with the lifetime game count, while payload and score calculation grow with all historical events. A list of 1,000 games therefore requests up to 1,000 full documents just to show the first screen. This is an architectural scaling issue; the current repository provides no production dataset with which to measure its present impact.

**Recommended change:** use a bounded page, such as 25–50 entries, with cursor pagination and a deterministic tie-breaker. Retain the loaded page when returning from details. Store or separately maintain compact result summaries so browsing history does not require every event array.

**Regression check:** seed several pages, including multiple games on the same date, and verify bounded query results, stable pagination, and no missing or duplicate rows.

### R10 — The hidden Events panel repeatedly replays goalkeeper history

**Locations:** [live.js](../js/tracker/views/live.js#L331), lines 331–339; [events.js](../js/tracker/views/events.js#L274), lines 274–276, 339–352 and 387–389; [goalies.js](../js/goalies.js#L13), lines 13–50 and 64–66.

`createEventsSheet.update()` updates the entire Events panel while its overlay is closed. For each opponent-goal row, `syncInGoal()` calls `inGoalAt()`. Each call sorts the full event array again and replays it up to that goal. With `E` events and `O` opponent goals, this repeats roughly `O × E log E` sorting work rather than deriving the goalkeeper-at-event mapping once.

Metadata-only snapshots and write-settlement renders also take this path. The hidden controls are built and retained even when the scorekeeper never opens Events.

**Measured:** headless Chromium, 13 players, one goalie, one opponent goal per five events, 30 timed unchanged updates after warm-up:

| Events | Hidden event rows | Median update | p95 update |
| ---: | ---: | ---: | ---: |
| 100 | 100 | 0.2 ms | 0.4 ms |
| 250 | 250 | 0.5 ms | 0.6 ms |
| 500 | 500 | 1.2 ms | 1.3 ms |
| 1,000 | 1,000 | 3.9 ms | 4.2 ms |

These are desktop JavaScript/DOM-update timings with mocked state, without application CSS, full application orchestration, mobile CPU throttling, or paint measurements. The larger cases are stress cases. They demonstrate avoidable growth, **not** evidence of current mobile jank at normal game sizes; hence P3.

**Recommended change:** retain the newest game/state while the panel is closed and render it when opened. When visible, derive goalkeeper attribution for all events in one replay, and skip unchanged event/lineup inputs on metadata-only updates.

## Correctness and reliability findings

### R1 — Retrying an added goal and its correction counts it twice

**Locations:** [journal.js](../js/journal.js#L71), lines 71–80; [taps.js](../js/tracker/taps.js#L92), lines 92–112; [repo.js](../js/repo.js#L140), lines 140–153.

Recording a replacement supersedes previous replacements but retains a pending/failed add for the same event. Recovery resolves every operation against the same original server snapshot. If that snapshot has no event, it sends the original add and then sends the replacement as another add.

Firestore's array union treats the two event objects as different because their `playerId` fields differ, even though their `id` fields are identical.

**Reproduction:**

1. Record a goal for player A while offline.
2. Change its scorer to B before reconnecting.
3. Have both writes refused, for example after another device takes over.
4. Regain control and retry the game's failed taps.

The emulator stored both objects:

```json
[
  { "id": "goal1", "type": "goal", "period": 1, "ts": 1000, "playerId": "a" },
  { "id": "goal1", "type": "goal", "period": 1, "ts": 1000, "playerId": "b" }
]
```

`deriveScore()` reports **2–0 for one actual goal**. The correction can remain failed because reconciliation finds the first version. Discarding that remaining failure can leave the incorrect score in place. UI row maps keyed by event ID can also show fewer rows than the score counts.

**Recommended change:** reduce a game's recovery operations to one intended final state per event ID, or update a local working event map after each replayed operation so a correction replaces the replayed add. Handle an existing server event with the same ID explicitly. Do not assume array union deduplicates by ID. Existing duplicate IDs need detection and repair as well.

**Regression check:** fail an add plus one or more scorer/goalkeeper replacements, retry once, and assert one event with the final intended attribution, the correct score, and an empty failure journal. Repeat retry to verify idempotence.

### R5 — Multiple tabs lose persisted season-recount markers

**Locations:** [statsQueue.js](../js/tracker/statsQueue.js#L7), lines 7–25, 34–46 and 65–67; [firebase.js](../js/firebase.js#L16), persistent multiple-tab configuration.

Each queue reads storage once at construction and later overwrites the complete stored list from its own in-memory copy. Two tabs therefore overwrite one another even without simultaneous writes.

**Verified sequence:** construct queues A and B on the same empty storage; A marks `2025-26`; B marks `2026-27`. The persisted value is only `["2026-27"]`, while A still believes its own marker is saved. A successful drain in a stale tab can likewise erase another tab's marker.

After closure/reload, a lost marker for a non-current season is not necessarily reconstructed: startup repair only explicitly marks the current game's season. An offline correction to an older season can consequently leave permanent stale totals until another action happens to recount it.

**Recommended change:** use a cross-tab-safe queue with persistent per-season generations and transactional updates, or elect one queue owner and synchronize mutations. Simply merging before a write improves sequential behavior but does not make concurrent localStorage read/modify/write operations atomic.

**Regression check:** interleave two instances marking and draining different and identical seasons, including marking while the other recount is running; reconstruct both instances and assert that no unprocessed generation disappears.

### R6 — Terminal listener failures can leave a frozen or loading screen

**Locations:** [repo.js](../js/repo.js#L51), lines 51–56; [viewer.js](../js/viewer.js#L80), lines 80–107; [app.js](../js/tracker/app.js#L493), lines 493–506.

The shared `watch()` helper supplies no error callback to `onSnapshot()`. The viewer catches synchronous subscription setup errors, but a later asynchronous listener error does not reach that `try/catch`.

For a terminal permission/query failure, the application receives neither an explicit error state nor a request to resubscribe. A previously displayed score can remain frozen, or a first load can remain unresolved. Existing subscription keys can continue to indicate that a listener exists even after it has terminated. Firebase documents that a listener receives no further events after an error: [handling listen errors](https://firebase.google.com/docs/firestore/query-data/listen#handle_listen_errors).

**Recommended change:** propagate listener errors through the repository API, mark the affected view unavailable/stale, and provide a controlled retry or reload path. Handle terminal permission errors separately from transient transport reconnection, which the SDK already manages.

**Regression check:** inject an asynchronous listener error after a confirmed snapshot and before the first snapshot; verify visible feedback and recovery without silently retaining an apparently healthy subscription.

### R7 — A Cache Storage error blocks the network fallback

**Location:** [sw.js](../sw.js#L112), lines 112–140; compare the defensive cache handling at lines 150–159.

`networkFirst()` awaits `caches.open()` before starting `fetch()` and outside its `try/catch`. If opening Cache Storage rejects, all intercepted same-origin requests reject even when the network is healthy. A failing `cache.match()` can also prevent the intended fallback. The cross-origin `cacheFirst()` path already handles cache-open failures defensively.

**Verified:** injected a cache-open rejection while providing a working network response. The request rejected with `cache unavailable`; the network fetch count was **zero**.

**Recommended change:** treat opening, reading, and writing the cache as optional operations. Start or fall back to the network when cache access fails, and avoid retrying the same failed cache access in the error branch.

**Regression check:** separately reject cache open, match, and put operations for same-origin requests; a healthy network response should still be returned.

### R8 — Same-day games break restoration of the newest game

**Locations:** [repo.js](../js/repo.js#L65), lines 65–72, 173–179 and 197–200; [model.js](../js/model.js#L282), season-result ordering.

The lookup orders only by `date`, and `newerGameId()` requires a strictly greater date. Two games on the same day cannot be distinguished chronologically, even though new games already carry `createdAt`.

**Verified:** create and finish A, then B on the same date; reopen and finish A. `team.currentGameId` remains A instead of returning to B. Date-only ordering also affects history/result ordering and replacement selection when deleting a current game.

**Recommended change:** define a stable chronological order, for example match date plus creation time and document ID as a final tie-breaker. Apply it consistently to newest-game selection and lists, with a fallback for legacy documents. Alternatively, preserve the previously current game when temporarily reopening history.

**Regression check:** create multiple games on one date and verify reopen/end, delete, results ordering, and pagination; include legacy records without `createdAt`.

### R9 — Mutable lineup data changes historical goals against

**Locations:** [goalies.js](../js/goalies.js#L13), lines 13–16 and 29–43; [lineup.js](../js/tracker/views/lineup.js#L115), line 115 and lines 163–170; [model.js](../js/model.js#L145), `playerHasEvents()`.

Goalkeeper replay starts with whichever current lineup goalie has the lowest cap. That is mutable metadata, rather than a recorded historical starting assignment. Changing goalie cap numbers can therefore reassign goals conceded before the first explicit save/switch.

The removal guard checks only `event.playerId`. Opponent goals have no such field, so a starting goalie who has conceded but has no personal events is removable.

**Verified:** with goalies A (#1) and B (#13), one opponent goal is attributed to A. `playerHasEvents(events, A)` returns false, allowing removal. Replaying after removal attributes the same historical goal to B. Removing the sole goalie instead hides goalkeeper statistics entirely.

**Recommended change:** record the initial goalkeeper explicitly at game creation, with a legacy fallback. Preserve that historical identity through cap edits, and prevent removal of players referenced by derived goalkeeper attribution unless the user explicitly corrects those assignments.

**Regression check:** concede before any save/switch, then swap caps, remove a goalie, and edit the lineup in a final game. Historical attribution must remain stable unless explicitly corrected.

### R11 — Roster renames do not invalidate displayed season names

**Locations:** [roster.js](../js/tracker/views/roster.js#L34), lines 34–47 and 146–155; [repo.js](../js/repo.js#L115), lines 115–116; [model.js](../js/model.js#L238), `aggregateSeason()`; [viewer.js](../js/viewer.js#L506), season rendering.

Season aggregation copies current roster names into the stats document. Saving a roster rename only updates `team/main`; it neither updates stats nor marks any season dirty. The viewer renders the names already stored in stats, so a corrected roster name remains stale in season tables until some unrelated action recounts that season.

**Recommended change:** resolve season-table display names by player ID against the already-loaded roster, retaining the stats name as a fallback. This avoids scanning entire seasons for a display-name change. Alternatively, explicitly invalidate the affected stats documents.

**Regression check:** finish a game, rename a participating player, and verify that an already-open viewer updates the season-table name without ending or editing another game.

## Additional design risks and test gaps

- **Mixed releases remain a documented availability risk.** [sw.js](../sw.js#L4) uses one fixed cache name and refreshes same-origin resources individually. New installs and runtime requests can mix independently fetched modules; [README.md](../README.md#L49) already warns about the resulting blank page. Versioned immutable assets with a release-specific shell would address the underlying issue. This is an existing acknowledged constraint, not a newly reproduced incident.
- **Large arrays/documents impose eventual limits.** Games embed all events, and stats embed all results and player totals for a season. Firestore's document-size limit is 1 MiB; no application size guard exists. Normal single-club games are unlikely to approach it immediately, so this is a capacity boundary rather than a demonstrated present failure. See [document limits](https://firebase.google.com/docs/firestore/quotas#collections_documents_and_fields).
- **Older-season repair is local to a device.** Dirty seasons are persisted locally; takeover repairs the current season. A device that disappears after a historical mutation but before recount completion can leave that older season stale. A durable shared dirty marker or explicit administrative rebuild path would make this recoverable across devices.
- **Offline WebKit behavior is not covered by the automated offline suite.** [offline.spec.js](../tests/e2e/offline.spec.js#L14) skips that suite outside Chromium. Other WebKit tests run, but they do not substitute for real iPhone Safari offline/reconnect and storage-lifecycle checks.
- **Rules enforce ownership but trust active-editor payloads.** They do not validate game/team/stat schemas or unique event IDs. This does not allow anonymous public writes; the ownership tests pass. It does mean client bugs can persist malformed data that render/model functions generally assume is well-formed.

## Validation

| Check | Result |
| --- | --- |
| `npm test` | **192 passed**, 0 failed |
| `npm run test:emu` | **28 passed**, 0 failed |
| `npm run test:e2e` | **361 passed**, 0 failed, **13 skipped**; Chromium and WebKit, 6.6 minutes |
| Targeted Firestore reproductions | Confirmed duplicate-ID goals on retry, same-day pointer failure, and two recounts for one correction |
| Targeted pure-function/worker reproductions | Confirmed cross-tab marker loss, goalkeeper reassignment, and cache-open failure blocking fetch |
| Isolated Chromium render benchmark | Completed; measurements and limitations in R10 |

Tests used Node.js `v26.13.0`, JDK 21, and the repository's installed dependencies. The 13 skips were 12 WebKit offline cases and one WebKit stalled-unlock case. Emulator tests ran against demo projects; production Firebase data was not accessed or changed. Reproduction harnesses were temporary files outside the repository. No production traffic profiling or physical-device benchmark was performed.

## Suggested implementation order

1. Fix and regression-test recovery deduplication (R1).
2. Remove duplicate recounts and preserve cross-tab dirty generations (R2, R5).
3. Address listener/cache failures and historical attribution/order (R6–R9).
4. Measure the spectator read budget and bound history queries (R3, R4).
5. Defer hidden-panel rendering and resolve season names from the roster (R10, R11).

The first performance work should reduce avoidable database operations. The measured rendering cost does not justify a framework rewrite or a broad UI redesign.
