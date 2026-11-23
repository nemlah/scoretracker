# Competition lists + viewer stats selector — design (23/11/2026)

Project-sized. Builds on the competition-per-game design (`2026-11-23-competition-and-quarter-divider-design.md`, deployed at 6931a3a).

## Intent
- Tournament names are picked from a list instead of typed, so each tournament has one stable identity.
- League games can carry a phase (for example "Regular season" or "Play-offs"), also picked from a list.
- The viewer can show the season's Players and Team stats for the whole season or for one part of it: the league, a league phase, a tournament, or the cup.
- Owner's words: "in order to be able to view total season stats as well as per phase. Also add a selector in the stats section for the viewer to select accordingly."

## Goals, non-goals, anti-goals
- **Goals:**
  - The tracker manages two lists, tournaments and league phases.
  - A game picks its tournament or phase from a list. A new entry can be added in the game form.
  - The viewer's Players and Team tabs get a selector: Season, League, each league phase, each tournament, Cup.
- **Non-goals:**
  - Filtering the Results tab or the W–L record.
  - Names or rounds for cup games, and phases for tournaments.
  - Other filters (opponent, last N games).
  - Keeping the selection across reloads or in the URL.
  - Converting the three existing "Splash - Volos" games automatically (the owner re-picks them once).
- **Anti-goals:**
  - The Season numbers differ from today's totals for the same games.
  - Adding an entry drops another one.
  - A selector option shows the same numbers as Season.
  - A viewer or tracker running an older cached release breaks or writes wrong stats.
  - Any regression at 360 px or in dark mode.

## Approaches
- **Store each game's figures in its result row and let the viewer add them up (picked by the owner).**
  - The season stats doc already has one row per final game. The Team tab and the record are computed from those rows.
  - The change adds each game's player and goalie lines to its row. The viewer then sums whichever rows the selection covers, and any later filter costs no tracker change.
  - The cost is about 1 KB per game in the stats doc, roughly 40 KB a season (Firestore's limit is 1 MB).
- **Pre-sum totals for every selection on the tracker (rejected).** The viewer would only pick a block, but every new filter would need a tracker change and a recount, and the viewer could show only what the tracker pre-summed.
- **Shape (owner's pick, option C of three):**
  - Tournaments come from a list, and league games get a separate phase field.
  - Rejected: A (tournaments only, which can't separate league phases) and B (one list of named competitions that the league is part of).

## Design

### Data
- **Team doc (`team/main`):**
  - It gains two maps, `tournaments: { <id>: { name } }` and `phases: { <id>: { name } }`.
  - Ids are random (`crypto.randomUUID()`).
  - Names are trimmed, 1–40 characters, and unique within their list, compared case-insensitively with Greek-aware lowercasing.
  - Writes use `set(..., { merge: true })` on the single entry, so adding or renaming one never touches the others.
  - Removing an entry uses `deleteField()`.
  - The lists are global, not per season: the viewer only offers the entries that the shown season's games use.
- **Game doc:**
  - **Tournament games** add `tournamentId`. They keep writing `competitionName` with the entry's name at save time, for older clients and as a fallback label.
  - **League games** may add `phaseId`. "No phase" is allowed.
  - **Cup and friendly games** carry neither field.
  - Changing the competition removes the field that no longer applies (`deleteField()`).
- **Validation:** `competitionOf` in `js/model.js` extends to return `{ competition, competitionName?, tournamentId?, phaseId? }`.
  - `tournamentId` is kept only for a tournament, and `phaseId` only for the league.
  - Each id must be a non-empty string of at most 64 characters, otherwise it is dropped.
  - A missing or unknown competition still reads as league.
- **Result rows (`gameResult`):**
  - Each row also carries `tournamentId` or `phaseId` when the game has one.
  - Each row carries the game's lines:
    - `players: { <playerId>: { name, goals, excl, pens } }`, one entry for every lineup player.
    - `goalies: { <playerId>: { name, games, saves, penSaves, goalsAgainst } }`, where `games` is 1 if the goalie was in the lineup as a goalie, else 0.
  - Names are resolved as today: the roster name at recount time, else the lineup name.
- **Season totals (`aggregateSeason`):**
  - `players` and `goalies` become the sum of the non-friendly rows' lines.
  - The tracker and the viewer use one summing function in `js/model.js`, so the viewer's Season pick equals the stored totals by construction.
  - `players`, `goalies` and `situations` stay in the stats doc for older viewers.
- **Firestore rules:** unchanged. `team/main` is already writable only by the active tracker, and game docs are not field-validated.

### Tracker
- **Game forms (new-game details step and game-detail info form):**
  - The Competition select stays as it is.
  - **Tournament** shows a "Tournament" select: the entries sorted by name, then "Add new…". "Add new…" shows a name field, validated as above, and a duplicate name is refused with a message. The free-text name field goes.
  - **League** shows a "Phase" select: "No phase", the entries sorted by name, then "Add new…".
  - **Cup and Friendly** show nothing extra.
  - A new entry is written in the same batch as the game create or update.
- **Defaults:** a new game takes the previous game's competition and its tournament or phase, if that entry still exists.
- **Edit form:** the existing `competitionTouched` handling extends to the two new selects. A changed tournament or phase recounts the season through the existing `recountAfter` path.
- **Legacy tournament game** (a `competitionName` with no `tournamentId`): the edit form preselects the entry with the same name, matched case-insensitively. Otherwise it preselects "Add new…" with the name filled in. Either way, re-linking is one Save.
- **Competitions screen:** a new home nav row "Competitions", after Roster. It has two sections, Tournaments and Phases. Each entry can be renamed inline. Each section has an Add field.
  - "Remove" is enabled only for entries no game uses, checked against `repo.listGames()`.
  - All writes follow the existing write gating (`data-write`, writable state).
- **Renames:** a rename changes only the list entry. Games keep their ids, and new clients show the new name. Stored `competitionName` snapshots are not rewritten, so only older cached clients show the old name.

### Viewer
- **Selector:**
  - On the home screen, a native `<select>` at the top of the Players and Team panels, labelled "Showing".
  - Options, in order:
    - Season;
    - League;
    - each league phase, as "League – <phase>";
    - each tournament;
    - Cup.
  - Phases and tournaments are ordered by the date of their first game in the season.
  - Only scopes with at least one counted game (final, not friendly) in the season are offered. An option whose games are exactly Season's games is left out. When nothing is left, the selector is hidden.
  - **Labels** come from the team doc's lists by id. The fallback is the row's `competitionName`, then the generic label ("Tournament", "Phase").
  - **Legacy tournament rows** (no id) count in Season and in no tournament option.
- **Selection state:**
  - The two tabs share one selection, kept in memory only.
  - It resets to Season when the season shown changes or the page reloads.
  - If the selected scope disappears (a game was re-tagged), the selection falls back to Season.
- **Players panel:** sums the selected rows' lines with the shared function. The cap column keeps using the current roster.
- **Team panel:** gets `{ ...stats, results: selectedRows }`, so `teamView.js` is unchanged and an older cached `teamView.js` still works.
- **Older stats doc:** if any counted row has no `players` map (the doc was written before a new tracker recounted it), the Players panel uses the stored totals and the selector is hidden. The tracker recounts the current season when it takes control, so this clears on the owner's next unlock.
- **Unfiltered parts:** the header W–L record and the Results tab stay whole-season.
- **Friendlies note:** "Friendlies not counted (n)" shows only with Season selected.
- **Tags:**
  - On result rows and the game board, a tournament shows its list name.
  - A league game with a phase shows the phase name as its tag (my call: the phase is useful context on the row).
  - A league game without a phase still shows no tag.

### Mixed module cache
- The new form fields, the Competitions screen and the selector appear only when the new `repo`, `model` and `strings` are all loaded. This follows the existing `competitionsOn` gate style, using namespace imports with `?.` fallbacks.
- **Recount guard:** `recomputeSeason` throws 'stale model' when the new summing function is missing, so a mixed tracker keeps the season dirty instead of writing rows without lines.
- **Older tracker:** a cached older tracker can still tag a game as a free-text tournament. That game is then a legacy row (see above). Accepted.
- **Service worker:** new modules (for example `js/tracker/views/competitions.js`) go into the `sw.js` SHELL, and the cache becomes `wp-shell-v6`.

### Tests
- **Unit:**
  - `competitionOf` keeps and drops ids correctly.
  - `gameResult` carries the ids and the lines.
  - The totals from `aggregateSeason` equal the summing function over non-friendly rows.
  - The scope builder: options, order, dropping options identical to Season, hiding, legacy rows, the fallback when rows lack lines.
  - Name validation and duplicates, including Greek case.
- **Emulator:**
  - Creating a game with a new entry writes the team map entry and the game ids in one batch.
  - Two entries added one after the other both survive.
  - Rename and remove write only that entry.
- **E2e:**
  - The tracker adds a tournament in the new-game form, and the next game defaults to it.
  - A phase on a league game.
  - The Competitions screen renames an entry, and the viewer shows the new name. Remove is disabled while a game uses the entry.
  - A legacy game re-links in one Save.
  - The viewer selector: its options, Players and Team figures changing with the selection, hidden for a single scope, the fallback for rows without lines.
  - 360 px with long Greek names in the selector and tags, light and dark.

## Calls from the builder check (Codex high, 23/11)
- **An id always wins.**
  - A game's `tournamentId` or `phaseId` decides its grouping and label. `competitionName` is only a snapshot.
  - The new repo's `updateGameInfo` writes ids only when the payload has them. An older cached form's free-text save therefore leaves the existing link in place and changes only the snapshot.
  - Switching to another competition deletes the id that no longer applies, and `competitionOf` already drops it.
- **Removed or renamed entries:**
  - At Save, the forms resolve the selected id against the current local list.
  - A renamed entry saves with its new name as the snapshot.
  - If the entry was removed while the form was open, the form refuses with a message and asks to pick again.
  - Remove on the Competitions screen re-checks `listGames()` at the moment of the click. `getDocs` includes this device's pending writes.
- **Duplicate names:** only the active tracker writes, so duplicates are limited to edge races. They are harmless: two entries with the same name, which the Competitions screen can rename or remove. No conflict policy.
- **An older tracker recounting after the upgrade:** it can rewrite a season's rows without lines. The viewer then falls back to the totals and hides the selector until a new tracker recounts, which happens on the owner's next unlock for the current season. Past seasons stay unfiltered until one of their games is edited. Accepted.
- **Offline create with a new entry:** this is today's behaviour. The entry and the game are in one batch, so a rejection rolls both back. Nothing new is built.
- **Legacy relink:** when the edit form preselects a link for a legacy tournament game, that counts as a hand edit (`competitionTouched`). So any Save, even an opponent-only one, writes the link.
- **Viewer without list data:** the selector shows only once the team doc is loaded. If the team watch fails, it stays hidden. Tags fall back to the snapshot name or the generic label.

## Left to the builder
- Exact strings beyond "Showing", "Phase", "No phase", "Add new…", "Competitions" and the duplicate-name message.
- The Competitions screen layout, following the Roster screen's patterns.
- How the summing function and the scope builder are split between `js/model.js` and a new pure module.
- Where the selector sits inside each panel, and its styling.
