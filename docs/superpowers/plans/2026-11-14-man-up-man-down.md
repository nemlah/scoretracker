# Man-up, man-down and penalty fouls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track man-ups and man-downs as derived situations, add a PEN (penalty foul) button, and show this game's and the season's man-up/man-down figures on the tracker and viewer.

**Architecture:** Four new event types join the existing `events` array, so journal, offline, Undo and the Events sheet keep working unchanged. A new pure module `js/situations.js` replays a game's events into open/closed situations; everything shown (tint, counter, figures, timeline tags, season totals) is derived from that replay. Games carry `situations: true` from creation; games without it are "not tracked".

**Tech Stack:** Plain HTML/CSS/JS ES modules (no build), Firestore Web SDK 12.19.0, `node --test` unit tests, Playwright e2e against the Firestore/Auth emulators.

**Spec:** `docs/superpowers/specs/2026-11-14-man-up-man-down-design.md` (extends `docs/superpowers/specs/2026-11-13-waterpolo-scoretracker-design.md`). Read the spec's "Deriving situations" table before Task 1.

## Global Constraints

- No build step. Every new JS file is added to `SHELL` in `sw.js` (`tests/unit/sw-shell.test.js` enforces it).
- Every visible string lives in `js/strings.js`; copy below is exact.
- Event objects keep exactly the shape `{ id, type, period, ts, playerId? }` (no extra fields): `arrayRemove` matches whole objects.
- Event types: `'goal' | 'excl' | 'oppGoal' | 'pen' | 'manUp' | 'manUpEnd' | 'manDownEnd'`.
- A game is tracked iff `game.situations === true`. Untracked games never produce man-up/man-down figures.
- Situations exist only in periods 1–4, never in `'SO'`.
- Foul limit: OUT when `excl + pens >= EXCL_LIMIT` (3).
- Tap targets: PEN at least as large as EXCL (≥ 48 px). The situation button refuses taps for 1000 ms after a tap.
- Reminder: the open-situation counter pulses from 40 000 ms after the opening event's `ts`.
- Dates DD/MM/YYYY, Europe/Athens (unchanged).
- Commands: unit `npm test`; emulator `npm run test:emu`; e2e `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:e2e` (filter with `-- tests/e2e/<file>`).
- Deploy only when no game is live.

## Review Focus

1. **Leaving the Live screen with a situation open** (Home, End game, takeover banner): the page tint must go away; nothing outside Live is tinted. → Task 4 test `tint is removed when leaving the live screen`.
2. **Reload or a second phone mid man-up**: the open state and its seconds come back from the events, counted from the original `ts`. → Task 4 test `a seeded open man-up shows after load with its seconds and pulses after 40 s`.
3. **Reopening a final game whose last situation was open at the end**: while final it counts as missed/stopped; once live again in the same period it shows open again (state as it was). → Task 1 test `final game closes an open situation; reopened live game shows it open again`.
4. **Data written before this change**: a stored journal holding old and new event types must still load; an old `stats/{season}` doc without `pens`/`situations` must still render. → Task 1 journal test, Task 6 test `an old stats document without the new fields still renders`.
5. **Advancing into the shootout with a situation open**: it closes, the tint goes, and the situation button disappears. → Task 4 test `moving to the shootout closes an open man-up and hides the button`.

---

### Task 1: Situation replay, penalty fouls in player lines, journal types

**Files:**
- Create: `js/situations.js`, `tests/unit/situations.test.js`
- Modify: `js/model.js` (typedef, `EVENT_TYPES`, `playerLines`, `scoringLines`, `timeline`), `js/journal.js:18` (type list), `sw.js` (`SHELL`)
- Test: `tests/unit/model.game.test.js`, `tests/unit/journal.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces (`js/situations.js`, imports nothing from `model.js` to avoid an import cycle):
  - `SITUATION_TYPES: readonly ['manUp','manUpEnd','manDownEnd']`
  - `SITUATION_REMIND_MS = 40000`
  - `isTracked(game) → boolean` (`game?.situations === true`)
  - `replaySituations(game) → { closed: Closed[], open: Open | null }`
    - `Open = { kind: 'manUp'|'manDown', startId: string, startTs: number, period: 1|2|3|4 }`
    - `Closed = Open & { outcome: 'scored'|'missed'|'stopped'|'conceded', closedBy: string|null }`. `closedBy` is the id of the event that closed it, or `null` when a period change or the end of the game closed it.
    - An untracked game returns `{ closed: [], open: null }`.
  - `situationCounts(game) → { manUp: { played, scored }, manDown: { played, stopped } } | null`. Returns `null` when the game is untracked, and counts closed situations only.
  - `manUpGoalIds(game) → Set<string>` holds the ids of goals that closed a man-up as `scored`.
  - `manUpSwitch(game, goalId, on, id = crypto.randomUUID()) → { op: 'add'|'remove', event } | null`
- Produces (`js/model.js`):
  - `EVENT_TYPES` (frozen, the 7 types in Global Constraints)
  - `playerLines` lines gain `pens: number`, and `out` becomes `excl + pens >= EXCL_LIMIT`
  - `scoringLines` keeps lines with `goals + soGoals + excl + pens > 0`
  - `timeline(events)` leaves out `SITUATION_TYPES` events

Replay order (the spec's table gives what each event does):

```
sort events by ts, ties by array index; skip period 'SO'
for each event:
  if open and event.period !== open.period: close open (manUp→missed, manDown→stopped, closedBy null)
  apply the spec table row for event.type to the open state
after the loop: if open and (game.status === 'final' or game.period !== open.period):
  close it the same way (closedBy null)
```

`manUpSwitch` rules (spec, "Man-up goal switch"). It returns `null` when the game is untracked, the goal is missing or in `'SO'`, or the switch is already in the requested state.
- `on`: if a `manUpEnd` with `ts === goal.ts - 1` exists, return `{ op:'remove', event: thatEnd }`. Otherwise return `{ op:'add', event: { id, type:'manUp', period: goal.period, ts: goal.ts - 1 } }`.
- `off`: take the closed man-up with `closedBy === goalId`. If its `startTs === goal.ts - 1`, return `{ op:'remove', event: <its start event> }`. Otherwise return `{ op:'add', event: { id, type:'manUpEnd', period: goal.period, ts: goal.ts - 1 } }`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/situations.test.js`. Use the `ev(type, period, playerId, ts)` helper style from `model.game.test.js`, and a game helper `g(events, extra = {}) = { situations: true, status: 'live', period: 4, events, ...extra }`. Assert on `situationCounts`, `replaySituations(...).open`, and `closed.map(s => [s.kind, s.outcome, s.closedBy])`:
  - `untracked game has no situations`: `situations` missing → `replaySituations` gives `{ closed: [], open: null }` and `situationCounts` gives `null`, even when it has `excl` events.
  - `man-up: our goal scores it`: `[manUp@1, goal@2]` → `[['manUp','scored','e2']]`, counts `manUp {played:1, scored:1}`. Unknown scorer (`playerId` null) also scores.
  - `man-up: end tap or opponent goal misses it`: `[manUp, manUpEnd]` and `[manUp, oppGoal]` → each `'missed'`.
  - `our exclusion during a man-up misses it and opens a man-down`: `[manUp@1, excl@2]` → closed `[['manUp','missed','e2']]`, open `{ kind:'manDown', startId:'e2', ... }`.
  - `man-down: opponent goal concedes; our goal or the end tap stops it`
  - `a second exclusion keeps the same man-down`: `[excl@1, excl@2, oppGoal@3]` → one closed `['manDown','conceded','e3']`.
  - `man-up tap during a man-down stops it and opens a man-up`
  - `penalty foul changes nothing`: `[manUp@1, pen@2, goal@3]` → `scored`. `[pen@1]` → nothing open.
  - `period change closes: next event in another period`: `[manUp Q1@1, goal Q2@2]` → `[['manUp','missed',null]]`, and the goal closes nothing.
  - `final game closes an open situation; reopened live game shows it open again`: `[manUp Q4]` with `status:'final'` → missed. With `status:'live', period:4` → `open.kind === 'manUp'`. With `status:'live', period:'SO'` → missed.
  - `orphan ends are ignored`: `[manUpEnd@1, manDownEnd@2]` → nothing closed, nothing open.
  - `shootout events take no part`: `[excl SO@1]` → nothing open.
  - `ties in ts keep array order`: `[manUp@5 id a, goal@5 id b]` → scored. Reversed in the array → the goal closes nothing and the man-up stays open.
  - `counts count closed situations only`: an open man-up isn't counted in `played`.
  - `manUpGoalIds lists only goals that scored a man-up`
  - `manUpSwitch on adds a man-up start just before the goal`: returns `{ op:'add', event:{ id:'x', type:'manUp', period:2, ts:99 } }` for a goal at ts 100 in Q2, called with id `'x'`.
  - `manUpSwitch off removes a switch-made start`: game `[manUp@99, goal@100]` → `{ op:'remove', event:<the manUp@99 object> }`.
  - `manUpSwitch off on a live-tapped man-up adds an end`: `[manUp@50, goal@100]` → `{ op:'add', event:{ type:'manUpEnd', ts:99, ... } }`, and after applying it the counts are `manUp {played:1, scored:0}`.
  - `manUpSwitch on after an off removes the added end`: `[manUp@50, manUpEnd@99, goal@100]`, `on` → `{ op:'remove', event:<manUpEnd@99> }`.
  - `manUpSwitch returns null when nothing should change`: untracked game, SO goal, unknown goal id, `on` when it's already a man-up goal, `off` when it isn't.
  
  In `tests/unit/model.game.test.js`:
  - Update the existing `playerLines` expectation with `pens:0` on each line.
  - Add `playerLines counts penalty fouls toward OUT`: 2 `excl` + 1 `pen` → `{ excl:2, pens:1, out:true }`.
  - Add `scoringLines keeps a player with only a penalty foul`.
  - Add `timeline leaves out man-up and man-down events`: the input mixes `manUp`, `manUpEnd`, `manDownEnd`, `goal`, `pen`, and only `goal` and `pen` remain.

  In `tests/unit/journal.test.js`, add `entries of every event type load; an unknown type still empties the journal`. Persist one entry per `EVENT_TYPES` type, reload, and expect them all. Then persist one with type `'shot'`, reload, and expect an empty journal (current behaviour).

- [ ] **Step 2: Run them to make sure they fail.** Run `npm test`. Expected: the new tests FAIL (`situations.js` is missing and `pens` is undefined). The other tests pass.

- [ ] **Step 3: Implement it.** Write `js/situations.js` with the interfaces above. In `js/model.js`, import `SITUATION_TYPES` and `isTracked` and add `EVENT_TYPES`; update `playerLines`, `scoringLines` and `timeline` and the `Event` typedef. In `js/journal.js`, import `EVENT_TYPES` from `./model.js` and use it in place of the literal list. In `sw.js`, add `'./js/situations.js'` to `SHELL`, after `./js/repo.js`.

- [ ] **Step 4: Run the tests and make sure they pass.** Run `npm test`. Expected: every test passes, including `sw-shell.test.js`.

- [ ] **Step 5: Commit.** Run `git add js/situations.js js/model.js js/journal.js sw.js tests/unit && git commit -m "feat(model): derive man-up and man-down situations; penalty fouls count toward the foul limit"`.

---

### Task 2: Season figures and the tracked marker

**Files:**
- Modify: `js/model.js` (`gameResult`, `aggregateSeason`), `js/repo.js:118-136` (`createGame`)
- Test: `tests/unit/model.season.test.js`, `tests/emulator/repo.test.js:57`

**Interfaces:**
- Consumes: `isTracked` and `situationCounts` from Task 1.
- Produces:
  - `gameResult(game)` also returns `manUp: { played, scored }` and `manDown: { played, stopped }`, but only when `isTracked(game)`. For an untracked game both keys are absent.
  - `aggregateSeason(games, roster) → { players, results, situations }`:
    - each entry in `players` gains `pens`;
    - `situations` is `{ manUp: { played, scored }, manDown: { played, stopped } }`, summed over tracked final games, or `null` when there are none.
  - `repo.createGame(...)` writes `situations: true` on the new game.

- [ ] **Step 1: Write the failing tests.**
  - In `model.season.test.js`, extend the `aggregateSeason` expectation so every player carries `pens` (`b` has a `pen` added → `pens:1`).
  - Add `gameResult adds man-up and man-down figures only for tracked games`. The tracked game `[manUp@1, goal@2, excl@3, oppGoal@4]` gives `manUp {played:1, scored:1}, manDown {played:1, stopped:0}`. The same game without `situations` has no `manUp` or `manDown` keys.
  - Add `aggregateSeason sums situations over tracked final games only`. The input is one untracked final game with `excl` events, two tracked final games and one tracked live game. Expect the sum of the two tracked finals. With only the untracked final, `situations === null`.
  - In `repo.test.js`, the `createGame writes a live game…` test also asserts `game.situations === true`.
- [ ] **Step 2: Run them to make sure they fail.** Run `npm test`, then `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:emu`. Expected: the new assertions FAIL.
- [ ] **Step 3: Implement** the produced interfaces in `js/model.js` and `js/repo.js`.
- [ ] **Step 4: Run the tests and make sure they pass.** Run both commands again. Expected: everything passes.
- [ ] **Step 5: Commit.** Run `git commit -am "feat(stats): season man-up/man-down figures from tracked games; new games are tracked"`.

---

### Task 3: Tapper rules, labels and figure text

**Files:**
- Modify: `js/tracker/taps.js` (`tap`), `js/strings.js`
- Test: `tests/unit/taps.test.js`, `tests/unit/strings.test.js`

**Interfaces:**
- Consumes: `replaySituations` and `isTracked` from Task 1.
- Produces:
  - `tapper.tap('pen', playerId)` behaves like `'excl'`: it is refused (returns `null`, nothing journaled or written) when the player isn't in the lineup or is OUT.
  - `tapper.tap('manUp'|'manUpEnd'|'manDownEnd')` forces `playerId` to null. It is refused unless all of these hold: `isTracked(game)`, `game.period !== 'SO'`, and the replay's open state matches: `manUp` needs `open === null`, `manUpEnd` needs `open?.kind === 'manUp'`, and `manDownEnd` needs `open?.kind === 'manDown'`.
  - `eventLabel(event, lineup)` names the new types (copy below).
  - `timelineEntry` handles `'pen'` with `side:'us'`, icon `tlPenIcon`, sr `tlPenSr`, and the player text.
  - `manUpText(counts | null)`, `manDownText(counts | null)`, `situationShort({ manUp, manDown } | null)` (all return strings).
- New strings (exact):

```
penButton: 'Pen', penFor: 'Penalty foul for {name}', penNamed: 'Penalty foul · #{cap} {name}',
tileFoulsAria: 'Exclusions: {excl}, penalty fouls: {pens}',
manUpButton: 'Man-up', manUpEndButton: 'End man-up · no goal', manDownEndButton: 'End man-down · stopped',
situationSeconds: '{s} s',
manUpEvent: 'Man-up', manUpEndEvent: 'End man-up · no goal', manDownEndEvent: 'End man-down · stopped',
manUpFigure: 'Man-up {scored}/{played}', manDownFigure: 'Man-down {stopped}/{played} stopped',
figurePercent: '{text} · {pct}%', manUpNone: 'Man-up —', manDownNone: 'Man-down —',
situationShort: 'MU {scored}/{muPlayed} · MD {stopped}/{mdPlayed}', notTracked: '—',
situationManUp: 'Man-up', situationManDown: 'Man-down',
tlPenIcon: '🟧', tlPenSr: 'Penalty foul', tlManUpTag: 'man-up',
colPen: 'Pen.', evManUpGoal: 'Man-up goal', evManUpGoalFor: 'Man-up goal: {label}',
```

  The figure text has no percentage when `played === 0`. Otherwise the percentage is `Math.round(100 * n / played)`.

- [ ] **Step 1: Write the failing tests.**
  - In `taps.test.js`:
    - `pen is journaled and written like an exclusion; refused for an OUT player`
    - `situation taps are refused on an untracked game and in the shootout`
    - `manUp is refused while a man-up or man-down is open; manUpEnd only while a man-up is open; manDownEnd only while a man-down is open`. Seed `state.game.events` and `situations: true`, then assert both the return value and `names(calls)`.
  - In `strings.test.js`:
    - `eventLabel names penalty fouls and situation events`: `'Penalty foul · #2 Papadakis'`, `'Man-up'`, `'End man-up · no goal'`, `'End man-down · stopped'`.
    - `figure text`: `manUpText({played:7, scored:3}) === 'Man-up 3/7 · 43%'`, `manUpText({played:0, scored:0}) === 'Man-up 0/0'`, `manUpText(null) === 'Man-up —'`, `manDownText({played:6, stopped:4}) === 'Man-down 4/6 stopped · 67%'`, `situationShort({manUp:{played:7,scored:3}, manDown:{played:6,stopped:4}}) === 'MU 3/7 · MD 4/6'`, `situationShort(null) === '—'`.
    - `timelineEntry for a penalty foul`.
- [ ] **Step 2: Run them to make sure they fail.** Run `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** in `js/tracker/taps.js` and `js/strings.js`.
- [ ] **Step 4: Run the tests and make sure they pass.** Run `npm test`. Expected: everything passes.
- [ ] **Step 5: Commit.** Run `git commit -am "feat(tracker): tap rules for penalty fouls and situations; labels and figure text"`.

---

### Task 4: Live screen — PEN, situation button, counter, tint, header figures

**Files:**
- Modify: `js/tracker/views/live.js`, `css/tracker.css`
- Create: `tests/e2e/tracker-situations.spec.js` (setup copied from `tracker-live.spec.js`)
- Test: `tests/e2e/tracker-live.spec.js` (keep the existing `tile-excl-count` assertions passing)

**Interfaces:**
- Consumes: `replaySituations`, `situationCounts`, `isTracked`, `SITUATION_REMIND_MS` (Task 1); the `tap` rules (Task 3); `situationShort` and the button strings (Task 3).
- Produces (test ids the e2e uses):
  - Tile: `tile-pen` button with `aria-label` from `penFor`. Pips show `excl` pips with `is-on`, then `pens` pips with `is-on is-pen` and the text "P". `tile-excl-count` keeps its sr text as the exclusion count, and its `aria-label` uses `tileFoulsAria`.
  - Dock: `situation` button with `data-state="none"|"manUp"|"manDown"`. Its label is `manUpButton`, `manUpEndButton` or `manDownEndButton`. Inside it is `situation-seconds` (`situationSeconds`, whole seconds since `open.startTs`, never negative), refreshed every 1 s while a situation is open. The button gets class `is-late` once `Date.now() - open.startTs >= SITUATION_REMIND_MS`. It is hidden when the game is untracked or the period is `'SO'`, and disabled when not writable. After a tap it refuses taps for 1000 ms (same pattern as `onUndo`).
  - The button maps state to tap: `none` → `tap('manUp')`, `manUp` → `tap('manUpEnd')`, `manDown` → `tap('manDownEnd')`.
  - Header: `live-situations` shows `situationShort(situationCounts(game))`. It is hidden for untracked games.
  - Tint: `document.body` gets class `sit-up` or `sit-down` while a situation is open, and neither otherwise. It is removed in `unmount()` and whenever the game isn't live.
- CSS: pick the colours. The tint must be obvious in peripheral vision: man-up green, man-down red, clearly different from each other and from `--pool`. Any text drawn straight on the tinted background keeps at least 4.5:1 contrast. Tiles and buttons keep their current colours. The pulse is an animation on `.situation.is-late`, and it respects `prefers-reduced-motion` by using a static outline instead. The tile action row becomes three columns (GOAL widest). The situation button sits beside `+1 opponent goal` in the dock.

- [ ] **Step 1: Write the failing e2e tests** in `tests/e2e/tracker-situations.spec.js`. Each one starts a game through the UI (`startGame` as in `tracker-live.spec.js`) unless it says it is seeded. Read events with `get('games/<id>')`.
  - `PEN counts toward the foul limit and does not open a man-down`: PEN on cap 2 → one `is-pen` pip, `situation` has `data-state="none"`, and the body has no `sit-down`. Then EXCL twice → the tile shows OUT and PEN is disabled. The doc has 1 `pen` and 2 `excl`.
  - `man-up opens, tints the page, and our goal closes it as scored`: tap `situation` → `data-state="manUp"`, body has `sit-up`, and the label contains `End man-up · no goal`. Then GOAL on cap 5 → `data-state="none"`, no `sit-up`, and `live-situations` reads `MU 1/1 · MD 0/0`.
  - `ending a man-up counts it as missed; a double tap does not end it`: tap `situation` twice within 300 ms → exactly one `manUp` event and `data-state="manUp"`. Then wait 1100 ms and tap → `MU 0/1 · MD 0/0`.
  - `EXCL opens a man-down; an opponent goal concedes it`: EXCL on cap 2 → `data-state="manDown"` and body `sit-down`. Then `opp-goal` → `MU 0/0 · MD 0/1`.
  - `the period button closes an open man-up as missed`
  - `Undo of the goal reopens the man-up`
  - `tint is removed when leaving the live screen`: open a man-up, then go Home → no `sit-up` on the body. Resume → `sit-up` is back.
  - `moving to the shootout closes an open man-up and hides the button`: advance to SO while a man-up is open → `situation` is hidden, there's no `sit-up`, and the figures read `MU 0/1`.
  - `a seeded open man-up shows after load with its seconds and pulses after 40 s`: seed a tracked live game whose events are `[{ id:'m', type:'manUp', period:1, ts: Date.now() - 41000 }]` and point `team/main.currentGameId` at it. Load `#/live` → `data-state="manUp"`, `situation-seconds` matches `/^(4[1-9]|[5-9]\d) s$/`, and the button has class `is-late`.
  - `untracked game: no situation button, PEN still works`: seed a live game without `situations` → `situation` and `live-situations` are hidden, and PEN records a `pen`.
- [ ] **Step 2: Run them to make sure they fail.** Run `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:e2e -- tests/e2e/tracker-situations.spec.js`. Expected: they FAIL (`tile-pen` and `situation` aren't there yet).
- [ ] **Step 3: Implement** in `js/tracker/views/live.js` and `css/tracker.css`. Tiles and the dock stay updated in place (the existing rule: never rebuild a button a finger may be on). The 1 s interval is cleared in `unmount()`.
- [ ] **Step 4: Run the tests and make sure they pass.** Run the full e2e suite. Expected: all pass, including `tracker-live.spec.js`, `tracker-events.spec.js` and `offline.spec.js`.
- [ ] **Step 5: Commit.** Run `git add tests/e2e/tracker-situations.spec.js && git commit -am "feat(live): PEN button, man-up/man-down button with counter, page tint and figures"`.

---

### Task 5: Events sheet — labels and the Man-up goal switch

**Files:**
- Modify: `js/tracker/views/events.js` (`buildRow`, `syncRow`, `update`), `css/tracker.css` (switch styling only)
- Test: `tests/e2e/tracker-events.spec.js`

**Interfaces:**
- Consumes: `manUpGoalIds`, `manUpSwitch`, `isTracked` (Task 1); `eventLabel`, `evManUpGoal`, `evManUpGoalFor` (Task 3); the existing `send(target, start)` and `ctx.journal.record`.
- Produces: goal rows get a checkbox `ev-manup` inside a label `evManUpGoal`, with `aria-label` from `evManUpGoalFor`.
  - It is shown only when `isTracked(game) && event.period !== 'SO'`.
  - It is checked when `manUpGoalIds(game).has(event.id)`.
  - On change it calls `manUpSwitch(game, event.id, checked)`. When that returns a result, the panel journals it (`ctx.journal.record(game.id, result.op, result.event)`) and sends `repo.addEvent` or `repo.removeEvent` through `send`.
  - Like the scorer picker, the box tracks what it last showed, so a refused write puts it back.
  - It is disabled when not writable.

- [ ] **Step 1: Write the failing e2e tests** in `tests/e2e/tracker-events.spec.js`:
  - `Man-up goal switch adds and removes a man-up for that goal`: GOAL on cap 5, open Events, tick `ev-manup`. The doc gains a `manUp` with `ts === goal.ts - 1` and `live-situations` reads `MU 1/1 · MD 0/0`. Untick it → that `manUp` is gone and the figures read `MU 0/0`.
  - `switching off a live-tapped man-up goal counts the man-up as missed`: tap `situation`, then GOAL. In Events, untick → the doc gains a `manUpEnd` with `ts === goal.ts - 1`, the figures read `MU 0/1`, and the box stays unticked.
  - `penalty fouls and situation events are labelled and deletable`: the rows read `Penalty foul · #2 Papadakis`, `Man-up` and `End man-up · no goal`. Deleting the `Man-up` row removes it from the doc.
  - `no Man-up goal switch on untracked games or shootout goals`
- [ ] **Step 2: Run them to make sure they fail.** Run `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:e2e -- tests/e2e/tracker-events.spec.js`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** in `js/tracker/views/events.js`.
- [ ] **Step 4: Run the tests and make sure they pass.** Run the full e2e suite. Expected: all pass.
- [ ] **Step 5: Commit.** Run `git commit -am "feat(events): label new events; Man-up goal switch fixes a forgotten man-up tap"`.

---

### Task 6: Viewer — badge, figures, timeline, Pen. columns, season trend

**Files:**
- Modify: `js/viewer.js`, `css/viewer.css`
- Test: `tests/e2e/viewer.spec.js`

**Interfaces:**
- Consumes: `replaySituations`, `situationCounts`, `manUpGoalIds` (Task 1); the extended `playerLines`/`timeline` (Task 1); the shape of `stats.situations`, `results[].manUp/manDown` and `players[].pens` (Task 2); `manUpText`, `manDownText`, `situationShort`, `timelineEntry` and the new strings (Task 3).
- Produces (test ids):
  - `situation-badge` in the scoreboard status, after the period. It reads `situationManUp` or `situationManDown`. It is shown only when the game is live and `replaySituations(game).open` isn't null.
  - `game-manup` and `game-mandown` in the scoreboard: `manUpText` and `manDownText` of `situationCounts(game)` (so `—` for an untracked game). They are part of the persistent skeleton and updated on every render.
  - Timeline:
    - situation events aren't listed (via `timeline`);
    - `pen` events show as their own line;
    - goals in `manUpGoalIds(game)` get `span.tl-tag` with test id `tl-manup` and the text `tlManUpTag`, which is also in the sr text;
    - the `renderIfChanged` input becomes `[game.lineup, game.events, game.situations === true]`.
  - Our players table: a `colPen` column with cells `player-pen`.
  - Season: `season-situations` shows `manUpText(stats.situations.manUp)` and `manDownText(stats.situations.manDown)`, and only when `stats.situations` is truthy.
  - Results rows: each row gets `result-situations` with `situationShort(result.manUp ? { manUp: result.manUp, manDown: result.manDown } : null)`.
  - Player totals: a `colPen` column with cells `season-pen` (`player.pens ?? 0`).

- [ ] **Step 1: Write the failing e2e tests** in `tests/e2e/viewer.spec.js`, seeding docs with the existing helpers:
  - `live man-up shows the badge and the game figures`: a tracked live game with `[manUp@1, goal p5@2, excl p2@3]`. `situation-badge` reads `Man-down`, `game-manup` reads `Man-up 1/1 · 100%`, and `game-mandown` reads `Man-down 0/0 stopped`. An `update` adding `oppGoal@4` → the badge is hidden and `game-mandown` reads `Man-down 0/1 stopped · 0%`.
  - `goals scored on a man-up are tagged; situation events are not listed; penalty fouls are`: `timeline-item` count equals goals + oppGoals + excl + pen. The man-up goal's item contains `tl-manup`. One item contains `#2 Papadakis` with the 🟧 icon.
  - `untracked game shows dashes and no badge`: `game-manup` reads `Man-up —` and `game-mandown` reads `Man-down —`.
  - `season line, per-game figures and Pen. columns`: seed `stats/{season}` with `situations`, two results (one with `manUp`/`manDown`, one without) and players with `pens`. Expect `season-situations` to contain `Man-up 4/9 · 44%`, the `result-situations` cells to read `MU 3/7 · MD 4/6` and `—`, and `season-pen` to show the seeded values.
  - `an old stats document without the new fields still renders`: a stats doc shaped like today's (no `situations`, no `pens`, no result figures) → `season-situations` is absent, `result-situations` reads `—`, `season-pen` reads `0`, and nothing reaches the console.
- [ ] **Step 2: Run them to make sure they fail.** Run `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:e2e -- tests/e2e/viewer.spec.js`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** in `js/viewer.js` and `css/viewer.css`. The timeline keeps its scroll and focus behaviour: the existing tests in `viewer.spec.js` must still pass.
- [ ] **Step 4: Run the tests and make sure they pass.** Run `npm test`, `npm run test:emu` and the full e2e suite. Expected: all pass.
- [ ] **Step 5: Commit.** Run `git commit -am "feat(viewer): man-up/man-down badge and figures, tagged timeline, Pen. columns, season trend"`.
