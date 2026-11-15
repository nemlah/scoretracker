# Viewer: score per quarter on a final game — Design (short)

Date: 15/11/2026
Status: approved 15/11/2026 (owner: "a go")
Viewer only.

## Intent

After a match, visitors want the usual water-polo result line: how each
quarter went, not only the final score. The final game page shows only the
total today. The game timeline is grouped by quarter, but it is a scrolling
list of goals and exclusions, so the quarter scores can't be read at a glance.

## Goals

- On a **final** game (any `#/game/<id>` showing a final game, including a
  watched game that has just ended), show one line under the score (and under
  the shootout line, when there is one):
  `Q1 2–3 · Q2 1–4 · Q3 3–3 · Q4 2–3`, with our goals first, as in the
  scoreboard.
- Always all four quarters; a quarter without goals shows `0–0`.
- Counts come from the game's events: `goal` → us, `oppGoal` → them, by
  `period` 1–4. Shootout goals (`period: 'SO'`) are not part of the line; the
  existing shootout line already shows them. The four quarters therefore
  always add up to the score shown.
- Works for every existing game; no data change.

## Non-goals

- Live games (asked for the final page only; the live view already has the
  timeline by quarter).
- Each player's goals per quarter (option B, not chosen).
- Any tracker change.

## Constraints

- Mixed-cache safety, as in the past-games design: no new named imports of
  new `model.js`/`strings.js` functions in `viewer.js`. The line uses the
  existing `periodLabel` for `Q1`–`Q4`; no new strings needed.
- 360 px without sideways scroll: a long line wraps between quarters, never
  inside one (`Q4 12–13` stays together).
- Persistent skeleton: the line is an element of the scoreboard, updated in
  place like the shootout line, hidden on live games.

## Approaches considered

| Option | Trade-off |
|---|---|
| **A. Team score per quarter, one line under the score (chosen)** | The line people look for after a match; fits a phone; reuses the score area. |
| B. Each player's goals per quarter as table columns | Adds four columns to a table already tight at 360 px. Not chosen. |

How it is built: worked out in `js/viewer.js` from the events the page
already has (builder's call, stated to the owner); no tracker or data change.

## Left to the builder

- Markup and styling of the line (muted, smaller than the shootout line).
- Test approach: e2e for a final game with goals in every quarter, an empty
  quarter, a shootout game, a live game (line hidden), a watched game ending
  (line appears), and 360 px with double-digit quarter scores.
