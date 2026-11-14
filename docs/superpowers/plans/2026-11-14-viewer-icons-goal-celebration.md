# Viewer foul icons and goal celebration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the viewer timeline, show calm E / P badges for fouls with 🟥 only on the foul that puts a player out. Celebrate each new goal of ours on the viewer with a water polo themed overlay.

**Architecture:** Pure logic first (Task 1): which foul is a player's third, which goal is new since the last render, and a small watcher holding the "don't fire on load or reload" rules. Task 2 renders the badges. Task 3 adds a DOM/CSS + inline-SVG overlay module (`js/celebrate.js`), mounted on `document.body` outside the re-rendered sections, and wires the watcher into `js/viewer.js`.

**Tech Stack:** Plain HTML/CSS/JS ES modules (no build), Firestore Web SDK 12.19.0 with the persistent local cache, `node --test`, Playwright e2e against the Firestore/Auth emulators.

**Spec:** `docs/superpowers/specs/2026-11-14-viewer-icons-goal-celebration-design.md`

## Global Constraints

- Viewer only. Tracker files (`js/tracker/**`, `css/tracker.css`) are not touched.
- No external libraries and no image files. Ball, net, wave and droplets are inline SVG or CSS. Every new JS file is added to `SHELL` in `sw.js`.
- Every visible string lives in `js/strings.js`. The copy below is exact.
- Celebration length is `CELEBRATION_MS = 2500`.
- It celebrates our goals only (`type === 'goal'`, any period, shootout included) and only while the game is live.
- The overlay is `aria-hidden="true"`. It takes no pointer events except on its banner, and tapping the banner hides it.
- With `prefers-reduced-motion: reduce`, only the banner shows (fade in and out). There's no wave, droplet or ball movement.
- It works in the viewer's light and dark palettes, and at a 360 px wide viewport without sideways scrolling.
- The timeline keeps its scroll position and focus across live updates (existing tests must keep passing).
- Commands:
  - unit: `npm test`;
  - focused e2e: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npx firebase emulators:exec --only firestore,auth --project demo-scoretracker "playwright test <file>"`;
  - full e2e: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:e2e`.

## Review Focus

1. **Reload with the persistent cache.** The first snapshot comes from the cache, with older events, and the server snapshot then brings goals scored while the page was closed. Expected: no celebration. → Task 1 test `a reload's cache-then-server snapshots don't celebrate`; Task 3 test `reopening the viewer after goals were scored does not celebrate`.
2. **A live update arriving mid-celebration.** An opponent goal 0.5 s later rebuilds the sections. Expected: the overlay stays and finishes. → Task 3 test `the celebration survives a following update`.
3. **The overlay covering the page.** Expected: taps reach the page under it, except on the banner. → Task 3 test `the overlay does not block the page`.
4. **Two of our goals within 2.5 s.** Expected: the celebration restarts and names the second scorer. → Task 3 test `a second goal restarts the celebration with the new scorer`.
5. **The third foul is a penalty foul, or events aren't stored in time order.** Expected: the fouling-out event is found by `ts` order and can be a `pen`. → Task 1 tests.

---

### Task 1: Foul-out and new-goal logic, timeline entry for badges

**Files:**
- Modify: `js/model.js` (add `foulOutIds`, `latestNewGoal`), `js/strings.js` (`timelineEntry`, new strings), `sw.js` (`SHELL`)
- Create: `js/goalWatch.js`, `tests/unit/goalWatch.test.js`
- Test: `tests/unit/model.game.test.js`, `tests/unit/strings.test.js` (update the existing `timelineEntry` expectations at lines ~51, 59, 130, 132)

**Interfaces (produced):**
- `foulOutIds(events) → Set<string>`: per `playerId`, the id of the `excl` or `pen` event that brings that player's foul count to `EXCL_LIMIT`. Events count in `ts` order, with ties keeping array order. Events without a `playerId` are ignored, and later fouls by the same player aren't added.
- `latestNewGoal(prevEvents, nextEvents) → Event | null`: the newest event in `nextEvents` (by `ts`, ties go to the later array index) with `type === 'goal'` and an id not present in `prevEvents`. Otherwise `null`.
- `js/goalWatch.js`: `createGoalWatcher() → { next(game | null, meta = {}) → Event | null }`, where `meta` is `{ fromCache?: boolean }`. It imports `latestNewGoal` from `./model.js`. Rules:
  - `game === null`: forget everything, return `null`.
  - A different `game.id` from last time: remember `game.events`, set `confirmed = meta.fromCache === false`, return `null`.
  - The same id: the result is `latestNewGoal(lastEvents, game.events)` when `game.status === 'live'` and `confirmed` was already true before this call, otherwise `null`. Then set `lastEvents = game.events`, and `confirmed ||= meta.fromCache === false`.
- `timelineEntry(event, lineup, opponent, out = false)` returns `{ side, icon, sr, text, badge }`.
  - `badge` is `true` only for an `excl` or `pen` that isn't the fouling-out one. Then `icon` is `tlExclIcon` or `tlPenIcon`.
  - For the fouling-out foul (`out === true`), `icon` is `tlOutIcon`, `text` is `tlOutText` with `{player}` set to the player text, and `sr` is `tlOutSr` with `{foul}` set to the foul's sr word.
  - Goals and opponent goals: `badge: false`, otherwise as today.
- Strings (exact). `tlExclIcon` and `tlPenIcon` change value:

```
tlExclIcon: 'E', tlPenIcon: 'P', tlOutIcon: '🟥', tlOutText: '{player} · out', tlOutSr: '{foul} · out',
celebrateGoal: 'GOAL!', celebrateScorer: '#{cap} {name}', celebrateManUp: '{scorer} · man-up',
```

- [ ] **Step 1: Write the failing tests.** Use the `ev(type, period, playerId, ts, id)` helper style.
  - In `model.game.test.js`:
    - `foulOutIds marks the foul that reaches 3`: `[excl a@1, excl a@2, excl b@3, pen a@4, excl a@5]` → `Set{ 'e4' }`. The third foul is a `pen`, and the later `excl a@5` isn't added.
    - `foulOutIds counts in ts order, not array order`: an array `[excl a@30, excl a@10, excl a@20]` → `Set{ 'e30' }`.
    - `foulOutIds ignores fouls without a player`.
    - `latestNewGoal returns the newest new goal of ours`: prev `[goal@1]`, next `[goal@1, oppGoal@2, goal@3, goal@4]` → the `@4` goal. It returns `null` when only an `oppGoal` is new, when a goal was removed, and when the same goal id comes back with another `playerId`.
  - In `goalWatch.test.js`, with `live(events) = { id:'g1', status:'live', events }`:
    - `the first snapshot never celebrates`
    - `a new goal on a confirmed live game celebrates`: `next(live([]), {fromCache:false})`, then `next(live([goal@1]), {fromCache:false})` → the goal.
    - `a reload's cache-then-server snapshots don't celebrate`: `next(live([goal@1]), {fromCache:true})`, then `next(live([goal@1, goal@2]), {fromCache:false})` → `null`. A further `goal@3` from the server → that goal.
    - `after a reconnect the newest new goal celebrates once`: confirmed, then `{fromCache:true}` with the same events, then the server with `[…, goal@5, goal@6]` → `@6`. Repeating the same snapshot → `null`.
    - `no celebration on a final game, a game switch, or null`
  - In `strings.test.js`:
    - Update the existing `timelineEntry` expectations: the exclusion icon is `'E'` and the penalty icon is `'P'`, both with `badge: true`. Goals and opponent goals get `badge: false`.
    - Add `timelineEntry for a fouling-out foul`: `timelineEntry(excl p2, lineup, 'X', true)` → `{ side:'us', icon:'🟥', sr:'Exclusion · out', text:'#2 Papadakis · out', badge:false }`. The same call for a `pen` gives `sr: 'Penalty foul · out'`.
- [ ] **Step 2: Run them to make sure they fail.** Run `npm test`. Expected: the new and updated tests FAIL.
- [ ] **Step 3: Implement** the interfaces above. Add `'./js/goalWatch.js'` to `SHELL`.
- [ ] **Step 4: Run the tests and make sure they pass.** Run `npm test`. Expected: all pass, including `sw-shell.test.js`.
- [ ] **Step 5: Commit.** Run `git add js/model.js js/strings.js js/goalWatch.js sw.js tests/unit && git commit -m "feat(viewer-logic): foul-out detection, new-goal watcher, badge timeline entries"`.

---

### Task 2: Viewer timeline badges

**Files:**
- Modify: `js/viewer.js` (`timelineSection`, `timelineItem`), `css/viewer.css` (`.tl-icon`, new `.tl-badge`)
- Test: `tests/e2e/viewer.spec.js` (update line ~88, which finds exclusions by '🟥', and line ~345, which finds penalty fouls by '🟧')

**Interfaces:**
- Consumes: `foulOutIds` and `timelineEntry(event, lineup, opponent, out)` from Task 1.
- Produces:
  - `timelineSection` computes `foulOutIds(game.events)` once and passes `out` to each item.
  - The icon span gets `data-testid="tl-icon"`, plus class `tl-badge` when `entry.badge`.
  - The `li` gets `data-out="true"` when `out`.
- CSS: `.tl-badge` is a small rounded grey letter badge, the same height as the emoji icons, readable in the light and dark palettes, and visually quieter than 🟥.

- [ ] **Step 1: Write the failing e2e tests.** Update the two existing locators to use the new icons. Then add `fouls show E and P badges; the third foul shows a red card and out`: seed a live game where `p2` has `excl, excl, pen` and `p5` has one `pen`.
  - `p2`'s first two items have `tl-icon` text `E` with class `tl-badge`.
  - `p2`'s pen item has `data-out="true"`, `tl-icon` text `🟥`, and text containing `#2 Papadakis · out`.
  - `p5`'s pen item has `tl-icon` text `P` with class `tl-badge`.
  - No timeline item contains '🟧'.
- [ ] **Step 2: Run them to make sure they fail.** Run the focused e2e on `tests/e2e/viewer.spec.js`. Expected: the new test FAILS.
- [ ] **Step 3: Implement** in `js/viewer.js` and `css/viewer.css`.
- [ ] **Step 4: Run the tests and make sure they pass.** Run the focused e2e, then the full e2e. Expected: all pass.
- [ ] **Step 5: Commit.** Run `git commit -am "feat(viewer): E/P foul badges, red card only on fouling out"`.

---

### Task 3: Water polo goal celebration

**Files:**
- Create: `js/celebrate.js`, `tests/e2e/viewer-celebration.spec.js` (setup copied from `viewer.spec.js`)
- Modify: `js/viewer.js` (create the overlay once, call the watcher in `render`), `css/viewer.css`, `sw.js` (`SHELL`)

**Interfaces:**
- Consumes: `createGoalWatcher` (Task 1), `manUpGoalIds` (`js/situations.js`), and the strings `celebrateGoal`, `celebrateScorer`, `celebrateManUp`.
- Produces `js/celebrate.js`:
  - `export const CELEBRATION_MS = 2500`
  - `createCelebration(host) → { show({ scorer: string | null, manUp: boolean }): void, hide(): void, destroy(): void }`
  - **Overlay markup.** Built once and appended to `host`:
    - `div.celebration[data-testid="celebration"][aria-hidden="true"]`, `hidden` when idle;
    - inside it: `.celebration-wave`, several `.celebration-drop` droplets, an inline-SVG yellow-and-blue `.celebration-ball` and a `.celebration-net`;
    - the banner `[data-testid="celebration-banner"]`, holding `[data-testid="celebration-goal"]` with the text `celebrateGoal` and `[data-testid="celebration-scorer"]`.
  - **Scorer line:** it reads `celebrateManUp` with `{scorer}` when `manUp` is true and a scorer is known. Otherwise it reads the scorer alone. It is hidden when `scorer` is `null`.
  - **`show()`:** fills the text, unhides the overlay, and restarts the animations: remove the playing class, force a reflow, add it back. It also resets the hide timer to `CELEBRATION_MS`.
  - **Hiding:** a click on the banner hides it straight away.
- Viewer wiring:
  - `const celebration = createCelebration(document.body)` and `const goals = createGoalWatcher()` at module level.
  - In `render()`: when the mode is `'game'`, `const goal = goals.next(state.game, state.gameMeta ?? {})`. Otherwise `goals.next(null)`.
  - When there's a goal, call `celebration.show({ scorer, manUp })`:
    - `scorer` is `t('celebrateScorer', { cap, name })` for a lineup player, or `null`;
    - `manUp` is `manUpGoalIds(state.game).has(goal.id)`.
- CSS:
  - Fixed full-viewport overlay with `pointer-events: none`; the banner has `pointer-events: auto`.
  - The wave rises from the bottom and drains away, droplets splash up, and the ball arcs into the net, all inside `CELEBRATION_MS`.
  - Use the existing tokens (`--pool`, `--water`, `--accent`, `--rope`), with a yellow (#F2C200 or near it) and blue ball.
  - Nothing may overflow sideways at 360 px; clip it with `overflow: hidden` on the overlay.
  - Under `prefers-reduced-motion: reduce`, hide the wave, droplets, ball and net and only fade the banner.

- [ ] **Step 1: Write the failing e2e tests** in `tests/e2e/viewer-celebration.spec.js`. Seed a tracked live game with lineup `p2 Papadakis #2` and `p5 Alexiou #5`, load the viewer, and wait for the score. Add goals with `update('games/g1', { events: [...] })`.
  - `a new goal of ours celebrates with the scorer, then hides`: add a goal for `p5` → `celebration` visible, `celebration-goal` reads `GOAL!`, and `celebration-scorer` reads `#5 Alexiou`. It is hidden again within 4 s.
  - `a man-up goal says so; an unknown scorer shows GOAL! alone`: events `[manUp@1, goal p5@2]` → the scorer reads `#5 Alexiou · man-up`. A goal without a `playerId` → `celebration-scorer` is hidden.
  - `no celebration on load, on Undo, on a scorer change, for opponent goals, or on a final game`: load a game that already has goals → hidden after 1500 ms. Remove a goal → hidden. Replace a goal with the same id and another `playerId` → hidden. Add an `oppGoal` → hidden. Set the status to `final` and add a goal → hidden.
  - `reopening the viewer after goals were scored does not celebrate`: load, wait for the score, close the page. Add a goal through `update`. Open a new page in the same browser context → the new score shows and `celebration` is still hidden 1500 ms later.
  - `a second goal restarts the celebration with the new scorer`: goal `p5`, then a goal `p2` 800 ms later → the scorer reads `#2 Papadakis` and it is still visible 2000 ms after the second goal.
  - `the celebration survives a following update`: goal `p5`, then an `oppGoal` 500 ms later → still visible, and the score reads `1`–`1`.
  - `the overlay does not block the page`: while it's visible, `document.elementFromPoint` at the centre of the scoreboard's opponent name isn't inside `[data-testid="celebration"]`. A click on `celebration-banner` hides it.
  - `reduced motion shows only the banner`: after `page.emulateMedia({ reducedMotion: 'reduce' })`, a goal → the banner is visible and `.celebration-wave` and `.celebration-ball` aren't visible.
  - `no sideways scroll at 360 px during a celebration`: viewport 360×740, a goal → `scrollWidth <= clientWidth` while it's visible.
- [ ] **Step 2: Run them to make sure they fail.** Run the focused e2e on `tests/e2e/viewer-celebration.spec.js`. Expected: they FAIL (`celebration` is missing).
- [ ] **Step 3: Implement** `js/celebrate.js`, the wiring in `js/viewer.js` and the CSS. Add `'./js/celebrate.js'` to `SHELL`.
- [ ] **Step 4: Run the tests and make sure they pass.** Run the focused e2e, then `npm test` and the full e2e. Expected: all pass.
- [ ] **Step 5: Commit.** Run `git add js/celebrate.js tests/e2e/viewer-celebration.spec.js && git commit -am "feat(viewer): water polo goal celebration"`.
