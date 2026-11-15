# Viewer quarter scores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A final game's scoreboard shows the score per quarter on one line: `Q1 2–3 · Q2 1–4 · Q3 3–3 · Q4 2–3`.

**Architecture:** One new persistent scoreboard element in `js/viewer.js`, filled in `renderGame` from `game.events` (like the shootout line), hidden on live games. Counting is a small local helper in `viewer.js`.

**Tech Stack:** Plain ES modules (no build), Firestore Web SDK 12.19.0, Playwright e2e against the emulators.

**Spec:** `docs/superpowers/specs/2026-11-15-viewer-quarter-scores-design.md`.

## Global Constraints

- Viewer only (`js/viewer.js`, `css/viewer.css`, `tests/e2e/`). No tracker, `model.js` or `strings.js` changes.
- Exact text: quarters joined by ` · ` (space, middle dot U+00B7, space); each quarter is `periodLabel(q) + ' ' + us + '–' + them` with an en dash U+2013 and no spaces around it, e.g. `Q1 2–3`. Always Q1–Q4; empty quarter `0–0`. Our goals first.
- Counting: `type === 'goal'` → us, `type === 'oppGoal'` → them, `period` 1–4 only. `'SO'` events are excluded.
- Shown only when `game.status === 'final'`; hidden (and empty) on live games.
- Test id `quarter-scores` on the line; each quarter in its own element so a line wraps only between quarters (`white-space: nowrap` per quarter).
- No new named imports in `viewer.js` from `model.js` or `strings.js` (`periodLabel` is already imported).
- 360 px viewport: no sideways scroll.
- Commands:
  - unit: `npm test`;
  - focused e2e: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npx firebase emulators:exec --only firestore,auth --project demo-scoretracker "playwright test <files> --reporter=list"`;
  - full e2e: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npx firebase emulators:exec --only firestore,auth --project demo-scoretracker "playwright test --reporter=list"`.

## Review Focus

1. The quarters always add up to the score shown (shootout excluded). → test `quarter scores on a final game`.
2. Hidden on a live game; appears the moment a watched game ends, without a reload. → test `quarter scores appear when a watched game ends`.
3. No sideways scroll at 360 px with double-digit quarters and a long opponent. → test `quarter scores wrap between quarters at 360 px`.

---

### Task 1: Quarter score line on final games

**Files:**
- Modify: `js/viewer.js` (new scoreboard element after `shootout`; fill/hide it in `renderGame`), `css/viewer.css` (the line and its quarters).
- Test: `tests/e2e/viewer-quarter-scores.spec.js` (new; setup copied from `tests/e2e/viewer-games-list.spec.js`).

- [ ] **Step 1: Write the failing e2e tests** in `tests/e2e/viewer-quarter-scores.spec.js`. Seed games with the existing helpers and open `#/game/<id>`.
  - `quarter scores on a final game`: goals in Q1, Q2 and Q4, none in Q3 → `quarter-scores` has text `Q1 2–1 · Q2 0–1 · Q3 0–0 · Q4 1–2` (adjust to the seeded events) and the quarter numbers add up to `score-us` / `score-them`.
  - `shootout goals are not in the quarter line`: a final game with `SO` goals → the line shows only Q1–Q4 counts and the `shootout` line is still shown.
  - `no quarter line on a live game`: `quarter-scores` is hidden.
  - `quarter scores appear when a watched game ends`: open the live current game at `#/`, then `update` the game to `status: 'final'` → `quarter-scores` becomes visible with the right text, no reload.
  - `quarter scores wrap between quarters at 360 px`: 360 px viewport, double-digit goals in every quarter, a long opponent name → no sideways scroll (`scrollWidth <= clientWidth`), and no quarter element is split across two lines (each quarter's bounding box height equals one line height).
- [ ] **Step 2: Run them and see them fail** (focused e2e on the new file). Expected: FAIL (`quarter-scores` doesn't exist).
- [ ] **Step 3: Implement** in `js/viewer.js` and `css/viewer.css`.
- [ ] **Step 4: Run the tests and see them pass**: focused e2e, then `npm test`, then the full e2e. Expected: all pass.
- [ ] **Step 5: Commit**: `git add tests/e2e && git commit -am "feat(viewer): score per quarter on final games"`.
