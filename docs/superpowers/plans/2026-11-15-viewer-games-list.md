# Viewer games list Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The viewer lands on the live game when one is live, and on a games list otherwise. The list also lives at `#/games`. Every game view has an "← All games" link. A watched game that ends stays on screen as `#/game/<id>`.

**Architecture:** Extend the hash routing that the past-games change added to `js/viewer.js`.
- `parseRoute(hash)` returns `home`, `games`, `game` or `invalid`.
- `viewMode()` gains a `'list'` mode. On `home` it picks `'game'` or `'list'` from the current game's `status`.
- The `live` subscription (the banner's source) runs whenever the current game isn't the game on screen, list mode included.
- The rule "a route to the current game counts as no route" is removed: `#/game/<id>` always shows that game.

**Tech Stack:** Plain ES modules (no build), Firestore Web SDK 12.19.0, Playwright e2e against the emulators.

**Spec:** `docs/superpowers/specs/2026-11-15-viewer-games-list-design.md`. Context: `docs/superpowers/specs/2026-11-15-viewer-past-games-design.md`.

## Global Constraints

- Viewer only (`js/viewer.js`, `css/viewer.css`, `js/strings.js`, `tests/e2e/`). No tracker files.
- Routes:
  - `#/` or no hash = home;
  - `#/games` = list;
  - `#/game/<id>` = that game. Invalid or malformed ids are unavailable, using the existing `validDocId` / `INVALID_ROUTE`.
  - Any other hash means home.
- Strings (exact). `allGames: '← All games'` replaces `backToCurrent`; delete `backToCurrent` once nothing uses it. The test id becomes `all-games`, which replaces `back-to-current`, with `href="#/games"`.
- **A watched game ending:** while on home showing the live current game, the moment that game's `status` becomes `'final'`, call `history.replaceState(null, '', '#/game/' + encodeURIComponent(id))`. Then run `follow()` and `render()` yourself, because `replaceState` fires no `hashchange`. The page keeps showing that game.
- **No new named imports** from `model.js` or `strings.js` for functions added after the last release. Use `t()` for new strings.
- **Reads:** one per opened game. The banner's `live` subscription watches only `team.currentGameId`, and only while that game isn't the one on screen.
- **Layout:** it works at a 360 px viewport without sideways scrolling.
- **Commands:**
  - unit: `npm test`;
  - focused e2e: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npx firebase emulators:exec --only firestore,auth --project demo-scoretracker "playwright test <files>"`;
  - full e2e: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:e2e`.

## Review Focus

1. **A watched live game ends.** Expected: the final score stays, the URL becomes `#/game/<id>` with no extra history entry (Back leaves the site, or goes wherever it went before), and a reload shows the same game. → test `a watched game that ends stays on its final score`.
2. **Home loads while the current game's snapshot is still on its way.** Expected: `'loading'`, with no flash of the list before the live game. → test `home with a live game never flashes the list`.
3. **A new game starts while someone is on the list** (`team.currentGameId` changes to a live game). Expected: the banner appears on `#/games`. On home, the page switches to the live game; that's the landing rule, not a jump away from something being watched. → test `a game starting while on the list shows the banner, and home shows it live`.
4. **Celebrations.** Expected: they fire only for the live game on screen. Never on the list, on `#/game/<other>`, or when arriving at the live game. → test `no celebration on the list; celebrations still fire on the live game`.
5. **Existing tests that assumed a final current game lands on the game view.** Expected: they're updated to open `#/game/<id>`, and their assertions are otherwise unchanged. → Step 1 below.

---

### Task 1: Games list landing, `#/games`, All games link, staying on an ended game

**Files:**
- Modify:
  - `js/viewer.js`: `routeGameId` becomes `parseRoute`, plus `pastGameId`, `followedGameId`, `follow`, `viewMode`, `render`, `renderPastNav` and the back link;
  - `css/viewer.css`: the list header and the All games link;
  - `js/strings.js`.
- Test: `tests/e2e/viewer-games-list.spec.js` (new; setup copied from `tests/e2e/viewer-past-games.spec.js`), plus the existing `tests/e2e/viewer.spec.js`, `tests/e2e/viewer-past-games.spec.js` and `tests/e2e/viewer-celebration.spec.js` where the landing behaviour changed.

**Interfaces (inside `js/viewer.js`):**
- `parseRoute(hash)` returns:
  - `{ kind: 'home' }`;
  - `{ kind: 'games' }`;
  - `{ kind: 'game', id }`;
  - `{ kind: 'invalid' }`.
- Followed game:
  - for a `game` route, its id;
  - for `home` and `games`, `team.currentGameId`, so the landing decision and the banner can use it.
- `viewMode()` returns `'loading' | 'list' | 'game' | 'unavailable' | 'empty'`:
  - `games` route: `'list'`, or `'empty'` when there's no current game and no season results;
  - `home`: `'game'` when the current game is `live`, `'list'` when it's final, `'empty'` when there's none, and `'loading'` until the current game snapshot is settled;
  - `game` route: `'game'`, or `'unavailable'` for a settled `null`;
  - `invalid`: `'unavailable'`.
- **List mode** shows a list header `[data-testid="games-list"]` with the team name (`h1`), hides the scoreboard and game sections, and shows the season section (results rows with their `result-link` links, unchanged) as the content.
- **Banner** (`live-banner` / `watch-live`, `href="#/"`): shown when the current game is live and the screen isn't showing it. That covers list mode and a `game` route for another game.
- **`all-games` link:** shown in `'game'` and `'unavailable'` modes, hidden in `'list'`.

- [ ] **Step 1: Update the existing tests to the new landing.**
  - Find every viewer e2e that seeds a *final* current game and expects the game view at the landing page. Change its `goto` to `#/game/<id>`, and change nothing else in it. Record the list of changed tests in your report.
  - In `viewer-past-games.spec.js`: `back-to-current` becomes `all-games` with `href="#/games"`. Update `a route to the current game shows no back link or banner`: `#/game/<currentId>` now shows the game and the `all-games` link, and no banner (the current game is the one on screen).
- [ ] **Step 2: Write the failing e2e tests** in `tests/e2e/viewer-games-list.spec.js`. Seed `team/main.currentGameId`, games and `stats/{season}` results with the helpers.
  - `home with a final current game shows the games list`: `games-list` is visible, the `scoreboard` is hidden, there's one `result-link` per result, and `all-games` is hidden.
  - `home with a live current game shows the live game`: the scoreboard shows the live score, `all-games` is visible, and there's no banner.
  - `home with a live game never flashes the list`: poll every 50 ms from load until the score shows. `games-list` is never visible.
  - `#/games shows the list and the live banner while a game is live`: `watch-live` goes to the live game.
  - `the All games link opens the list from a past game and from the live game`
  - `a watched game that ends stays on its final score`: on home with the live game, `update` sets `status: 'final'`. The `final-badge` shows, the hash becomes `#/game/<id>`, and `history.length` is unchanged. After `page.reload()` the same game is still shown.
  - `a game starting while on the list shows the banner, and home shows it live`: on `#/games`, update `team/main.currentGameId` to a new live game → the banner appears. `goto('#/')` → the live game is shown.
  - `no celebration on the list; celebrations still fire on the live game`
  - `no games at all shows the empty state`
  - `no sideways scroll at 360 px on the list with the banner`
- [ ] **Step 3: Run them to make sure they fail.** Run the focused e2e on `tests/e2e/viewer-games-list.spec.js`. Expected: FAIL (`games-list` doesn't exist).
- [ ] **Step 4: Implement** in `js/viewer.js`, `css/viewer.css` and `js/strings.js`. Reuse `resubscribe` and the existing render path.
- [ ] **Step 5: Run the tests and make sure they pass.** Run the focused e2e, then `npm test` and the full e2e. Expected: all pass, including viewer, past-games, celebration (with the mixed-cache test) and offline specs.
- [ ] **Step 6: Commit.** Run `git add tests/e2e && git commit -am "feat(viewer): games list between games, #/games, All games link"`.
