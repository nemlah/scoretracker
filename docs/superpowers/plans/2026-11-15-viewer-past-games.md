# Viewer past games Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Season results rows on the viewer open that game at `#/game/<id>`. The page gets a back link, a marked row, and a live banner while another game is live.

**Architecture:** A hash route in `js/viewer.js` picks which game the existing `game` subscription follows: the routed id, or `team.currentGameId` when there's no route. While a routed game that isn't the current game is open, a second subscription (`live`) watches the current game for the banner. Rendering, the season follow and the celebration watcher stay as they are.

**Tech Stack:** Plain ES modules (no build), Firestore Web SDK 12.19.0, Playwright e2e against the emulators.

**Spec:** `docs/superpowers/specs/2026-11-15-viewer-past-games-design.md`

## Global Constraints

- Viewer only (`js/viewer.js`, `css/viewer.css`, `js/strings.js`, `tests/e2e/`). No tracker files.
- The route format is exactly `#/game/<gameId>`. Any other hash, or none, means the current game.
- New strings (exact): `backToCurrent: '← Back to current game'`, `liveBanner: 'Live: {opponent} {us}–{them} · {period}'`, `watchLive: 'Watch'`, `gameUnavailable: 'That game isn\'t available.'`, `openGameFor: 'Open the game against {opponent} on {date}'`.
- No new named imports from `model.js` or `strings.js` for functions added after the last release (`t()` and existing functions are fine).
- It works at a 360 px wide viewport without sideways scrolling.
- Commands:
  - unit: `npm test`;
  - focused e2e: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npx firebase emulators:exec --only firestore,auth --project demo-scoretracker "playwright test tests/e2e/viewer-past-games.spec.js"`;
  - full e2e: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:e2e`.

## Review Focus

1. **The live game ends while a past game is open.** Expected: the banner disappears and the page stays on the past game. → test `the live banner appears, updates, and leaves when the live game ends`.
2. **A route to the current game's own id.** Expected: it behaves exactly like no route: no banner, and no back link. → test `a route to the current game shows no back link or banner`.
3. **Moving from a past game back to a live game whose score changed meanwhile.** Expected: no celebration on arrival, and a celebration for the next new goal. → test `returning to the live game does not celebrate old goals`.
4. **A deleted game id in a shared link.** Expected: the unavailable message, not the "No game yet" empty state. → test `a link to a deleted game says it isn't available`.
5. **The open game's season differs from the current season.** Expected: the season tables follow the open game, which is the existing `followSeason` behaviour. → covered by the existing viewer.spec season-follow test; keep it green.

---

### Task 1: Hash-routed past games with back link, marked row and live banner

**Files:**
- Modify: `js/viewer.js` (route parsing, `followTeam`, a second subscription for the banner, `resultsTable`, render), `css/viewer.css`, `js/strings.js` (the strings above)
- Create: `tests/e2e/viewer-past-games.spec.js` (setup copied from `tests/e2e/viewer.spec.js`)

**Interfaces:**
- `routeGameId(hash) → string | null` is a function inside `viewer.js`. `'#/game/abc'` gives `'abc'`; everything else gives `null`. It listens for `hashchange`.
- The followed game id is `routeGameId(location.hash) ?? team.currentGameId`.
- A route equal to `team.currentGameId` counts as no route. In that case there's no back link and no banner.
- Results rows:
  - the opponent cell becomes `<a href="#/game/<gameId>" data-testid="result-link">` with `aria-label` from `openGameFor`;
  - the row of the open game gets `aria-current="page"` and class `is-open`.
- Back link: `a[data-testid="back-to-current"][href="#/"]`, shown while a non-current game is open (unavailable included).
- Live banner: `[data-testid="live-banner"]` with text from `liveBanner` (`{period}` via `periodLabel`) and a link `[data-testid="watch-live"][href="#/"]`.
  - It shows only while a routed, non-current game is open and the current game's `status === 'live'`.
  - It updates live through a second subscription to `team.currentGameId`, which is dropped when it isn't needed.
- Unavailable: a routed game whose snapshot is `null` from the server shows `[data-testid="game-unavailable"]` (`gameUnavailable`) instead of the empty state.
- On every route change, `window.scrollTo(0, 0)`.

- [ ] **Step 1: Write the failing e2e tests** in `tests/e2e/viewer-past-games.spec.js`. Seed `team/main` with `currentGameId:'g2'`, a final game `g1` vs 'Rivals' (lineup and events including a goal), a game `g2`, and `stats/{season}` with results for both.
  - `a results row opens that past game and the back link returns`: click the `result-link` for `g1` → the URL hash is `#/game/g1`, the opponent reads 'Rivals', the `final-badge` is visible, and `back-to-current` is visible. Click it → the hash is `#/` and the scoreboard shows `g2`.
  - `a shared #/game link opens that game directly`: `goto('/?emulator=1#/game/g1')`, or whatever the viewer URL is in viewer.spec.js plus the hash.
  - `the open game is marked in the results list`: the `g1` row has `aria-current="page"`.
  - `browser back returns to the current game`: open `g1` from its row, then `page.goBack()` → `g2` is shown.
  - `the live banner appears, updates, and leaves when the live game ends`: `g2` is live. Open `g1` → `live-banner` contains `g2`'s opponent and score. `update` adds a goal to `g2` → the banner score changes. Set `g2.status` to `final` → the banner is hidden, and the page still shows `g1`.
  - `Watch opens the live game`
  - `a route to the current game shows no back link or banner`: `#/game/g2` with `g2` live.
  - `a link to a deleted game says it isn't available`: `#/game/nope` → `game-unavailable` and `back-to-current` are visible, and `empty-state` is hidden.
  - `returning to the live game does not celebrate old goals`: `g2` is live. Open `g1`, add a goal to `g2`, click `watch-live` → `celebration` stays hidden 1500 ms later. Then add another goal → `celebration` becomes visible.
  - `no sideways scroll at 360 px with the banner and back link showing`
- [ ] **Step 2: Run them to make sure they fail.** Run the focused e2e. Expected: FAIL (`result-link` doesn't exist).
- [ ] **Step 3: Implement** in `js/viewer.js`, `css/viewer.css` and `js/strings.js`. Reuse `resubscribe` (key `'live'` for the banner subscription) and the existing render path.
- [ ] **Step 4: Run the tests and make sure they pass.** Run the focused e2e, then `npm test` and the full e2e. Expected: all pass, including viewer.spec.js, viewer-celebration.spec.js (the mixed-cache test too) and offline.spec.js.
- [ ] **Step 5: Commit.** Run `git add tests/e2e/viewer-past-games.spec.js && git commit -am "feat(viewer): open past games from the results list"`.
