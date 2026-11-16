# Quiet Takeover, Two-Row Goalie Tile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No takeover banner while no game is live (the first touch or key press takes control quietly), and goalie tiles with two rows like player tiles (In goal in the head, SAVE | Pen save | ⋯ with Goal / Exclusion / Pen in a sheet).

**Architecture:** `js/tracker/app.js` derives a new `state.writable` and claims control on the first input; views enable their controls from `state.writable`. The goalie tile in `js/tracker/views/live.js` moves In goal into the head and the rare actions into a `createOverlay` sheet.

**Tech Stack:** Plain ES modules, no build step; Firebase Firestore; Playwright e2e against the Firebase emulators; `node --test` unit tests.

**Spec:** `docs/superpowers/specs/2026-11-16-quiet-takeover-and-two-row-goalie-tile-design.md`

## Global Constraints

- All user-visible text in `js/strings.js`; no new JS files (`sw.js` `SHELL` unchanged).
- Views may import only exports that already exist in today's modules (`createOverlay` from `js/ui/overlay.js` does), so a phone mixing cached files still loads.
- Event objects, journal, stats, Firestore rules unchanged.
- During a live game the takeover banner, disabled controls and explicit Take over behave exactly as today.
- Goalie order (goalie in goal first, field players, other goalie last), the 1 s pause after a goalie change made with this device's goalie buttons, and the scroll to the top stay as today.
- Focused e2e: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npx firebase emulators:exec --only firestore,auth --project demo-scoretracker "playwright test <files> --reporter=list"`; full e2e: same with `playwright test --reporter=list`; unit: `npm test`.
- Each commit ends with the `Co-Authored-By` line of the model that wrote it.

## Review Focus

1. A touch on the device not in control while the current game has not loaded yet: no takeover (treated as live). → Task 1 reviewer check of `derive()` / the input listener (not reproducible in e2e).
2. Keyboard only: the first key press on the device not in control takes control and the change it starts is saved. → Task 1 test "a first key press takes control and the change is saved".
3. Two devices open side by side with no input: control does not move by itself. → Task 1 test "two open devices do not take control from each other without input".
4. A goalie fouling out while the ⋯ sheet is open: choosing an action records nothing and the sheet closes. → Task 2 test "an action chosen after the goalie fouled out is refused".
5. 360 px with a two-digit cap, a long name, "12 saves · 2 pen" and three foul pips: the head stays one line and the goalie tile is exactly a player tile's height. → Task 2 test "goalie and player tiles are the same height".

---

### Task 1: No banner while no game is live; quiet takeover on the first input

**Files:**
- Modify: `js/tracker/app.js` (`derive` ~354-374, `syncChrome` ~423-433, `takeOver` ~138-150, a new input listener)
- Modify: `js/tracker/views/games.js:157,164,166`, `js/tracker/views/events.js:322`, `js/tracker/views/lineup.js:94` (enable controls from `state.writable`)
- Test: `tests/e2e/tracker-access.spec.js`; banner-dependent tests in `tests/e2e/offline.spec.js`, `tracker-events.spec.js`, `tracker-live.spec.js`, `tracker-roster.spec.js`, `tracker-situations.spec.js`

**Interfaces:**
- Produces: `state.gameLive` (boolean: current game loaded and `status === 'live'`, or not loaded yet) and `state.writable` (boolean: `state.active`, or in a route with a valid editor, online, and `!state.gameLive`). Views read them from the state they are given.

- [ ] **Step 1: Write the failing e2e tests** in `tests/e2e/tracker-access.spec.js` (two contexts as in `'second device takes over; first becomes read-only and can take back'`; B unlocks after A, so B holds control):
  - `'with no live game the device not in control shows no banner and keeps its buttons'`: on A, `takeover-banner` hidden, `home-new` enabled, roster add controls enabled.
  - `'with no live game the first touch takes control and the change is saved'`: record `activeUid` (B); on A add roster player `Quiet` by clicking; `expect.poll` `team/main` roster contains `Quiet`; `control/tracker.activeUid` differs from B's; B shows no banner.
  - `'a first key press takes control and the change is saved'`: as above but A reaches the roster add field and submits with the keyboard only (`press('Tab')` / typing / `press('Enter')`).
  - `'two open devices do not take control from each other without input'`: after both unlock, wait 2000 ms; `activeUid` unchanged.
  - `'offline with no live game the device not in control stays read-only'`: A offline: banner visible, `home-new` disabled; A goes online again before the test ends.
  - Change `'second device takes over; first becomes read-only and can take back'` to start a live game on A first (as `tracker-live.spec.js` does) so its banner assertions stay valid; add: a click on A's scoreboard area does not change `activeUid`.
  - Every other spec that expects `takeover-banner` or disabled controls with no live game: give it a live game, or switch it to the new behaviour — whichever keeps the test's intent.

- [ ] **Step 2: Run the focused specs and see the new tests fail** (`tracker-access.spec.js` plus each spec you changed). Expected: the no-banner, first-touch, first-key tests FAIL; the no-input and offline tests may already pass (guards).

- [ ] **Step 3: Implement in `js/tracker/app.js`**
  - `derive()`: compute `state.gameLive` and `state.writable` as in Interfaces.
  - `syncChrome()`: `readOnly = inRoute && !state.active && (state.gameLive || !state.online)`.
  - `claimControl()`: when in a route, editor valid, not active, not `gameLive`, online, and no claim in flight: set `state.control = { ...(state.control ?? {}), activeUid: state.uid }`, `render()`, then run the existing `takeOver()` body (its refused → code-changed handling). Clear the in-flight flag when it settles.
  - One capture-phase `pointerdown` and `keydown` listener on the tracker root that calls `claimControl()`.

- [ ] **Step 4: Enable view controls from `state.writable`** at `games.js:157,164,166`, `events.js:322` and `lineup.js:94`. Leave handler guards (`ctx.getState().active`) and `live.js`'s `writable = state.active` as they are.

- [ ] **Step 5: Run the focused specs, then the full e2e suite and `npm test`.** Expected: all pass (14 skipped on WebKit as before).

- [ ] **Step 6: Commit**

```bash
git add js/tracker/app.js js/tracker/views/games.js js/tracker/views/events.js js/tracker/views/lineup.js tests/e2e/
git commit -m "feat(tracker): no takeover banner while no game is live; the first touch takes control"
```

### Task 2: Two-row goalie tile with a ⋯ sheet

**Files:**
- Modify: `js/tracker/views/live.js` (`buildTile` goalie branch ~48-80, `update` goalie part ~108-127)
- Modify: `css/tracker.css` (goalie tile rules ~306-350; remove the goalie line and second-row rules)
- Modify: `js/strings.js` (new keys)
- Test: `tests/e2e/tracker-goalies.spec.js` (+ any spec that taps Goal / Excl / Pen on a goalie tile)

**Interfaces:**
- Consumes: `createOverlay({ title, testid, closeTestId })` from `js/ui/overlay.js` (see how `js/tracker/views/lineup.js:18` opens and closes one).
- Produces: test ids `tile-more` (⋯ on a goalie tile), sheet `goalie-more-sheet` with `goalie-more-close`, buttons `more-goal`, `more-excl`, `more-pen`; `tile-in-goal` now lives in `.tile-head`; `.in-goal-badge` in the same head slot.

- [ ] **Step 1: Write the failing e2e tests** in `tests/e2e/tracker-goalies.spec.js`:
  - `'goalie and player tiles are the same height'`: at 360 and at 800 px, every tile's bounding height equals the field tile #5's (±0.5 px); repeated after #1 fouls out via the sheet, with a goalie named `Κωνσταντινίδης` on cap 13, with `12 saves · 2 pen` showing, and in the shootout.
  - `'the head shows IN GOAL or an In goal button, and saves instead of goals'`: #1 head has `.in-goal-badge` visible and no visible `tile-in-goal`; #13 has `tile-in-goal` visible inside `.tile-head`; `tile-saves` reads `0 saves`; goalie tiles show no `goals` label and no `.gk-badge`; the row holds `tile-save`, `tile-pen-save`, `tile-more` and no `tile-goal` / `tile-excl` / `tile-pen`.
  - `'the ⋯ sheet records a goalie's goal, exclusion or penalty'`: `tile-more` on #1 opens `goalie-more-sheet` whose title contains `#1`; `more-excl` records `['excl', 'g1']` and closes the sheet; `more-goal` makes `score-us` 1; `more-pen` records `['pen', 'g1']`; `goalie-more-close` closes without recording.
  - `'an action chosen after the goalie fouled out is refused'`: bring #1 to two fouls, open the sheet, record a third foul for #1 by seeding it through `update('games/<id>', …)`, then click `more-goal`: no new event, sheet closed.
  - `'⋯ is disabled for an OUT goalie and on a device not in control during a live game'`.
  - Update existing tests to the new layout: remove the 36 px and the two-column stretch tests; In goal tests click the head `tile-in-goal`; OUT setup uses the sheet; the pause test covers SAVE, Pen save and the head In goal buttons.

- [ ] **Step 2: Run the goalie spec and see the new tests fail** (layout, head, sheet).

- [ ] **Step 3: Implement**
  - `live.js` goalie branch: head = cap · name (one line, ellipsis) · in-goal slot (badge for the goalie in goal, `tile-in-goal` button otherwise, same footprint) · saves text (existing `tileSaves` / `tileSavesOne` / `tileSavesWithPen`) · pips; no GK badge, no goals count. Row = SAVE | Pen save | ⋯ with the player row's column widths and a 64 px height. ⋯ opens one `createOverlay` sheet per tile; its buttons call `ctx.tapper.tap('goal' | 'excl' | 'pen', playerId)` and close the sheet. Disabled rules: ⋯ like Goal today (`!writable || line.out`); the head In goal button joins the 1 s goalie pause.
  - `css/tracker.css`: goalie tile = head + one row; delete the goalie-line and second-row rules; keep `visibility: hidden` for SAVE in the shootout.
  - `js/strings.js`: `moreButton: '⋯'`, `moreFor: 'Goal, exclusion or penalty for {name}'`, `moreSheetTitle: '#{cap} {name}'`.

- [ ] **Step 4: Run the goalie spec, then the full e2e suite and `npm test`.** Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add js/tracker/views/live.js css/tracker.css js/strings.js tests/e2e/
git commit -m "feat(tracker): two-row goalie tile — In goal in the head, Goal / Exclusion / Pen behind ⋯"
```
