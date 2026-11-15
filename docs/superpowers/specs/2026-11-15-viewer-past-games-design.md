# Viewer: open past games from the results list — Design (short)

Date: 15/11/2026
Status: approved 15/11/2026
Extends the viewer designs of 13/11 and 14/11/2026. Viewer only.

## Intent

Fans and the team want to look back at earlier games' stats (timeline,
players, man-up/man-down, goalkeepers) from the public viewer, not only the
current game.

## Goals

- Each row of "This season" results is a link that opens that game in the
  same view the current game uses.
- A past game has its own address, `#/game/<gameId>`, so it can be shared;
  the browser's back button returns to where the viewer was.
- While a past game is open: a "← Back to current game" link; the results
  row of the open game is marked.
- If another game is live while a past game is open, a banner at the top
  shows the live score and period with a **Watch** link. The page never
  jumps away by itself.
- A link to a game that no longer exists shows "That game isn't available."
  with the back link.
- Opening a game scrolls to the top.

## Non-goals

- Games from earlier seasons (needs a season picker; later).
- Any change to the tracker.
- Listing games anywhere other than the season results.

## Constraints

- Opening a past game costs one Firestore read plus updates while open; the
  viewer still never queries the `games` collection.
- The goal celebration never fires for a past (final) game, nor when moving
  between games (the existing watcher already resets on a game switch).
- The season section follows the open game's season (existing behaviour).
- New strings in `js/strings.js`; no new named imports from `model.js` /
  `strings.js` for new functions in `viewer.js` (mixed-cache safety).
- Works at 360 px without sideways scroll; links are real `<a href>` so
  keyboard and screen readers work.

## Approaches considered

| Option | Trade-off |
|---|---|
| **Hash route in the existing viewer page, `#/game/<id>` (chosen)** | One page, no new files, shareable, back button works, offline shell unchanged. |
| A separate `game.html?id=` page | Rejected: duplicates the viewer's rendering and subscriptions, and needs adding to the offline shell. |
| Query string on `index.html` | Rejected: changing it reloads the page and restarts the Firestore client on every tap. |

## Decided by the owner

- Approved the proposed design as shown: links on results rows, shareable
  address, back link, live banner with Watch, this season only.

## Left to the builder

- Exact markup and styling of the link rows, the marked row and the banner
  (high contrast; the banner must not cover the scoreboard).
- Exact copy (in `js/strings.js`).
- Test approach: e2e for opening from a row, a direct shared link, the back
  link and browser back, the marked row, the live banner (appears, updates,
  Watch works, absent when nothing else is live), the unavailable message,
  no celebration on opening a past game, no sideways scroll at 360 px.
