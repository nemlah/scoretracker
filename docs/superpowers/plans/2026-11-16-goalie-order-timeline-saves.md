# Goalie Order, Smaller Goalie Buttons, Timeline Saves — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the tracker live screen the goalie in goal comes first and the other goalie last, Goal / Excl / Pen on goalie tiles are 36 px, and the viewer timeline lists every ordinary save.

**Architecture:** Tile order and the post-change pause live in `js/tracker/views/live.js` (no new imports, so the tracker stays mixed-cache safe). The viewer gets saves from `timeline()` / `timelineEntry()` and only shows them when both loaded modules export a `TIMELINE_SAVES` flag, read off namespace imports.

**Tech Stack:** Plain ES modules, no build step; Firebase Firestore; `node --test` unit tests; Playwright e2e against the Firebase emulators.

**Spec:** `docs/superpowers/specs/2026-11-16-goalie-order-timeline-saves-design.md`

## Global Constraints

- All user-visible text in `js/strings.js`; no new JS files (so `sw.js` `SHELL` is unchanged).
- Event objects keep exactly `{ id, type, period, ts, playerId? }`; no change to journal, stats, rules or season tables.
- Both goalie tiles keep the same height in every state (hidden buttons keep their space with `visibility: hidden`).
- `js/tracker/views/live.js` adds no new named imports. `js/viewer.js` reads new exports only through `import * as …` with a fallback.
- Unit: `npm test`. Focused e2e: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npx firebase emulators:exec --only firestore,auth --project demo-scoretracker "playwright test <file> --reporter=list"`. Full e2e: same with `playwright test --reporter=list`.
- Each commit ends with the `Co-Authored-By` line of the model that wrote it.

## Review Focus

1. A goalie change that does not come from this device's goalie buttons (Undo of a `gkIn`, another device's tap, an Events-sheet In goal correction): the tiles reorder, with no pause and no scroll. → Task 1 test "a goalie change from Undo reorders without the pause or a scroll".
2. The shootout: SAVE is hidden but keeps its space; PEN SAVE on the goalie not in goal swaps the tiles and pauses exactly like In goal. → Task 1 test "in the shootout Pen save on the other goalie swaps the tiles and pauses".
3. Three goalies in a lineup: the goalie in goal first, then field players, then both other goalies by cap. → Task 1 test "with three goalies the two not in goal come last by cap".
4. A phone holding the previous `strings.js` (or `model.js`) beside the new `viewer.js`: no save rows, and no save drawn as an exclusion badge. → Task 3 tests in the `mixed module cache` describe.
5. A 360 px phone: "Goal", "Excl", "Pen" fit inside their 36 px buttons without spilling. → Task 1 test "Goal, Excl and Pen on goalie tiles are 36 px and their labels fit at 360 px".

---

### Task 1: Live screen — goalie order, pause after a goalie change, 36 px goalie buttons

**Files:**
- Modify: `js/tracker/views/live.js` (`buildTile` ~22-130, `mount` locks ~133-200, `renderGame` tile order ~292-312, unmount timer cleanup)
- Modify: `css/tracker.css` (`.tile-actions--goalie` rules ~326-341)
- Test: `tests/e2e/tracker-goalies.spec.js`

**Interfaces:**
- Consumes: `goalieStats(game).inGoal` (`js/goalies.js`), `ctx.tapper.tap(type, playerId)` (returns the event or `null`).
- Produces: nothing other tasks use.

- [ ] **Step 1: Update and add the e2e tests** in `tests/e2e/tracker-goalies.spec.js` (helpers `tile`, `tileCaps`, `boxes`, `startGoalieGame`, `currentGameId` already exist; `startGoalieGame` gives goalies #1 and #13 and field player #5).
  - Rename `'goalie tiles come first and the lowest cap starts in goal'` to `'the goalie in goal comes first, field players next, the other goalie last'`; its order assertion becomes `expect(await tileCaps(page)).toEqual(['1', '5', '13'])`; every other assertion stays.
  - Replace `'Save on the bench goalie moves the highlight without moving any tile'` with `'Save on the other goalie puts them in goal and swaps the goalie tiles; the field tile stays put'`: record the box of `tile(page, 5)`, click `tile(page, 13)` SAVE, then `tileCaps` is `['13', '5', '1']`, `tile(page, 13)` has `data-in-goal="true"`, and the box of `tile(page, 5)` is unchanged within 0.5 px.
  - `'In goal switches the goalie in goal'`: add `expect(await tileCaps(page)).toEqual(['13', '5', '1'])` after the switch.
  - New `'after a goalie change the goalie buttons pause for a second'`: click In goal on #13; at once `tile(page, 1)` In goal and SAVE, and `tile(page, 13)` SAVE and Pen save, are disabled; click `tile(page, 1).getByTestId('tile-in-goal')` with `{ force: true }`; within 2 s all four are enabled again; the game's events are exactly `[['gkIn', 'g13']]`.
  - New `'a Save on the goalie in goal does not pause anything'`: click SAVE on #1; `tile(page, 13).getByTestId('tile-in-goal')` is enabled at once (`toBeEnabled({ timeout: 300 })`).
  - New `'a goalie change scrolls back to the top'`: `page.setViewportSize({ width: 360, height: 480 })`, scroll to the bottom (`window.scrollTo(0, document.body.scrollHeight)`), assert `scrollY > 0`, click In goal on #13, then `expect.poll(() => page.evaluate(() => scrollY)).toBe(0)`.
  - New `'a goalie change from Undo reorders without the pause or a scroll'`: In goal on #13, wait until its buttons are enabled again, scroll to the bottom at 360×480, click Undo; `tileCaps` back to `['1', '5', '13']`, `scrollY` still > 0, `tile(page, 13)` In goal enabled at once.
  - New `'in the shootout Pen save on the other goalie swaps the tiles and pauses'`: reach the shootout the way `'the shootout hides Save and keeps Pen save'` does; click Pen save on #13; `tileCaps` is `['13', '5', '1']` and `tile(page, 1)` Pen save is disabled at once.
  - New `'with three goalies the two not in goal come last by cap'`: a game whose lineup also marks #7 as goalie (follow how `startGoalieGame` seeds the roster); `tileCaps` is `['1', '5', '7', '13']`; after In goal on #13, `['13', '5', '1', '7']`.
  - New `'Goal, Excl and Pen on goalie tiles are 36 px and their labels fit at 360 px'`: at width 360, every `tile-goal` / `tile-excl` / `tile-pen` inside a `[data-goalie="true"]` tile has a bounding height of 36 ± 1 and `scrollHeight <= clientHeight + 1` and `scrollWidth <= clientWidth + 1`; `tile(page, 5).getByTestId('tile-goal')` is still at least 48 px high.
  - Leave `'a game without goalies looks as before'` (order `['1', '5', '13']`) unchanged.

- [ ] **Step 2: Run the goalie spec and see the new and changed tests fail**

Run the focused e2e command for `tests/e2e/tracker-goalies.spec.js`.
Expected: the renamed order test, the Save-swap test, the three-goalie test, the pause tests, the scroll test and the 36 px test FAIL on order, enabled state, `scrollY` or height.

- [ ] **Step 3: Order the tiles in `renderGame`**

Replace the "Goalie tiles first, then field players" line: `lines` = the goalie whose `playerId === stats?.inGoal` (if any), then field players, then the other goalies; within each group keep `playerLines` order (by cap). Update the comment to say why the field tiles never move (equal goalie tile heights). Store `stats?.inGoal ?? null` in a mount-level `inGoalId`.

- [ ] **Step 4: Route the goalie buttons through a pause in `mount`**

- `const GOALIE_LOCK_MS = 1000;` beside the other lock constants.
- `buildTile(player, ctx, onGoalieTap)`: the SAVE, Pen save and In goal buttons call `onGoalieTap(type, player.playerId)` with `'save'`, `'penSave'`, `'gkIn'`.
- `tile.update(line, writable, goalieLine, inGoal, shootout, goalieLocked)`: the three goalie buttons are also disabled while `goalieLocked`.
- In `mount`, `goalieTap(type, playerId)`: return if `goalieLocked`; `changes = inGoalId !== null && playerId !== inGoalId`; call `ctx.tapper.tap(type, playerId)`; if it returned an event and `changes`, set `goalieLocked`, re-render at once, start a `GOALIE_LOCK_MS` timer that clears it and calls `update(ctx.getState())` (mirror `onUndo`, `live.js:191-199`), and `window.scrollTo({ top: 0, behavior })` with `behavior` `'auto'` when `matchMedia('(prefers-reduced-motion: reduce)')` matches, else `'smooth'`. Clear the timer on unmount like the other lock timers.

- [ ] **Step 5: 36 px Goal / Excl / Pen on goalie tiles** in `css/tracker.css`: `.tile-actions--goalie` second row `2.25rem` (was `3rem`); the goalie-tile Goal / Excl / Pen buttons `min-height: 2.25rem` with font sizes reduced as needed so the 360 px test passes. Field tiles unchanged.

- [ ] **Step 6: Run the goalie spec, then the whole e2e suite**

Run the focused command for `tests/e2e/tracker-goalies.spec.js`, then the full e2e command, then `npm test`.
Expected: all pass (the offline suite skips on WebKit as before).

- [ ] **Step 7: Commit**

```bash
git add js/tracker/views/live.js css/tracker.css tests/e2e/tracker-goalies.spec.js
git commit -m "feat(tracker): goalie in goal first, other goalie last; pause after a goalie change; 36 px goalie buttons"
```

### Task 2: Saves in `timeline()` and `timelineEntry()`

**Files:**
- Modify: `js/model.js:129-137` (`timeline`), add an export
- Modify: `js/strings.js` (strings near `tlPenSaveIcon`, `timelineEntry` ~260-290), add an export
- Test: `tests/unit/model.game.test.js`, `tests/unit/strings.test.js`

**Interfaces:**
- Produces: `export const TIMELINE_SAVES = true` in both `js/model.js` and `js/strings.js`; `timeline(events)` now keeps `save` events (still drops `gkIn` and situation types); `timelineEntry(saveEvent, lineup)` returns `{ side: 'us', icon: '✋', sr: 'Save', text: 'Save · #<cap> <name>', badge: false, minor: true }`. Every other entry keeps its current shape (no `minor` key).

- [ ] **Step 1: Write the failing unit tests**

```js
// tests/unit/model.game.test.js — replaces 'timeline leaves out save and gkIn'
test('timeline keeps saves and leaves out gkIn', () => {
  const save = ev('save', 1, 'g1', 1);
  const goal = ev('goal', 1, 'p1', 4);
  const penSave = ev('penSave', 1, 'g1', 5);
  const events = [save, ev('gkIn', 1, 'g2', 2), goal, penSave];
  assert.deepEqual(m.timeline(events), [{ period: 1, events: [penSave, goal, save] }]);
  assert.equal(m.TIMELINE_SAVES, true);
});

// tests/unit/strings.test.js — next to 'timelineEntry for a penalty save'
test('timelineEntry for a save', () => {
  assert.deepEqual(timelineEntry({ type: 'save', playerId: 'g1' }, goalkeepers),
    { side: 'us', icon: '✋', sr: 'Save', text: 'Save · #1 Georgiou', badge: false, minor: true });
  assert.deepEqual(timelineEntry({ type: 'save', playerId: 'gone' }, goalkeepers),
    { side: 'us', icon: '✋', sr: 'Save', text: 'Save · #? Unknown player', badge: false, minor: true });
  assert.equal(TIMELINE_SAVES, true); // import it from ../../js/strings.js
});
```

- [ ] **Step 2: Run `npm test`** — Expected: both new tests FAIL (save filtered out; save rendered as an exclusion entry; `TIMELINE_SAVES` undefined).

- [ ] **Step 3: Implement** — `timeline()` stops filtering `save`; `export const TIMELINE_SAVES = true;` in `js/model.js` with a one-line comment (the viewer checks it before passing saves). In `js/strings.js` add `tlSaveIcon: '✋'`, `tlSaveSr: 'Save'`, `tlSaveText: 'Save · {player}'`, a `save` branch in `timelineEntry` beside the `penSave` one, and the same `TIMELINE_SAVES` export.

- [ ] **Step 4: Run `npm test`** — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add js/model.js js/strings.js tests/unit/model.game.test.js tests/unit/strings.test.js
git commit -m "feat(model): saves in timeline() and timelineEntry(), behind TIMELINE_SAVES"
```

### Task 3: Viewer shows save rows, lighter, and only with both new modules

**Files:**
- Modify: `js/viewer.js` (imports at the top; `timelineSection` ~476-488; `timelineItem` ~490-506)
- Modify: `css/viewer.css` (timeline rules ~165-215)
- Test: `tests/e2e/viewer.spec.js` (~525), `tests/e2e/viewer-celebration.spec.js` (`mixed module cache` describe ~219)

**Interfaces:**
- Consumes: `model.TIMELINE_SAVES`, `strings.TIMELINE_SAVES`, `timelineEntry(...).minor` (Task 2).
- Produces: timeline rows for saves carry the class `tl-minor`.

- [ ] **Step 1: Update and add the e2e tests**
  - `tests/e2e/viewer.spec.js`: rename `'penalty saves appear in the timeline; saves and In goal do not'` to `'saves and penalty saves appear in the timeline; In goal does not'`. With `goalieEvents()` (3 saves, 2 opponent goals, 1 pen save, 1 gkIn): `timeline-item` count is 6; items with text `Save · ` (exact prefix, not "Penalty saved") count 3, each contains `✋` and has class `tl-minor`; the pen-save item keeps its current assertions and has no `tl-minor`; one item contains `#13 Nikolaou` (his save); no item contains `In goal`.
  - `tests/e2e/viewer-celebration.spec.js`, in `mixed module cache`: keep `'saves and In goal stay out of the timeline when model.js is the previous version'` unchanged (it must still pass). Add `'saves stay out of the timeline when strings.js is the previous version'`: route `**/js/strings.js` to `git show 2307a1b:js/strings.js`, seed the same three events and goalie lineup as that test; `score-them` is `1`, `timeline-item` count is 1, and no `tl-badge` icon is shown. Add the same with `**/js/model.js` routed to `git show 2307a1b:js/model.js`.

- [ ] **Step 2: Run both spec files and see the new tests fail**

Run the focused e2e command for `tests/e2e/viewer.spec.js`, then for `tests/e2e/viewer-celebration.spec.js`.
Expected: the renamed viewer test FAILS (count 3, no save rows). The two new mixed-cache tests already pass here (today's viewer filters saves); they guard the fallback once Step 3 lands and must still pass then.

- [ ] **Step 3: Implement**
  - `js/viewer.js`: add `import * as strings from './strings.js';` beside the existing `import * as model`. In `timelineSection`, `savesShown = model.TIMELINE_SAVES === true && strings.TIMELINE_SAVES === true`; pass `game.events` without `gkIn`, and without `save` unless `savesShown`. Update the comment. In `timelineItem`, add `tl-minor` to the `li` class when `entry.minor`.
  - `css/viewer.css`: `.tl-minor` uses the same text colour as the viewer's existing `.muted` rule (keep ≥ 4.5:1 on the timeline background).

- [ ] **Step 4: Run both spec files, then the whole e2e suite and `npm test`** — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add js/viewer.js css/viewer.css tests/e2e/viewer.spec.js tests/e2e/viewer-celebration.spec.js
git commit -m "feat(viewer): ordinary saves in the game timeline, lighter than goals"
```
