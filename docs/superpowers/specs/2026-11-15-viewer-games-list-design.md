# Viewer: games list as the landing page between games — Design (short)

Date: 15/11/2026
Status: approved 15/11/2026
Extends `2026-11-15-viewer-past-games-design.md`. Viewer only.

## Intent

Today the public viewer opens on the team's current game, which stays on the
last game after it ends. Between games, visitors should land on a list of
games instead; during a game they should still land on the live game.

## Goals

- **Landing page (`#/` or no hash):**
  - a game is live (the team's current game has `status: 'live'`) → the live
    game, exactly as now;
  - otherwise (current game final, or no current game) → the **games list**.
- **Games list** (also at its own address `#/games`): the team name, then this
  season's results (each row a link to `#/game/<id>`, as now), then the
  season tables (man-up/man-down, player totals, goalkeepers). With no games
  at all, the existing "No game yet" empty state.
- **Live banner** ("Live: … · Q2 [Watch]") at the top of the games list, and
  of any game view other than the live game, while a game is live. Watch
  opens the live game.
- **"← All games" link** (to `#/games`) at the top of every game view — live,
  final or past — and on the unavailable message. It replaces "← Back to
  current game".
- **A game ends while someone watches it on the landing page:** the page
  stays on that game's final score and quietly becomes `#/game/<id>` (history
  replace, not a new entry), so a reload or share keeps showing it. The page
  never jumps to the list by itself.
- `#/game/<id>` shows that game whether or not it is the current game.

## Non-goals

- Older seasons (season picker), any tracker change, sorting/filtering the
  list.

## Constraints

- Everything in the past-games design still holds: one read per opened
  game, the live banner watches only the current game, celebrations only for
  the live game being viewed, unavailable message for missing/malformed ids,
  scroll to top on route change, 360 px without sideways scroll, mixed-cache
  safety (no new named imports of new `model.js`/`strings.js` functions in
  `viewer.js`; new strings via `t()`).
- Existing behaviour change, on purpose: opening the viewer while the
  current game is final now shows the list, not that game. Tests that relied
  on the old landing must open `#/game/<id>` instead.

## Approaches considered

| Option | Trade-off |
|---|---|
| **Extend the existing hash routes: `#/` decides live-game-or-list, `#/games` is the list, `#/game/<id>` a game (chosen)** | Reuses the route, subscriptions, banner and render path from the past-games change; one page; shareable. |
| A separate `games.html` list page | Rejected: duplicates the season rendering and subscriptions, and adds a file to the offline shell. |
| Point `team.currentGameId` at nothing when a game ends (tracker change) | Rejected: changes the data model, breaks the season follow, and doesn't give a list address. |

## Decided by the owner

- Option A: the landing page shows the live game during a game, the list
  otherwise.
- Approved the proposed details: `#/games` list address, "All games" link on
  every game view, banner on the list while a game is live, staying on the
  final score when a watched game ends.

## Left to the builder

- Markup and styling of the list header and the "All games" link.
- Exact copy (in `js/strings.js`).
- Test approach: e2e for each landing case, `#/games` with and without a live
  game, the All games link everywhere, a watched game ending (stays, URL
  becomes `#/game/<id>`, no history entry added), Watch from the list,
  celebrations unaffected, updated existing viewer tests.
