# Man-up, man-down and penalty fouls — Design

Date: 14/11/2026
Status: approved 14/11/2026
Extends: `2026-11-13-waterpolo-scoretracker-design.md` (the base design). Where
this document and the base design disagree, this one wins. It replaces the
base non-goal "stats beyond goals and exclusions" for the stats listed here.

## Intent

Man-up conversion (scoring while the opponent has a player excluded) is
something the team works on in training. The owner wants to see, per game
and across the season, how many man-ups we played and how many we scored,
and watch that percentage climb from game to game. Man-down (our player
excluded) is the mirror: how many we survived without conceding.

The person tracking is alone on the pool deck, one-handed, under time
pressure. The base design's priorities still hold: one tap per event,
nothing lost, every mistake visible and fixable.

## Goals

1. **Man-up tracking.** The tracker opens a man-up with one tap when an
   opponent is excluded. It ends as **scored** (our goal), or **missed**
   (closed by hand, or by any of the auto-close events below).
2. **Man-down tracking.** Our existing EXCL tap opens a man-down with no
   extra tap. It ends as **conceded** (opponent goal), or **stopped**
   (closed by hand, our goal, or any other auto-close event).
3. **Hard to forget.** While either is open, the whole tracker Live page is
   tinted (man-up and man-down in clearly different colours) and a running
   seconds counter shows how long it has been open. After about 40 s the
   counter pulses. There is no timer-based auto-close: the game clock stops
   often, so 20 s of play can be a minute of real time.
4. **Penalty fouls.** A new PEN button per player, next to EXCL. It counts
   toward the 3-foul limit (OUT) but does not open a man-down.
5. **Numbers on the viewer.** This game's man-up and man-down figures in the
   game section; season totals and each game's figures in the season
   section, so the trend is visible game by game.

## Non-goals

- Penalties won/scored as a team stat, timeouts, sprints, shots, saves,
  steals, turnovers, assists, blocks. (Discussed and left out of this round.)
- Showing per-player man-up goals. The data is there (the goal tap names the
  scorer); displaying it is a later request.
- A trend chart. The per-game figures in the results list are the trend for
  now.
- Backfilling games played before this change.
- A timer that closes a man-up or man-down by itself.

## Anti-goals

- A man-up or man-down that is open without it being obvious on the
  tracker screen.
- Made-up numbers: any game that was not tracked with this feature
  contributing man-up or man-down figures (see "Games tracked before this
  change").
- A double tap that opens and immediately closes a man-up.
- An extra tap for the common case: EXCL must stay one tap and open the
  man-down by itself.
- A cluttered viewer timeline full of "man-up missed" lines.

## Constraints

- Everything in the base design's Constraints still applies (static site,
  no build step, Firestore Spark plan, iOS Safari / Android Chrome, Europe/Athens,
  DD/MM/YYYY).
- **One real game exists**: vs ΡΟΗ, 14/11/2026, final, 19–10, 5 exclusions,
  season 2026-27. It was tracked before this feature. It must keep its score,
  goals and exclusions exactly as they are and must not produce man-up or
  man-down figures.
- Deploy only when no game is live. A viewer or tracker tab left open on the
  old code would mislabel the new event types until it reloads; the service
  worker is network-first, so a reload picks up the new code.
- Firestore rules need no change: game writes are already open to the active
  tracker with no event-shape validation.

## Approaches considered

The owner handed the how to the builder; this was the builder's pick, with
the reasoning given to the owner on 14/11/2026.

| Option | Trade-off |
|---|---|
| **Situations as events in the game's `events` array; open state and outcomes derived from them (chosen)** | Same mechanism as goals and exclusions: journal, offline, retry, Undo, Events sheet and arrayUnion/arrayRemove all work unchanged. Survives a crash, reload or device takeover. The viewer can show MAN-UP live. Deleting or reassigning an earlier event re-derives the outcomes correctly. Costs a small replay function with edge cases. |
| One event written at close time with the outcome; open state kept on the phone | Rejected. A crash or takeover loses an open man-up; the viewer can't show it live; undoing the goal can't reopen it; the client would have to write extra events for every auto-close. |
| A `situation` field on the game doc plus outcome events | Rejected. Two records of the same thing that can disagree, especially when offline writes sync out of order. Breaks the base design's rule that everything shown is derived from `events`. |

## Design

### New events

Four new event types are added to `events` (names are the builder's; the
meanings are fixed):

| Event | Tapped by | `playerId` | Meaning |
|---|---|---|---|
| man-up start | MAN-UP button | none | An opponent was excluded; we are a player up. |
| man-up end | END MAN-UP · NO GOAL button | none | The man-up ended without our goal. |
| man-down end | END MAN-DOWN · STOPPED button | none | The man-down ended without their goal. |
| penalty foul | PEN on a player tile | that player | Our player gave away a 5 m penalty. Counts toward the 3-foul limit. |

The existing `excl` event also **starts a man-down**. There is no separate
man-down start event.

Events keep the existing shape (`id`, `type`, `period`, `ts`, optional
`playerId`) so `arrayRemove` and the journal work as today.

### Games tracked before this change

New games get a marker field at creation (for example `situations: true`;
name is the builder's). Only games with the marker produce man-up/man-down
figures. Games without it (today, only the ΡΟΗ game):

- show "—" for man-up and man-down in the viewer game section and in their
  results row;
- are left out of the season man-up/man-down totals;
- keep every other behaviour (score, goals, exclusions, timeline, player
  stats) unchanged;
- if reopened, show no MAN-UP button and no man-down banner on the Live
  screen. PEN still works there.

### Deriving situations (the rules)

A pure function replays a tracked game's events in `ts` order (ties keep
array order) and returns the list of closed situations with their outcomes,
plus the currently open situation, if any. Only periods 1–4 take part;
shootout events are ignored and no situation can be open in the shootout.

At most one situation is open at a time. For each event:

1. **Period change first.** If a situation is open and this event's period
   differs from the period the situation started in, the open situation
   closes (man-up → missed, man-down → stopped) before the event is handled.
2. Then:

| Event | Open man-up | Open man-down | Nothing open |
|---|---|---|---|
| our goal (any scorer, including unknown) | closes **scored** | closes **stopped** | — |
| opponent goal | closes **missed** | closes **conceded** | — |
| our exclusion | closes **missed**, then opens a man-down | stays open (same man-down) | opens a man-down |
| man-up start | (not reachable from the UI; ignore) | closes **stopped**, then opens a man-up | opens a man-up |
| man-up end | closes **missed** | ignored | ignored |
| man-down end | ignored | closes **stopped** | ignored |
| penalty foul | no effect | no effect | no effect |

After the last event, a situation that is still open is closed (man-up →
missed, man-down → stopped) if the game is final or the game's current
period differs from the period the situation started in. Otherwise it is
the open situation shown on the tracker and viewer.

End events that find nothing matching open (for example after the
exclusion that opened a man-down was deleted) are ignored, not errors.

Counts: **man-up played / scored** and **man-down played / stopped** count
closed situations only. An open situation is not in the numbers until it
closes, so the percentage doesn't dip during every man-up.

Because everything is derived, Undo and Events-sheet deletes need no special
handling: undoing a goal that closed a man-up reopens it; undoing a man-up
start removes the man-up; deleting an exclusion removes its man-down.

### Fouls and OUT

A player is OUT when exclusions + penalty fouls ≥ 3 (base design's limit).
Both count toward it. Per-player lines gain a penalty-foul count; the
"has something to show" filter for the viewer's Our players table includes
penalty fouls.

### Tracker: Live screen

```
 ░░ whole page tinted while a man-up (one colour) or man-down (another) is open ░░
 7 : 5   Man-up 2/4 · Man-down 3/4        [ Q3 ▸ ]
 ┌────────────────────────────────────┐
 │ 2  Papadakis     1 goal   ● ● ○    │   pips = fouls toward the 3
 │ [    GOAL    ] [ EXCL ] [ PEN ]    │
 └────────────────────────────────────┘
 [ MAN-UP ]              [ +1 OPPONENT GOAL ]
 [ UNDO: Man-up (Q3) ]   [ Events ]
```

- **PEN** sits next to EXCL, at least as large as EXCL (≥ 48 px) and
  visually distinct from it. Disabled when the player is OUT, like GOAL and
  EXCL. The fouls pips show penalty fouls distinguishably (for example a "P"
  pip).
- **Situation button** in the dock, one button whose role changes:
  - nothing open → **MAN-UP** (opens a man-up);
  - man-up open → **END MAN-UP · NO GOAL** with the running seconds;
  - man-down open → **END MAN-DOWN · STOPPED** with the running seconds.
  The running seconds count from the opening event's `ts`. After about 40 s
  they pulse.
  Opponent excluded during our man-down: the tracker ends the man-down,
  then taps MAN-UP (two taps; rare).
- After any tap, the situation button refuses taps for 1 s (same pattern as
  Undo and the period button), so a double tap can't open and close.
- **Tint**: the whole page background changes while a situation is open.
  Man-up and man-down use clearly different colours (owner's idea; green for
  man-up and red for man-down is the builder's proposal). Text, tiles and
  buttons must stay high-contrast for outdoor use.
- **Header figures**: this game's man-up and man-down numbers next to the
  score.
- Hidden or disabled in the shootout, and hidden for untracked games.
- **Undo** names the new events (e.g. "Undo: Man-up (Q3)", "Undo: End
  man-up (Q3)", "Undo: Penalty foul · #5 Name (Q3)").

### Tracker: Events sheet and past games

- The new events appear in the list with clear labels and can be deleted
  like any other event. Only goals have the scorer selector.
- **"Man-up goal" switch on goal rows** (tracked games, periods 1–4 only).
  It fixes a forgotten MAN-UP tap after the fact. Switching it on adds a
  man-up start in the same period with `ts` just before that goal's `ts`,
  so the replay counts a man-up played and scored. Switching it off removes
  that man-up start. The switch shows on when a man-up start sits
  immediately before the goal in the replay. A forgotten man-up that ended
  without a goal cannot be added afterwards: there is no event to attach it
  to.
- Goals added later from the sheet ("Add goal, scorer unknown") get the
  current `ts`, as today, so they land at the end of the replay. That is
  accepted.
- Any edit to a final game recomputes season stats, as today.

### Viewer: game section

```
 ANOG                    ● LIVE  Q3 · MAN-UP
              7 – 5
 Olympiacos                  14/11/2026
 Man-up    3/7 · 43%
 Man-down  4/6 stopped · 67%
```

- While a situation is open in a live game, the status line shows MAN-UP or
  MAN-DOWN.
- The man-up / man-down lines show this game's figures, derived live from
  the game's events. "—" for an untracked game.
- **Timeline**: goals scored on a man-up get a "man-up" tag; penalty fouls
  appear as their own line (player named). Man-up starts and ends, man-down
  ends and missed/stopped outcomes are not listed.
- **Our players** and the season **Player totals** tables get a Pen. column.

### Viewer: This season

```
 Man-up 21/60 · 35%      Man-down 40/58 stopped · 69%
 14/11  Olympiacos    9–7    MU 3/7  MD 4/6
 07/11  Vouliagmeni   6–10   MU 1/6  MD 2/5
```

- Season totals at the top, from tracked final games only.
- Each result row shows that game's figures ("—" when untracked).

### Season stats document

`stats/{season}` (written by the tracker on end / edit / reopen / delete, as
today) gains:

- team totals: man-up played and scored, man-down played and stopped
  (tracked final games only);
- per result: that game's man-up and man-down figures, or a "not tracked"
  marker;
- per player: penalty fouls.

The viewer still reads one stats doc, so viewer reads don't increase.

## Decided by the owner

- Man-up is a toggle: our goal while open closes it as scored; closing it
  by hand counts as missed.
- Man-down works the same way: opponent goal closes it as conceded.
- If a toggle is left open by mistake, the other tracked events close it:
  period change, game end, the situation flipping, the other side scoring
  (man-up → missed, man-down → stopped). Goals are tracked reliably, so this
  is enough; there is no timer-based close.
- A very visible open state: tint the whole page background while open.
- Penalty fouls get their own PEN button beside EXCL; it counts toward the
  foul limit and does not open a man-down.
- The figures appear on the viewer's game screen and over the season,
  because the team is working to raise the man-up percentage.
- Penalties (as a team stat), timeouts, sprints and shots are out of this
  round.
- The builder's approach (situations as derived events) and the handling of
  the pre-existing ΡΟΗ game ("—", left out of season totals) were accepted.
- A forgotten MAN-UP tap before a goal can be fixed afterwards with a
  "Man-up goal" switch on that goal's row in the Events sheet.

## Left to the builder

- Event type names, the marker field name, and the exact shape added to
  `stats/{season}`.
- Exact tint colours and pulse styling (within: distinct colours, high
  contrast outdoors, works portrait and landscape).
- Exact wording of new strings (all in `js/strings.js`).
- How "0 of 0" is shown for a tracked game with no man-ups (e.g. "0/0" with
  no percentage).
- Where the header figures sit on narrow phones.
- Test approach. Expected: unit tests for the derivation rules (every cell
  of the table above, period change, final game, untracked game, deleted
  opener, Undo, the Man-up goal switch), foul limit with penalty fouls,
  season aggregation; e2e for the Live situation button, tint, PEN, the
  Man-up goal switch, and the viewer figures.
