# Goalkeepers: saves, penalty saves, goals against — Design

Date: 15/11/2026
Status: approved 15/11/2026
Extends: `2026-11-13-waterpolo-scoretracker-design.md`,
`2026-11-14-man-up-man-down-design.md`,
`2026-11-14-viewer-icons-goal-celebration-design.md`. Where this document
and an earlier one disagree, this one wins.

## Intent

The team wants goalkeeper stats: how many shots and penalties each goalie
blocks, and a save percentage per goalie, per game and over the season.
The person tracking marks saves with one tap on the goalie's tile; the app
works out who was in goal when the opponent scored.

The base design's priorities still hold: one tap per event, nothing lost,
every mistake visible and fixable, tiles never move under a finger.

## Goals

1. **Goalie flag.** Each roster player can be marked as a goalie. New games
   copy the flag into the lineup; the in-game lineup sheet can change it.
2. **Goalie tiles on the Live screen** with **SAVE** (blocked shot) and
   **PEN SAVE** (blocked penalty), plus the usual Goal / Excl / Pen buttons
   (smaller) and, on a goalie who isn't in goal, an **In goal** button.
3. **Who is in goal** is always known: it starts as the goalie with the
   lowest cap, and changes when a goalie's SAVE, PEN SAVE or In goal is
   tapped. The tile of the goalie in goal is highlighted.
4. **Goals against** per goalie: every opponent goal counts against the
   goalie in goal at that moment.
5. **Save %** per goalie: (saves + penalty saves) ÷ (saves + penalty saves +
   goals against), periods 1–4 only.
6. **Shootout** kept apart: shootout penalty saves and shootout goals
   conceded don't enter save %; the viewer's game section shows
   "Shootout: X saved, Y conceded" (builder's call: missed or post shots
   aren't recorded, so "saved X of Y" would overstate the attempts).
7. **Viewer**: a Goalkeepers table in the game section and in the season
   section; penalty saves appear in the game timeline.
8. **Viewer fix (separate, small)**: no "(0 – 0 pen.)" line for a final game
   that has no shootout events, or for a results row with a 0–0 shootout.

## Non-goals

- Penalty attempts by our own players (scored / missed), and anything about
  the opponent's shooters. Deferred by the owner ("focus on goalies
  initially").
- Shots by our field players, shot locations, or goalie assists/steals.
- Listing ordinary saves in the viewer timeline (too many).
- Season shootout stats per goalie (the game section shows the shootout
  line; the season table doesn't).
- Backfilling games played before this change.

## Anti-goals

- Tiles reordering or resizing when the goalie in goal changes (a frequent
  SAVE tap must never land on a moved button).
- Goals against pinned on a goalie when no goalie is marked in the lineup
  (old games, or a game where nobody was marked): those games produce no
  goalie stats at all.
- A goalie tile so crowded that SAVE is hard to hit one-handed.

## Constraints

- Everything from the earlier designs' constraints applies (static site, no
  build step, Firestore Spark plan, iOS Safari / Android Chrome,
  Europe/Athens, DD/MM/YYYY, strings in `js/strings.js`, new JS files in
  `sw.js` `SHELL`).
- New event types must be added to `EVENT_TYPES` in `js/model.js` (the
  journal validates against it; an unknown type empties the whole journal).
- Event objects keep exactly `{ id, type, period, ts, playerId? }`.
- The viewer must keep degrading instead of blanking when a phone mixes old
  cached and new modules: new viewer logic lives in new modules or is used
  through the existing namespace-import-with-fallback pattern.
- Existing games (ΡΟΗ, Delfin) have no goalie in their lineups; they must
  render exactly as now (apart from the shootout-line fix).
- Deploy only when no game is live; afterwards open the tracker and the
  viewer once on Wi-Fi on every phone.
- Firestore rules need no change (no shape validation on team/games/stats).

## Approaches considered

The owner handed the how to the builder; this is the builder's pick.

| Option | Trade-off |
|---|---|
| **Taps as events in the game's `events` array; who's in goal, saves, goals against and save % derived from them (chosen)** | Same mechanism as goals, exclusions and man-ups: journal, offline, Undo, Events sheet and arrayUnion/arrayRemove work unchanged; deleting or undoing an event recomputes everything. |
| Counters on the game document | Rejected: Undo and Events-sheet deletes can't reverse them reliably; numbers can drift from the events. |
| A separate "goalie in goal" field on the game | Rejected: two records of one fact that can disagree when offline taps sync out of order. |

## Design

### Roster and lineup

- Roster entries gain `goalie: boolean` (absent = false). The roster screen
  shows a **Goalie** tick per player (add and edit).
- New game: the selection copies `goalie` from the roster; the lineup entry
  carries `goalie: true` only for goalies (field players' entries keep their
  current shape).
- In-game lineup sheet ("Edit lineup"): a Goalie tick per lineup player.
  Saving writes it to the game's lineup and back to the roster, the same way
  caps are written back as "last used".
- A player added to the lineup during a game brings the roster's flag.

### New events

| Event | Tapped by | `playerId` | Meaning |
|---|---|---|---|
| `save` | SAVE on a goalie tile | that goalie | A shot blocked. That goalie is now in goal. |
| `penSave` | PEN SAVE on a goalie tile | that goalie | A penalty blocked (in play or in the shootout). That goalie is now in goal. |
| `gkIn` | In goal on a bench goalie's tile | that goalie | That goalie is now in goal. |

(Names are the builder's; meanings are fixed.)

### Deriving goalie stats

A pure function replays a game's events in `ts` order (ties keep array
order). Goalies are the lineup entries with `goalie: true`; with none, the
result is "no goalie stats" and nothing else applies.

- **In goal** starts as the goalie with the lowest cap. `save`, `penSave`
  and `gkIn` set it to their `playerId`.
- Periods 1–4: `save` → +1 save; `penSave` → +1 penalty save; `oppGoal` →
  +1 goal against for the goalie in goal.
- Shootout (`'SO'`): `penSave` → +1 shootout save; `oppGoal` → +1 shootout
  goal conceded, for the goalie in goal. Shootout events don't enter save %.
- Save % = (saves + penalty saves) ÷ (saves + penalty saves + goals
  against); no shots faced → shown as "—".
- Events for a player who is no longer marked goalie still count for that
  player (the tracker refuses new ones; this only matters after a lineup
  edit).
- The current **in goal** is the result after the last event; the tracker
  and viewer show it.

### Tracker: Live screen

```
│ 1  Georgiou  GK · IN GOAL     7 saves · 1 pen │  ← highlighted
│ [      SAVE      ] [ PEN SAVE ]               │
│ [ Goal ] [ Excl ] [ Pen ]                     │
├───────────────────────────────────────────────┤
│ 13 Nikolaou  GK               0 saves         │
│ [      SAVE      ] [ PEN SAVE ] [ In goal ]   │
│ [ Goal ] [ Excl ] [ Pen ]                     │
├───────────────────────────────────────────────┤
│ 2  Papadakis …  (field players as today, by cap)
```

- Goalie tiles come first (by cap), then field players (by cap). The order
  never changes when the goalie in goal changes; only the highlight and the
  In goal button's visibility change, and both tile layouts keep the same
  size so nothing below moves.
- SAVE is the largest target on a goalie tile; PEN SAVE and In goal at least
  48 px; Goal / Excl / Pen keep at least 48 px.
- In the shootout SAVE is hidden (a shootout block is a PEN SAVE); PEN SAVE
  and In goal stay.
- A goalie who is OUT (3 fouls) has every button disabled, as today.
- Tap rules (tracker refuses otherwise): `save` / `penSave` / `gkIn` only for
  a lineup goalie who isn't OUT; `gkIn` only for a goalie not already in
  goal; `save` not in the shootout. The per-device duplicate guard applies.
- The tile shows the goalie's saves and penalty saves for this game.
- Undo and the Events sheet name the new events ("Save · #1 Georgiou",
  "Penalty save · #1 Georgiou", "In goal · #13 Nikolaou"); each is
  deletable.

### Tracker: Events sheet corrections

- **Goalie picker on `save` and `penSave` rows** (like the scorer picker on
  goals): lists the lineup goalies; choosing another one replaces the event
  with the same id and `ts` and the new `playerId`.
- **"In goal" picker on opponent-goal rows** (games with at least one lineup
  goalie): shows the goalie the replay has in goal for that goal. Choosing
  another goalie adds a `gkIn` for that goalie in the same period with `ts`
  = the opponent goal's `ts` − 1, so that goal and the following ones count
  against the chosen goalie until the next goalie event. Choosing the goalie
  that a correction-made `gkIn` (at exactly `ts` − 1) replaced removes that
  `gkIn` again instead of adding another.
- Both pickers are disabled when the device isn't the active tracker, and
  put themselves back if the write is refused (same pattern as the scorer
  picker).

### Viewer

Game section, below the existing figures:

```
 Goalkeepers          Saves  Pen  GA  Save %
 #1  Georgiou  ●         7    1   5    62%     ● = in goal (live games only)
 #13 Nikolaou            2    0   1    67%
 Shootout: 2 saved, 3 conceded                 (only when the shootout had a save or a goal conceded)
```

- Shown only when the game has at least one goalie in its lineup.
- Timeline: `penSave` events appear as their own line, "✋ Penalty saved ·
  #1 Georgiou" (✋, not gloves: water polo goalies play bare-handed).
  `save` and `gkIn` are not listed.
- Season section: a Goalkeepers table — Games (games where the player was a
  lineup goalie), Saves, Pen, GA, Save % — from final games only.

### Season stats document

`stats/{season}` gains `goalies: { [playerId]: { name, games, saves,
penSaves, goalsAgainst } }` (final games with at least one lineup goalie).
Old docs without it render without the season Goalkeepers table.

### Viewer shootout-line fix

- Game section: show the shootout score only when the game is live and in
  the shootout, or has at least one shootout event.
- Results rows: don't show a shootout score of 0–0.
- No data change; Delfin's "(0 – 0 pen.)" disappears.

## Decided by the owner

- Focus on goalies first; our shooters' penalty misses come later.
- Goalies are marked in the roster.
- Goalie tiles get blocked shot (SAVE) and blocked penalty (PEN SAVE).
- Option B: save % per goalie, with goals against attributed to the goalie
  in goal; a SAVE/PEN SAVE tap also marks that goalie in goal.
- Accepted the builder's proposals: lowest cap starts in goal; In goal
  button on the bench goalie; goalie flag editable in the in-game lineup
  sheet; Goalkeepers tables on the viewer (game and season); penalty saves
  in the timeline, ordinary saves not; shootout kept out of save %; the
  shootout-line fix.
- Correction tools in the Events sheet: a goalie picker on save rows and an
  "In goal" picker on opponent-goal rows (builder's recommendation; the
  owner replied "so?" to the question and the builder took it as go-ahead).

## Left to the builder

- Event type names; exact strings (in `js/strings.js`); the shape of the
  goalie flag on lineup entries beyond "true only for goalies".
- Exact goalie-tile layout within the constraints above (stable size,
  SAVE largest, ≥ 48 px targets), and how the in-goal highlight looks
  (high contrast outdoors, distinct from the man-up/man-down tint).
- Where the pure goalie-stats function lives (a new self-contained module is
  preferred, for the viewer's mixed-cache safety).
- Test approach. Expected: unit tests for the replay (start in goal, switch
  by save / penSave / gkIn, goals against attribution, shootout split,
  no-goalie games, Undo/delete), roster→lineup flag flow, season
  aggregation, tap rules; e2e for the roster tick, goalie tiles (no
  movement when in goal changes), the lineup sheet tick, the viewer tables,
  the timeline line, and the shootout-line fix.
