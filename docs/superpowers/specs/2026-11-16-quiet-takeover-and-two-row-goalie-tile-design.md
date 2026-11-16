# Quiet takeover when no game is live, two-row goalie tile — design

**Date:** 16/11/2026 · **Status:** approved by the owner (short design) · **Size:** small change, two parts

## Why

- The "Tracking moved to another device" banner stays on the device not in control even when no
  game is live, which reads as stuck (owner, after testing with a desktop and a phone).
- Goalie tiles are about 85 px taller than player tiles; the owner wants every tile to be two rows
  (head + one button row) with the rare goalie actions tucked away.

## Part 1 — No banner while no game is live

### Goals
- While the current game is not live, the device not in control shows no takeover banner and keeps
  its controls enabled; the first touch or key press in the tracker takes control quietly, so the
  change it starts is saved normally.
- While the current game is live: exactly as today (banner, disabled controls, explicit Take over).

### Anti-goals
- Two open devices taking control back and forth on their own (control moves only on user input).
- A change made while not in control turning into failed taps.

### Design (`js/tracker/app.js`)
- "Game live" = the current game is loaded and its status is `live`. While the current game is not
  loaded yet, treat it as live (conservative: no quiet takeover).
- Read-only (banner shown, `[data-write]` controls disabled) = in a route, not in control, and
  (game live **or** offline). Offline and not in control therefore stays as today.
- Quiet takeover: a capture-phase `pointerdown` / `keydown` listener on the tracker root. When in a
  route, the editor is valid, this device is not in control, no game is live, the device is online
  and no quiet takeover is already in flight: set `state.control.activeUid` to this device's uid at
  once (so the click that follows already sees the device as active), render, and write the
  takeover with the existing `takeOver()` error handling (refused → code changed). The server
  snapshot then confirms or corrects it.
- Nothing else changes: stats drain on becoming active, journal, rules.

## Part 2 — Two-row goalie tile

### Goals
- A goalie tile has the same height as a player tile in every state: a head row and one 64 px
  button row.
- Head: cap · name (one line, "…" when long) · the in-goal slot · saves count · foul pips. The
  in-goal slot replaces the GK badge: the IN GOAL badge on the goalie in goal, an **In goal**
  button in the same spot on the other goalie. The saves count ("3 saves", "3 saves · 1 pen")
  replaces the goals count; a goalie's own goals no longer show on the tile (they stay in the
  Events sheet and the viewer).
- Button row: **SAVE** | **Pen save** | **⋯**, in the same columns as a player's Goal | Excl | Pen.
- ⋯ opens a small sheet (the existing `createOverlay`, like the Events and lineup sheets) titled
  with the goalie's cap and name, with full-size **Goal**, **Exclusion** and **Pen** buttons and
  Close; choosing one records it through the tapper and closes the sheet.

### Keeps from today
- Order: goalie in goal first, field players, the other goalie last; field tiles never move.
- After a goalie change made with this device's goalie buttons (In goal in the head, or SAVE /
  Pen save on the other goalie): SAVE, Pen save and the In goal buttons pause for 1 s and the page
  scrolls to the top.
- Shootout: SAVE hidden but keeps its space. OUT goalie: everything disabled, ⋯ included.
  Read-only device: ⋯ disabled like the other buttons.

### Removed
- The IN GOAL / saves line under the head and the 36 px Goal / Excl / Pen row on goalie tiles
  (from `2026-11-16-goalie-order-timeline-saves-design.md`).

## Approaches

| Option | Trade-off |
|---|---|
| **Quiet takeover on the first touch or key press (chosen)** | Works for every change without touching each view; control never moves without user input. |
| Take control when the tracker is opened or focused | Rejected: two visible devices would take control back and forth. |
| Take control inside each write call | Rejected: views journal a change before writing, so a refused takeover would leave failed taps; touches every view. |

| ⋯ menu option | Trade-off |
|---|---|
| **Small sheet with the existing overlay (chosen)** | Reuses focus handling, Escape and Close; buttons stay full-size and in thumb reach. |
| Menu floating next to ⋯ | Rejected: new positioning code; can spill off the right edge at 360 px. |
| Native select | Rejected: no button colours, platform-specific look. |

## Constraints

- Strings in `js/strings.js`; no new JS files. `live.js` may import only exports that already
  exist in today's modules (`createOverlay` does), so a phone mixing cached files still loads.
- Deploy only when no game is live; afterwards open tracker and viewer once on Wi-Fi on every phone.

## Left to the builder

- Exact head layout at 360 px, the ⋯ glyph and its accessible name, test ids for the sheet.
- Tests: e2e for both parts — no banner and quiet takeover with no live game (including a change
  saved by the device that was not in control), banner unchanged during a live game, offline stays
  read-only, no control change without input; goalie and player tiles equal in height (in goal,
  not in goal, OUT, long name, shootout; 360 px and 800 px), ⋯ sheet records goal / exclusion /
  pen, pause and order unchanged. Existing tests that use the banner with no live game get a live
  game or the new expectation.
