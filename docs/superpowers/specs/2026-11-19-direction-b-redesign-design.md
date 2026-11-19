# Direction B redesign ("Shot Clock") — design

Date: 19/11/2026
Status: approved 19/11/2026 (owner: "go"). Approach picked 19/11/2026: three releases (owner: "1").
Apps: viewer (`index.html`, `js/viewer.js`, `css/viewer.css`) and tracker (`track.html`, `js/tracker/**`, `css/tracker.css`), shared `css/base.css`.

## Source of truth for the look

The design canvas: https://claude.ai/artifact/7yCTLzZXoQdD4UdnyXLGBb (private to the owner's claude.ai account).

- Page **Viewer**: every viewer state in light and dark (rows at y 0 and y 1800), the home-screen icon and the link preview.
- Page **Tracker**: live states, banners, toast, sheets, setup and history screens, landscape (light only).
- Page **Tokens**: colours with live contrast ratios, type scale, spacing, radii, touch targets, icons, logo and photo sizes.
- Page **Directions** keeps A/B/C for reference only; its B boards are older than pages 2–4. Where they differ, pages 2–4 win.

Board names below are the canvas file stems (e.g. `VGame`, `TLive`). Sample data on the boards is invented; the numbers are not requirements.

## Why

The owner wants the app to look like a pool-side scoreboard and to read faster during a game: score on a dark board with amber digits, a calm light deck for everything else, and action colours that don't depend on the club colour, so any club colour works. The viewer also gets a clearer structure (owner comments on the canvas, 19/11/2026):

- The "no game yet" screen made no sense; the default page should be the season, with a banner when a game is live.
- In the timeline the score jumped left and right; it should stay in one place.
- Quarters looked like sections, and the timeline was a fixed-height box; statistics should move to tabs so the timeline can grow.
- Man-up / man-down figures belong in a team statistics view, per quarter. Today they sit on the scoreboard, under the season heading and in each Results row.

## Goals

1. Direction B's look in both apps: tokens, fonts, scoreboard, controls, icons (Tokens page).
2. Viewer home is the season screen; a live game shows as a LIVE banner on top of it.
3. Game screen and home screen get tabs: game Timeline | Players | Team, home Results | Players | Team.
4. Timeline on a centre line: the score always in the middle column, our events left, theirs right, quarters as markers on the line.
5. Team tabs (game and season) built only from data the tracker records today.
6. Club logo shown (real crest) where the canvas shows it; home-screen icon and link preview.
7. Shipped in three releases, each safe on a phone that mixes this release's files with the previous release's.

## Non-goals

- Player photos. The canvas shows optional photo slots, but there is no photo storage. Ship the "photos off" state everywhere (cap chip in the club colour). Photo support is a later project.
- New tracking (penalty-goal flag, sprints, shots): see `docs/design/tracking-additions.md`.
- Tracker dark mode (the tracker stays light, as today).
- Changing what the tracker records, or control/sync behaviour.
- Page 1 (Directions) boards.

## Anti-goals

- A release that looks right on a fresh install but breaks for one load on a phone with a mixed cache.
- Colour as the only difference between two states (man-up vs man-down, ours vs theirs, out vs in).
- Text or controls below contrast (4.5:1 text, 3:1 large text, borders and bars) for any of the four test club colours: blue `#0057b8`, red `#c8102e`, yellow `#f2b705`, green `#00843d`.
- Sideways page scroll at 360 px, or a control under 44 px.

## Approaches considered

1. **Three releases (picked).** R1 the look on today's structure (CSS first), R2 the viewer structure (routing, tabs, timeline, Team tabs), R3 tracker details that need markup changes. Each release is small enough to review, and R1 is nearly mixed-cache-proof because class names stay.
2. Two releases (whole viewer, then tracker). Fewer deploys, but a large first diff, and `css/base.css` is shared, so the tracker changes in release 1 anyway.
3. One release. Biggest diff, hardest to review and bisect; every screen is exposed to the mixed-cache window at once.

## Constraints (all releases)

- **Mixed module cache** (sonnet dispatch checklist): the service worker serves each file network-first with a 3 s fallback, so a phone can mix files from two releases.
  - No new named imports of new exports: namespace import plus `?.` with a fallback.
  - New CSS custom properties are read with a fallback: `var(--board, var(--ink))`.
  - New strings degrade to key names.
  - Check every changed module against the previous main.
  - New stats fields are read with a fallback; a missing field hides that part, never shows `undefined` or `NaN`.
- **360 px worst case**: two-digit caps, long Greek names, longest counts, all badges; no sideways scroll; landscape where the layout changes.
- **Reduced motion**: every animation has a `prefers-reduced-motion: reduce` variant (today's celebration already does).
- **Greek**: names can be Greek (tests already use Greek strings). Both Sofia Sans and Sofia Sans Extra Condensed ship a `greek` subset on Google Fonts (checked 19/11/2026); the css2 API serves it automatically via `unicode-range`.
- **Tests**: e2e tests assert on test ids and text, not colours. Keep every existing `data-testid` unless a release explicitly replaces the element. No `waitForTimeout` except for "nothing happened" checks; every assertion must be able to fail.
- **Dates** DD/MM/YYYY, numbers with tabular figures.

## Release 1 — the look

Scope: CSS custom properties, CSS rules, font links, the computed club-colour pair, static brand files. No DOM structure changes; no class renames.

### Tokens (`css/base.css`, dark overrides in `css/viewer.css`)

Existing properties, new values:

| Property | Today | Light (B) | Viewer dark (B) |
|---|---|---|---|
| `--ink` | #0E2238 | #0B1320 | #E8EEF5 |
| `--paper` (cards, sheets) | #FFFFFF | #FFFFFF | #131E2E |
| `--pool` (page) | #EEF5F8 | #F4F6F8 (deck) | #0B1320 |
| `--water` / `--water-text` (saves) | #0F7FA8 / #0B6A8C | #0B6E7F / #0B6E7F | #5CC3EC / #5CC3EC (unchanged) |
| `--rope` (exclusions) | #D7263D | #D7263D | #FF6B7D (text on dark) |
| `--line` | #C9D6DF | #D5DCE3 | #24324A |
| `--accent` | club colour | unchanged, set from `teamConfig.accent` | unchanged |
| `--font-body` | Fira Sans | "Sofia Sans", system-ui, sans-serif | — |
| `--font-num` | Fira Sans Extra Condensed | "Sofia Sans Extra Condensed", "Arial Narrow", system-ui, sans-serif | — |

New properties:

| Property | Light | Viewer dark | Use |
|---|---|---|---|
| `--muted` | #4A5868 | #9AA8B8 | secondary text |
| `--line-strong` | #7A8796 | #5D6B7D | input borders, empty foul pips, the timeline centre line |
| `--board` | #0B1320 | #05090F | scoreboard, headers, GOAL buttons |
| `--board-line` | #24324A | #1F2B3D | rules on the board |
| `--board-muted` | #A9B4C2 | #A9B4C2 | secondary text on the board |
| `--led` | #FFC23D | #FFC23D | score digits, LIVE, GOAL label |
| `--out-text` | #B3202F | #FF6B7D | "Out", End game, delete |
| `--accent-on-board` | computed | computed | our marker bar on the board |
| `--on-accent` | computed | computed | cap numbers on the club colour |

Tracker properties (`css/tracker.css`):

| Property | Today | B |
|---|---|---|
| `--pen` | #9A4A00 | #6B3FB5 (purple; white text) |
| `--sit-up` (page tint) | #4FCB82 | #C6F0D9 |
| `--sit-down` (page tint) | #F0626B | #F08A4B; its band is hatched: `repeating-linear-gradient(135deg, #E8590C 0 10px, #F37A3A 10px 20px)` with ink text |
| `--sit-up-strong` | #146B3A | #0E7A4E, white text |
| `--sit-down-strong` | #B3202F | #E8590C, **ink text** (white fails on it) |

The two computed properties are set in JS next to the existing `--accent` line (`js/viewer.js:21`, `js/tracker/app.js:27`):

- `--on-accent`: whichever of white and ink (#0B1320) has the higher contrast with the accent.
  - Cap numbers are large text (22 px and up, bold), so the bar is 3:1. The higher of the two is always at least 4.3:1 for any colour.
  - The CSS fallback `#fff` is right for the configured club colour (#0057B8). With another club colour, one mixed-cache load could show the fallback; that is accepted.
- `--accent-on-board`: the accent mixed toward white in 5 % steps until it reaches 3:1 against `--board`.

Inline the helper in each file; don't add a new shared module import. CSS always reads them with fallbacks (`var(--on-accent, #fff)`, `var(--accent-on-board, var(--accent))`).

### Type

Google Fonts link in `index.html` and `track.html`: Sofia Sans 400;600;700 and Sofia Sans Extra Condensed 700;800, `display=swap`, Greek subset included. Scale (Tokens page):

- celebration 104;
- score 76 (viewer) / 64 (tracker) / 56 (landscape);
- tally 34, action 30, cap chip 26 / 22;
- section head 18–20 Extra Condensed;
- title 20–22, body 16, meta 13–14;
- label 12–13 caps with 0.1em tracking.

### Viewer, restyled in place (boards `VGame`, `VGameFinal`, `VSeason`)

- **Scoreboard:** today's markup (the two team names and one score node, `js/viewer.js:215`) on the `--board` panel.
  - The score is in amber `--led` digits.
  - A 6 px `--accent-on-board` bar sits before ANOG; the opponent is in `--board-muted`.
  - The board's two score rows need markup, so they come in R2.
  - The existing situation figures and quarter-scores line sit on the board with today's wording (e2e asserts it). R2 moves the figures to the Team tab.
- **Sections, tables, timeline:** keep their structure and today's glyph icons. Apply the new colours, type, radii (4 badges, 6 buttons and inputs, 8 cards and tiles, 12 sheet tops) and spacing (4/8/12/16/24/32).
- **Live and past-game banners** use the B styles.
- **Celebration:** colours and type only (amber GOAL on the dark overlay). Keep today's timing and scene; the reduced-motion variant stays.

### Tracker, restyled in place (boards `TLive*`, `TBanner*`, `TLiveToast`, `TEvents`, `TGoalieSheet`, `TUnlock`, `THome`, `TRosterNoPhotos`, `TNewGame`, `TLineupNoPhotos`, `TPast`, `TLandscape`)

- **Header and score row:** on `--board`.
- **Tiles:** GOAL on `--board` with `--led` text; Excl as a red outline; Pen as purple fill; SAVE as teal fill; Pen save as a teal outline; ⋯ as an ink outline. Foul pips: filled red / purple, empty `--line-strong`.
- **Situation:** man-up tints the page `--sit-up` with a solid green band; man-down tints it `--sit-down` with a hatched orange band and ink text.
- **Dock, banners, toast, sheets:** restyled as on the boards. The unsaved banner is pale red with Retry / Discard; the moved banner is pale amber with Take over, and the rest of the screen is dimmed.
- **Anything on a tracker board that needs new markup** goes to R3. List it while doing R1.

### Brand files (additive)

- **Logo:** the crest as `img/anog-crest.png`, at 512 px. Builders can't open the canvas, so before dispatching each release the main session copies into the repo what that release needs: the crest (from the canvas asset store) into `img/`, and the icon paths (from the Tokens board) into the plan.
- **Home-screen icons:**
  - `apple-touch-icon` at 180 px, the crest on the `--board` colour, as on board `VIcon`;
  - a web app manifest with 192 and 512 px icons, `theme_color` #0B1320 and `background_color` #F4F6F8.
- **Link preview:** an `og:image` at 1200×630 as on board `VLinkPreview`, plus `og:title` and `og:description`, on `index.html`.
- **Precache:** add the new files to `sw.js`'s precache list and bump the cache name. As built: the manifest and the three icons are in SHELL; `img/anog-crest.png` (used from R2) and `img/og.png` (only link crawlers fetch it) are not. The crest ships at its source size, 333 × 332 px.
- **As built, club-colour helper:** `js/accent.js`, loaded through a caught dynamic `import()` instead of being inlined, so it can be unit-tested; a missing file leaves the CSS fallbacks. It also sets `--accent-open-light` / `--accent-open-dark` for the selected-result marker (3:1 against the selected row for the four test club colours).

### R1 done when

- Every screen matches its board's look on today's structure.
- All existing unit and e2e tests pass unchanged.
- Contrast is checked for the four test club colours in light and viewer dark.
- 360 px and landscape are checked.
- Playwright screenshots of the main screens are added beside the boards on the canvas, and the owner approves them there.

## Release 2 — viewer structure

### Routing and home

| Route | Today | R2 |
|---|---|---|
| `#/` (home) | live game if one is live; otherwise the season list; empty state if there are no games | always the **season screen** (`VSeason`); while a game is live, a LIVE banner on top (`VSeasonLive`) |
| `#/games` | season list | same as `#/` (kept so old links work) |
| `#/game/<id>` | that game | that game, with a "This season" back link to `#/` at the top (all statuses) |

- **Which season home shows:** the season of the team's current game, falling back to the calendar season. That is today's `followSeason` rule (`js/viewer.js:113`).

- **Live banner:** amber, at least 56 px tall, reading "LIVE · Q3 · ANOG 9–7 Vouliagmeni · Watch". The whole banner is a link to `#/game/<liveId>`. Reuse today's `live-banner` element and test ids where possible.
- **Behaviour change (the owner's call):** someone opening the home link during a game now needs one tap to reach the game. Shared `#/game/<id>` links still open the game directly.
- **No games this season:** the season screen with its header and an empty Results tab ("No games yet this season."). The separate empty state goes.
- **Game celebration:** stays on the game screen only, as today. Not on home, not on the banner.

### Tabs

- **Game:** Timeline | Players | Team. **Home:** Results | Players | Team. Real ARIA tabs (`tablist` / `tab` / `tabpanel`, `aria-selected`, `aria-controls`, arrow keys move between tabs). Each tab is at least 50 px tall.
- **Selected tab:** the selected tab lives in memory only. It resets to the first tab when you move between home and a game, and a new event never switches tabs. *My call; deep links to a tab are not needed.*
- **Tab bar:** sits under the scoreboard (game) or the season header (home). Making it sticky on scroll is left to the builder.

### Game scoreboard (`VGame`)

- **Top row:** LIVE badge, the current MAN-UP / MAN-DOWN chip (only while one is open), and the period box (Q1–Q4 or SO). Final games: a FINAL badge and the date.
- **Score rows:** as R1, with the crest (40 px) after "ANOG".
- **Quarter grid:** live and final games (today: final only). The current quarter is in `--led` and future quarters show "–".
  - Only for games whose quarter goals add up to the score, as today.
  - Shootout goals are not in the grid; the existing shootout line stays.
- **Removed:** the MU/MD line is no longer on the scoreboard; it moves to the Team tab.

### Timeline tab (centre line)

- **Layout:**
  - Newest first, all events of the game, with no fixed-height scroll box (the page scrolls).
  - **Order:** as `timeline()` today (`js/model.js:132`): by quarter, newest quarter first, then by `ts` within a quarter, newest first.
  - **Running score:** computed in the same order, ascending (quarter, then `ts`). A goal added later to an earlier quarter shows in that quarter, with the score at that point.
  - Three columns: ours | centre (64 px) | theirs. A 2 px `--line-strong` line runs down the centre column.
  - Quarter markers sit on the line: a `--board` chip with `--led` text, "Q3 2–2" (that quarter's goals, ours first). Shootout: "Shootout" with the shootout score.
- **Rows:**

  | Event | Side | Centre | Text |
  |---|---|---|---|
  | `goal` | ours | score pill on `--board` with `--led` digits | `#7 Nikos P.` / `Goal`, + MAN-UP tag (green, white text) if `manUpGoalIds` has it |
  | `oppGoal` | theirs | score pill, card background, `--line-strong` outline, ink digits | opponent name / `Goal` |
  | `save`, `penSave` | ours | save icon, outlined | keeper / `Save` or `Pen save` |
  | `excl` | ours | exclusion icon, red fill | player / `Exclusion` (+ `· out` in `--out-text` on the fouling-out event) |
  | `pen` | ours | penalty icon, purple fill | player / `Penalty foul` (+ `· out` likewise) |

- **Score pills:** always ANOG–opponent ("9–7"), the running score after that goal. In the shootout group the pill shows the running shootout score.
- **Hidden, as today:** `gkIn`, `manUp`, `manUpEnd` and `manDownEnd`. Today's `TIMELINE_SAVES` guard for saves stays.
- **Names:** one line with an ellipsis, 15 px. The event line is 13 px muted. At 360 px each side has about 115 px of text.
- **Icons:** stroke SVGs from the Tokens page (24 grid, 2 px stroke, round caps), built with `createElementNS`, never `innerHTML`. The existing `tl*Sr` texts stay as the accessible text. The glyph icons in `strings.js` stay for old cached viewers.

### Players tab

Today's player table and goalkeeper table, restyled. Photos are off: a cap chip in the club colour (`--on-accent` text). "Out" players get a grey chip and "Out" in `--out-text`. Goalkeeper save % as today (`savePct`: saves + pen saves over shots faced).

### Team tab — game (`VGameTeam`)

Built by a new pure module, `js/teamStats.js`: `gameTeamStats(game)` returns plain numbers, and the view formats them. Periods 1–4 only; the shootout is excluded throughout. `goalieStats` counts the shootout separately, so don't reuse its totals. Events are ordered by `ts`, with a stable sort, like the existing replays.

**1. Man-up · man-down** (only if `isTracked(game)`; otherwise the line "Man-up and man-down weren't tracked in this game")

Source: the closed situations from `replaySituations(game)`, by `period`. One row each for:
- **Man-up:** scored / played per quarter, plus total and %.
- **Man-down:** stopped / played per quarter, plus total and %.

A quarter with none played shows "–".

**2. Goals**

- For: total, and how many were man-up goals (`manUpGoalIds`).
- Against: total, and how many came while a man down (closed man-down situations with outcome `conceded`).
- Each line is a bar plus a legend with numbers. If situations aren't tracked, show the totals only.

**3. Fouls**

- **Per quarter:** exclusions and penalty fouls, plus totals.
- **Foul trouble:**
  - players on ≥ 2 fouls (exclusions + penalty fouls together, as `playerLines`, `EXCL_LIMIT` = 3);
  - the three pips, and "2 of 3 fouls · one more and out" or "Out";
  - out players listed last.
- **Penalties against:**
  - "N faced · M saved", where faced = `pen` events and saved = `penSave` events in periods 1–4;
  - known approximation: each penalty foul is assumed to give a penalty shot.

**4. Game flow** (from the order of `goal` / `oppGoal`)

| Row | Definition |
|---|---|
| Biggest lead | max(us − them) after any goal, shown as "+N"; "never ahead" if it never went above 0 |
| Longest run | the longest streak of goals by one side, written from our side: "3–0" or "0–3"; on a tie of length, ours |
| Ties | how many times a goal made the score level; append "· never behind" if us − them never went below 0 |
| Different scorers | distinct `playerId`s of our goals (goals with no scorer don't count) |

The module needs unit tests for:
- no events;
- untracked situations;
- a shootout game;
- a game with a deleted man-up start (the orphan end that `replaySituations` already handles);
- foul-out by penalty fouls;
- longest-run ties.

### Home tabs (`VSeason`, `VSeasonPlayers`, `VSeasonTeam`)

- **Results:** today's results list, restyled.
  - Result chip, a letter plus a colour: green W, red L, grey D. D is for a final that ended level with no decisive shootout; the tracker can end a game level.
  - Then the opponent, the date and the score; shootout results add "pen. 4–3".
  - The per-game MU/MD cell (`result-situations`) moves to the Team tab.
- **Players:** today's player totals and goalkeeper totals.
- **Team:**
  - **By game:** opponent and date; MU scored / played; MD stopped / played; our exclusions. Then a season row with totals and %, and exclusions per game. A legend line explains MU / MD / EXCL. A game that didn't track situations shows "–" in MU and MD and is left out of those totals.
  - **Goals by quarter:** rows For / Against / Difference, columns Q1–Q4 and total.
    - Negative differences show the minus sign and `--out-text`, so it's not colour alone.
    - One sentence names any quarter with a negative difference ("Q3 is the only quarter we lose."). No sentence if there's none.
  - **Goals:** for and against, with the same man-up / man-down split as the game Team tab, summed over the season.
    - The split comes from fields that exist today: man-up goals = Σ `manUp.scored`; goals against while a man down = Σ (`manDown.played` − `manDown.stopped`), since a closed man-down is either stopped or conceded.
    - The split covers only games that tracked situations. When that's not every game, a line says "Man-up figures cover N of M games".
  - **Coverage of the quarter table:** each game's quarters count goals with period 1–4 only, so the total column is the sum of the quarters. It can differ from Results by a goal with no valid quarter. Games without `quarters` are left out, with "Covers N of M games".

**Data (persistence format change):** home reads the `stats/{season}` document. `aggregateSeason` (`js/model.js:241`) builds it, and `repo.recomputeSeason` (`js/repo.js:222`) writes it with `setDoc`, replacing the whole document. The tracker's stats queue triggers that write.

- **Already there, reused as-is (don't move or rename them):**
  - each `results[]` entry's `manUp` / `manDown` (from `gameResult`, only for tracked games);
  - the season `situations` total.

  Old cached viewers read these.
- **New on each `results[]` entry (from `gameResult`):**
  - `excl` and `pens`: our counts in periods 1–4;
  - `quarters`: an array of four maps `{ us, them }`, periods 1–4. Firestore rejects nested arrays, so not `[[us, them], …]`.
- **No version marker, no new trigger:**
  - The viewer checks for each field on each result and treats it as optional.
  - The current season fills in on its own: the tracker already recounts the current game's season every time it boots, unlocks or takes over (`js/tracker/app.js:429`), and after any change to a final game (`js/tracker/recount.js`).
  - Older seasons fill in only when one of their games is changed. Until then, their Team tab shows "–" for exclusions and "Covers 0 of M games" for quarters.
- **Old tracker tabs:** an old tracker tab that recounts drops the new fields; the viewer degrades, and the next recount by a new tracker restores them. Accepted, because the network-first service worker makes that window short.
- **Who builds it:** this is the only persistence change in the redesign. Codex (high) writes the `gameResult` extension and its unit tests, including the Firestore-safe shape and games with goals outside periods 1–4.

### Logo in the viewer

The crest beside ANOG on the game scoreboard (40 px) and in the season header (40 px); plate rules per the Tokens page.


### R1 findings: viewer items that need markup (from the R1 build, 19/11/2026)

1. Two score rows (ANOG / opponent each with its own score) and the 52 px accent bar spanning the row; today the bar is a small inline bar before the name.
2. Crest (40 px) after "ANOG".
3. Period and man-up/man-down chips in a top row; separate classes for MAN-UP (green fill) and MAN-DOWN (orange fill, ink text). Today both share one neutral outline chip because the element has no up/down class.
4. FINAL badge plus date in the top row (the date is in the opponent row today).
5. Quarter grid (head row Q1-Q4 with current quarter amber, ANOG/VOU rows) instead of the one-line quarter scores.
6. Tabs (Timeline | Players | Team / Results | Players | Team) and the season header with "3 W - 1 L".
7. Centre-line timeline (score pill in the middle, our events left, theirs right, quarter pill markers, SVG icon boxes, 28 px).
8. Result rows as W/L chip + opponent/date stack + chevron links; photo/cap chip variants.
9. Full-bleed board and "This season" nav bar above it (board is an inset panel in R1).
10. "Reconnecting..." status row restyle only needs CSS; the Team-tab pieces (foul pips, goal bars, game flow) need new markup and data.

11. Lane-rope markup (index.html, track.html, live.js) is hidden by CSS in R1; remove it here.
12. `.timeline h3` stays 24 px in R1 because `viewer.spec.js:91` pins it; the board draws 17 px. Change the test when the element is replaced.

### R2 done when

- **Routing:** the table above holds.
- **Tabs:** work by touch and keyboard.
- **Timeline:** order and sides match the events.
- **Team tabs:**
  - the game Team numbers match `teamStats` unit tests run on a seeded e2e game;
  - the season Team tab shows the new fields when present and degrades when absent.
- **Old phones:** a mixed old/new cache doesn't break the viewer.
- **Checks:** 360 px, dark, reduced motion and the four club colours.
- **Canvas:** screenshots go beside the boards.

## Release 3 — tracker details

Everything on the tracker boards that R1 could not reach with CSS, built in markup:

- the crest in the tracker header (32 px) and on the unlock screen (120 px);
- the home screen's live-game card with the score;
- W/L chips on past games;
- the events sheet layout: "Change scorer" on goals, a 44 px delete button, "Adjust lineup" and "End game" in the sheet head;
- the landscape split layout (`TLandscape`): scoreboard and dock on the left, tiles in two columns on the right;
- **game detail** (`TGameDetail`): restyled in place to the viewer game look. It keeps today's back button, game info form, reopen, delete and inline event editing (`js/tracker/views/games.js:68`), and does not embed viewer code.

Each item keeps its existing test ids, or replaces them in the same commit as its e2e update.

### R1 findings: tracker items that need markup (from the R1 build, 19/11/2026)

1. Crest next to ANOG in the header (TLive, THome, TUnlock: large crest above the unlock title).
2. Situation band inside the header with "MAN-UP"/"MAN-DOWN" label and seconds (today: strip plus the dock button).
3. Header split: first row crest/ANOG/Home, second row score + period (today one `.bar` and a separate score block).
4. Home: live-game card on the board (LIVE badge, score row, Continue tracking) and the nav as one card of rows with icons, chevrons and counts ("16 players", "4").
5. W/L result chips and a chevron on past-game rows; game-detail look (TGameDetail).
6. Events sheet: grabber bar, icon boxes per event type, "Change scorer" as a button on the row, "Q3 - newest first" heading, close as an X icon, Adjust lineup/End game as one row.
7. Goalie sheet: grabber, cap + name + IN GOAL header row inside the sheet.
8. Unsaved banner: warning icon and the first failed tap's description line; moved banner: two-line title/subtitle ("Taps here are paused"); toast: coloured square (foul) before the text.
9. Foul pips as 12 px squares (3 of them) and a plain "7" tally without the "goals" label; cap chip with 26 px digits is done, but the roster photo placeholder/badge variants (TRoster) need photo markup.
10. Landscape split (TLandscape): score and controls in two columns need a wrapper.
11. New game as a two-step form with "Next: who is playing" (today one page).

## Testing (every release)

- **Unit:** `js/teamStats.js`, the extended `aggregateSeason` and `gameResult`, and the club-colour pair helper (blue, red, yellow, green; white vs ink; board 3:1).
- **e2e:**
  - R1: existing suites unchanged.
  - R2: home routing and the banner, tabs by keyboard, timeline sides and pills, Team numbers on a seeded game, the season Team tab with and without the new per-game fields, the 360 px worst case, dark mode.
  - R3: the moved and changed tracker controls.
- **Manual on phones** (owner, as in the release routine): open tracker and viewer once on Wi-Fi after each release.

## Left to the builder

- Exact CSS selectors and how the tokens map onto today's rules.
- Whether the tab bar is sticky.
- Where the club-colour helper sits inside each file.
- The icon export format (inline SVG paths in a small JS table is fine).
- The test seed for the e2e Team-tab game.
- How R1's "needs markup" items are split between R2 (viewer) and R3 (tracker).

## Calls I made (for the owner to check)

1. **Photos:** the "photos off" look ships; photo support is a separate project.
2. **Selected tab:** in memory only, no deep links to a tab; resets between home and a game.
3. **`#/games`:** kept as an alias of home.
4. **Season Team data:** comes from extending the `stats/{season}` document (one read per viewer), not from loading every game. It reuses the per-game MU/MD already stored, adds exclusions, penalty fouls and quarter goals, and needs no backfill step: the current season fills in at the tracker's next boot.
5. **Celebration:** R1 keeps today's timing and scene with the new colours. The canvas's ~1.5 s ball-into-net variant is not in scope.
6. **Icons:** the stroke icons arrive in R2 with the timeline rebuild. R1 keeps today's glyphs.
7. **R1 scoreboard:** keeps today's markup; the two-row score comes in R2.
8. **Draws:** a level final gets a grey D chip.
9. **Tracker game detail:** restyled in place with all its actions kept, rather than rebuilt on the viewer's game screen.
10. **Timeline order:** quarter first, then time, as today; running scores follow that order.
