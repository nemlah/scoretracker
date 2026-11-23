# Competition per game + timeline quarter divider — design (23/11/2026)

Short design (small change, two parts). Owner decisions: B for friendlies; the quarter divider as proposed.

## Intent
- **Timeline.** A quarter start and one of our goals both render as a dark board chip with amber text and an "x–y" on the centre line. The quarter's x–y is the goals in that quarter, the goal's x–y is the running score, so they read alike and mean different things.
- **Competition.** Every game carries its competition (league, cup, tournament with a name, friendly), so friendlies stop distorting the season figures.

## Goals, non-goals, anti-goals
- **Goals:** pick the competition when a game is created and correct it later. Show it in the tracker and the viewer. Keep friendlies out of player totals, goalie totals, man-up/man-down, the Team tab and the W–L record.
- **Non-goals:** a viewer toggle; per-competition breakdowns; filtering the results list; managing a list of tournaments.
- **Anti-goals:** a friendly's goals showing up in season totals; existing games' stats changing without the owner re-tagging them; a quarter divider that could still pass for a goal row; a regression at 360 px or in dark mode.

## Approaches
- **Friendlies:** A, a viewer toggle that stores two aggregates; **B, a fixed rule (picked by the owner)**; C, one tracker-wide switch. B is the smallest build: no toggle UI, one aggregate, and friendlies stay visible in Results with a tag.
- **Timeline:** **a full-width divider (picked)** or a lighter restyle of the chip. The divider separates the two by shape, not colour alone, and leaves the dark amber chip to goals only.

## Design

### Data
- Game doc gains `competition: 'league' | 'cup' | 'tournament' | 'friendly'`, plus `competitionName` (trimmed, 1–40 chars) only when `competition === 'tournament'`, absent otherwise.
- A missing or unknown `competition` reads as `'league'` everywhere, through one helper in `js/model.js`. No migration: the owner re-tags past friendlies in game detail, and each save recounts the season through the existing `updateGameInfo` + `recountAfter` path.
- `aggregateSeason` skips friendlies for `players`, `goalies` and `situations`. `results` still lists every final game; a row carries `competition` (+ `competitionName`) only when it isn't league, so existing rows keep their shape.
- Firestore rules: unchanged (game writes are not field-validated).

### Tracker
- **New game, details step:** a Competition field after Season (my call: a native `<select>`, League · Cup · Tournament · Friendly). When Tournament is chosen, a required Tournament name field appears. Default: the previous game's competition and name, because tournaments come in runs of games. With no previous game, League.
- **Game detail info form:** the same two fields, with the same validation. A change recounts the season.
- **Tags:** past-games rows show the tag next to the date for anything but League ("21/11/2026 · Friendly", or the tournament's name). The detail meta always shows it ("21/11/2026 · 2026-27 · League").

### Viewer
- **Results row:** the tag goes in the meta line after the date, for anything but League (tournament → its name).
- **Game board:** the same tag in the board meta for non-League games, live or final.
- **Season:** the W–L record and the Team tab (`seasonTeamStats`) leave friendly rows out. The Players tab reads the already-filtered totals. When the season had friendlies, a muted line under the Players and Team panels says so (my call: "Friendlies not counted (n)").

### Timeline quarter divider
- `.tl-quarter` becomes a full-width row: a 1 px strong-line rule across the card (inset like the rows), with the existing "Q2 2–1" text centred on it on the card colour. Condensed caps, muted label, ink score, no board fill.
- Our goal pills keep the board/amber look, which is now unique to goals.
- The screen-reader text is unchanged. Check 360 px, light and dark, and the club colours red #c8102e and yellow #f2b705.

### Also
- New JS/CSS stays in `sw.js` SHELL; bump the cache to `wp-shell-v5`.
- Tests:
  - **Unit:** the competition helper (missing/unknown → league); `gameResult` carries the competition; `aggregateSeason` drops friendlies from players, goalies and situations but keeps them in results; `seasonTeamStats` skips friendlies (the W–L record is pinned by e2e).
  - **E2e:** create a Friendly → the viewer tags it and the totals leave it out; re-tag it in game detail → the season recounts; a tournament without a name is refused; the quarter divider has no board fill and differs from a goal pill.

## Left to the builder
- Divider CSS details and spacing.
- Exact tag placement inside the board meta.
- String wording beyond the four labels.
- Updating the canvas VGame board after the design-system re-sync, as a follow-up.
