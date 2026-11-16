# Goalie tile order, smaller goalie buttons, saves in the timeline — design

**Date:** 16/11/2026 · **Status:** approved by the owner (short design) · **Size:** small change

## Why

- Tracker live screen: the goalie who is not in goal sits at the top and pushes the field
  players down (owner).
- Goal / Excl / Pen on goalie tiles are rarely used and take room (owner).
- Viewer: ordinary saves should appear in the game timeline (owner). Assumed reason: spectators
  follow the goalie's game, not only the goals.

## Goals

1. Live screen order: the goalie in goal first, then the field players by cap, then the other
   lineup goalie(s) by cap.
2. Goalie tiles: the Goal / Excl / Pen row is 36 px high instead of 48 px. SAVE, PEN SAVE and
   In goal keep their size.
3. Viewer game timeline: every ordinary save is its own row, in time order within its period,
   `✋ Save · #1 Τίμος`, in lighter text than goals. Penalty saves stay as they are.

## Non-goals

- Goalie changes (`gkIn`) in the timeline.
- Any change to events, stats, the journal, Firestore rules or the season tables.
- Changes to field-player tiles.

## Anti-goals

- A field tile moving when the goalie in goal changes, or the in-goal goalie's SAVE not being the
  first button on the screen.
- A quick second tap after In goal switching the goalie straight back.
- A phone holding a mix of old and new cached files showing saves as exclusions, or a blank viewer.

## Constraints

- Earlier designs' constraints apply: static site, no build step, strings in `js/strings.js`,
  iOS Safari / Android Chrome, deploy only when no game is live.
- Both goalie tiles keep the same height in every state (hidden buttons keep their space), so
  swapping them moves nothing else. This must stay true.
- Goalies can be excluded and commit penalty fouls (3 fouls = out), so Excl and Pen stay on
  goalie tiles; an OUT goalie keeps every button disabled, as today.
- Mixed cache: `js/viewer.js` must keep working beside the previous `js/model.js` and
  `js/strings.js` (namespace import with fallback, as in earlier releases).

## Approaches

| Option | Trade-off |
|---|---|
| **Goalie in goal on top, other goalie at the bottom (chosen)** | Field tiles never move; on a goalie change only the two goalie tiles swap ends. Needs a short In goal pause and a scroll to the top. |
| Both goalies on top, the one not in goal shrunk | Rejected: that tile changes height whenever the goalie changes, so every field tile moves. |
| Keep today's order, shrink buttons only | Rejected: a full goalie tile still sits above the field players. |

| Timeline option | Trade-off |
|---|---|
| **Each save its own row (chosen)** | Complete and in time order; about 8–15 extra rows a game (Steaua: 7). The timeline already scrolls. |
| One save summary line per period | Rejected: not what was asked, and loses when the saves happened. |

## Design

### Live screen order (`js/tracker/views/live.js`)

- Each render orders the tiles: the goalie in goal (`goalieStats(...).inGoal`), then field players
  by cap, then the other goalies by cap. No goalie marked: field players only, as today. One
  goalie: on top, as today. The existing "move a tile only when it is out of place" step keeps DOM
  identity.
- This replaces the goalies spec rule "the order never changes when the goalie in goal changes";
  its purpose (SAVE never lands on a moved button) holds because the field tiles stay put and the
  in-goal SAVE stays first.
- After an In goal tap on this device: every In goal button is disabled for 1 s (like the Undo and
  period locks), because the previous goalie's In goal button lands where the tapped one was; and
  the page scrolls to the top so the new goalie's SAVE is in view (smooth, instant under
  reduced motion). A goalie change that arrives another way (Events sheet correction, another
  device) reorders without scrolling.
- An OUT goalie still in goal stays on top until In goal is tapped on another goalie.

### Goalie tile buttons (`css/tracker.css`)

- The second row of `.tile-actions--goalie` (Goal / Excl / Pen) goes from 3rem to 2.25rem, with
  font sizes adjusted so the labels still fit at 360 px.

### Viewer timeline (`js/model.js`, `js/strings.js`, `js/viewer.js`, `css/viewer.css`)

- `timeline()` keeps `save` events (it still drops `gkIn` and the situation types).
- `timelineEntry()` renders a save like a penalty save: icon ✋, screen-reader text "Save", text
  `Save · #cap Name`, plus a flag the viewer uses to show the row in lighter text.
- `js/viewer.js` passes saves to `timeline()` only when the loaded `model.js` and `strings.js`
  support them (a flag read off the namespace import); otherwise it filters them out as today.

## Left to the builder

- Test ids, the exact lighter style for save rows, how the 1 s lock and the scroll are wired.
- Tests: unit (tile order, `timeline()` with saves, `timelineEntry` for a save); e2e (order with two
  goalies, swap on In goal leaves field tiles where they were, In goal pause, 36 px row at 360 px,
  save rows in the viewer timeline, viewer degrading beside an old `model.js` if the existing
  mixed-cache tests allow it).
