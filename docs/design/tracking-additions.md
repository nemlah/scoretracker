# Tracking additions: options note

Status: note for later, 19/11/2026. Not a design. Each item that changes what the tracker writes is a sync/data change, so it needs the full design + Codex design review route before a plan.

## Why

The redesigned viewer has a Team tab (game and season). Everything on it today is derived from events the tracker already records: goal, oppGoal, excl, pen, save, penSave, manUp / manUpEnd / manDownEnd, gkIn, each with its period (`js/model.js:7`). Three additions would add the most for the coach, cheapest first.

| # | Addition | What it adds to the Team tab | Taps for the scorekeeper |
|---|---|---|---|
| 1 | Penalty flag on our goals | Penalty goals for; "goals for" split into man-up / penalty / other | None live; a toggle in the Events sheet, like the man-up toggle |
| 2 | Sprint won / lost per quarter | Sprints 3/4 per game and per season | One tap at each quarter start |
| 3 | Shots (scored / missed / blocked / saved), per player | Shooting % per player and team, shots per quarter | One more tap on most of our attacks; only with a second scorekeeper |

Save % needs nothing new: saves and goals against are tracked, so it is already shots-faced based.

Not worth it with one scorekeeper: assists, steals/turnovers, timeouts. Time-based stats (minute of a goal, man-up length) are out of reach: `ts` is the phone's clock, not the game clock.

## Constraint that shapes all three: old phones read new data

Phones can run a mix of this release's and the previous release's files (network-first service worker, see the mixed-cache rules in the sonnet dispatch checklist). Today an unknown event type is not ignored:

- `js/strings.js` `eventLabel` / `timelineEntry`: anything that is not a known type falls through to the exclusion label, so an old viewer would show a sprint or a shot as "Exclusion".
- `js/journal.js:20` `validEntry` drops entries whose type is not in `EVENT_TYPES`, so a phone mixing an old `journal.js` with a new tracker would lose pending taps of a new type.

So a new event type needs a two-step rollout: first a release where every reader ignores unknown types (timeline, labels, stats, journal), then, after phones have it, the release that writes them. A new property on an existing event (or a new game field) avoids that: old readers ignore it.

## Options per addition (my recommendation first)

1. **Penalty goal:** a `pen: true` property on the goal event, set from the Events sheet with a `replace` journal op (the journal already supports `replace` and copies unknown properties). Old readers show it as a plain goal, which is correct. Alternative: a separate marker event like `manUp`: more moving parts for no gain.
2. **Sprints:** a `sprint` event type (`won` / `lost`, period), so it gets Undo, the Events sheet and the timeline for free; needs the tolerant-readers release first. Alternative: a `sprints` field on the game document (`{1: 'won', …}`): no rollout step, but outside Undo and the journal.
3. **Shots:** a `shot` event type with `playerId` and `result`, switched on per game like man-up tracking is today (`game.situations`, `isTracked` in `js/situations.js`), e.g. a "Detailed stats" toggle on New game. Needs the tolerant-readers release first. Season totals go into the `stats/{season}` recompute (`js/tracker/statsQueue.js`).

## Open questions for the owner

- Who would track shots: is there a second person at games?
- Should the sprint prompt appear by itself at each quarter start, or only as a button?
- Penalty goals for the season: only from games tracked after the change, or back-filled by hand in the Events sheet?
