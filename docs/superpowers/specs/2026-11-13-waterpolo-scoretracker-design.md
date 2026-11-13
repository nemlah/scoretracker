# Water Polo Live Score Tracker — Design

Date: 13/11/2026
Status: approved 13/11/2026

## Intent

A live scoreboard for one water polo team (the user's club), hosted as a static
site on the user's GitHub Pages. One person on the pool deck records goals and
exclusions for our players on a phone; parents, fans and anyone with the link
follow the game live on a public page. The same team is tracked game after
game, so the roster and season stats carry over.

Why it matters: the tracker works one-handed, under time pressure, on poor
pool-side signal. If a tap is lost, recorded wrong or can't be corrected,
the tool has failed, even if everything else works.

## Goals

1. **Public viewer page** (one permanent URL) that always shows the current or
   most recent game, updating live without refresh: score, period, per-player
   goals and exclusions, goal timeline by period. Below it: past results and a
   season stats table.
2. **Tracker page** behind an edit code. Big, forgiving tap targets. One tap per
   event: goal for player X, exclusion for player X, opponent goal.
3. **Saved roster** of our players (name + cap number). Before each game the
   tracker ticks who's playing; caps default to each player's last-used cap
   and can be reassigned.
4. **Nothing lost on crash/close/no signal.** Reopening the tracker resumes the
   game exactly where it was. Taps made offline are kept and sync when signal
   returns, even if the browser was closed in between.
5. **Only one device updates at a time** (see Edit lock).
6. **Mistakes are fixable**: undo last event in one tap; any earlier event can
   be found and deleted.

## Non-goals

- Game clock or shot clock.
- Per-player tracking for the opponent (opponent is a name + score only).
- Stats beyond goals and exclusions (no shots, assists, steals, blocks, saves).
- Multiple teams per deployment.
- Viewer accounts, comments, push notifications.
- A native app.

## Anti-goals (failure even if it "works")

- A mis-tap that changes the score with no visible way to see and fix it.
- Taps that need precision or two hands.
- Any way for the public to change data, or to read the edit code from the
  page source or the database.
- Taps silently lost when the phone drops signal.

## Constraints

- **Hosting:** GitHub Pages, static files only. Must work both as a user site
  (`<user>.github.io`) and a project site (`<user>.github.io/<repo>/`), so all
  paths are relative.
- **Backend:** Firebase (user-approved), free Spark plan. Relevant limits:
  Firestore 50,000 reads/day and 20,000 writes/day; when exceeded, operations
  fail until the daily reset.
- **No build step:** plain HTML/CSS/JS ES modules. Firebase JS SDK loaded from
  Google's CDN (`https://www.gstatic.com/firebasejs/<exact version>/...`),
  pinned to an exact version at least two weeks old.
- **Devices:** current iOS Safari and Android Chrome (tracker mostly on a
  phone, portrait or landscape); viewer on any modern browser.
- **Locale:** dates shown DD/MM/YYYY, times 24h, Europe/Athens local time.
- **Public data:** player names shown on the viewer are public on the internet.
  The README should note that, for minors, first name + surname initial is a
  sensible choice. What gets entered is the user's call.

## Approaches considered

All three decisions are the builder's (my) picks. The user approved them as a
set ("go").

### 1. Data store: Cloud Firestore — chosen

| Option | Trade-off |
|---|---|
| **Firestore** (chosen) | Web SDK persists the cache and pending writes in IndexedDB: offline taps survive a browser close and sync later. No concurrent-connection cap on the free plan; cost is reads (each tracker write = 1 read per live viewer). |
| Realtime Database | Also live, simpler pricing, but web SDK keeps offline writes in memory only (lost on tab close), and the free plan caps at 100 simultaneous connections, which a well-attended game could hit. |

### 2. Edit lock: shared code checked by Firestore security rules, with device takeover — chosen

| Option | Trade-off |
|---|---|
| **Shared code + takeover** (chosen) | Matches the request ("a code"). Easy to hand to an assistant for one game. Code stored where no client can read it; rules compare server-side. Code format (user's decision): **6 characters, digits and capital letters** (`[0-9A-Z]{6}`, ~2.2 billion combinations). Rules don't rate-limit attempts, but anonymous sign-up is rate-limited per IP by Firebase, so guessing is impractical for a club scoreboard. |
| Firebase email/password login | Stronger (Google rate-limits guesses), but it's an account login, not a code; handing over tracking means sharing the account. |
| Code checked in browser JS only | Rejected: anyone can read the code from the page source and write to the DB directly. |

### 3. Site structure: plain static files, no build — chosen

A bundler (Vite etc.) + GitHub Actions deploy adds toolchain and setup with no
benefit at this size. Plain files mean "edit, push, done".

## Design

### Pages

- `index.html`: **Viewer**. Public, read-only.
- `track.html`: **Tracker**. Unlock, roster, game setup, live tracking, game history.

The viewer has no link to the tracker. The tracker URL isn't secret (the code
is the protection), but it isn't advertised.

### Firebase setup (documented in README, done once by the user)

1. Create a Firebase project; add a Web app; copy its config into
   `js/config.js`. The web config is not a secret and is committed.
2. Enable **Anonymous** sign-in (Authentication → Sign-in method).
3. Create a Firestore database in a European location.
4. Paste `firestore.rules` into Firestore → Rules and publish.
5. In the console, create document `secrets/editCode` with field
   `code: "<your code>"`.
6. Enable GitHub Pages for the repo.

Changing the code = edit `secrets/editCode` in the console. That immediately
revokes every device unlocked with the old code (see rules).

### Data model (Firestore)

```
team/main                    public read   (team display name lives in js/config.js)
  roster: [                  all players ever added
    { id, name, cap, archived: bool }   cap = last-used cap
  ]
  currentGameId: string|null game the viewer shows
  updatedAt

games/{gameId}               public read
  opponent: string
  date: "YYYY-MM-DD"
  season: "2026-27"          derived from date (season starts 1 Aug), editable
  status: "live" | "final"
  period: 1 | 2 | 3 | 4 | "SO"     SO = penalty shootout
  lineup: [ { playerId, name, cap } ]   snapshot for this game
  events: [
    { id, type: "goal" | "excl" | "oppGoal", playerId?, period, ts }
  ]                          goal with no playerId = "scorer unknown"
  createdAt, updatedAt

stats/{season}               public read; written by tracker
  players: { [playerId]: { name, games, goals, excl } }
  results: [ { gameId, date, opponent, us, them, soUs?, soThem? } ]
  updatedAt

control/tracker              public read
  activeUid: string          the one device allowed to write
  claimedAt

editors/{uid}                read only by that uid
  code: string               copy of the code this device unlocked with

secrets/editCode             no client read or write (console only)
  code: string
```

- **Scores are derived from `events`, never stored separately**, so score and
  timeline can't disagree. Our score = count of `goal`; theirs = count of
  `oppGoal`. Events in period `SO` are counted separately as the shootout
  result, displayed e.g. `9 – 9 (4 – 3 pen.)`.
- **Writes use `arrayUnion` (add event) and `arrayRemove` (delete event)**,
  which both work offline. Event objects are kept intact so `arrayRemove`
  matches exactly. `id` = `crypto.randomUUID()`, `ts` = client `Date.now()`.
- **Season stats** are recomputed from that season's games and written to
  `stats/{season}` whenever a game is ended, reopened/edited, or deleted. The
  viewer reads one stats doc instead of every game, keeping reads low.
  `results` (past results list) lives in the same doc, so the viewer never
  queries the `games` collection.
- **Shootout goals do not count toward a player's season goal total** (usual
  convention; my call). They still show in that game's timeline.
- **Goals with no `playerId`** count toward our score and the timeline
  ("Goal · scorer unknown") but toward no player's stats until reassigned.

### Read budget (free plan)

Viewer page load = 3 document reads (`team/main`, current game,
`stats/{season}`). While watching live, each tracker write = 1 read per
connected viewer. Each tracker write also costs ~3 reads for rule checks.
A typical game is ~40 tracker writes, so ≈ 50 reads per viewer per game
including a couple of reloads. The 50,000/day free quota therefore covers
roughly **1,000 viewer-games per day** (e.g. 300 viewers × 3 games).

When the read quota is exhausted, rule checks fail and **tracker writes are
rejected too**, so the tracker must surface sync failures loudly (see local
journal below), and the README explains the quota and the Blaze option.

### Security rules (summary)

- Everything readable by the public except `editors/*` (own uid only) and
  `secrets/*` (nobody).
- `editors/{uid}`: create/update only by that uid, and only if the written
  `code` equals `secrets/editCode.code` (rules `get()`; the client never sees
  the secret).
- A device is a **valid editor** if `editors/{auth.uid}.code ==
  secrets/editCode.code`. Changing the secret invalidates all editors.
- `control/tracker`: writable by a valid editor, only setting `activeUid` to
  its own uid (= takeover).
- `team/*`, `games/*`, `stats/*`: writable only if the writer is a valid
  editor **and** `control/tracker.activeUid == auth.uid`.
- Public has no write access anywhere.

### Edit lock flow

1. Tracker page signs in anonymously (uid persists across browser restarts).
2. If this uid isn't a valid editor → unlock screen: one large code field.
   Wrong code → clear error; nothing else happens.
3. On a correct code → write `editors/{uid}`, then claim `control/tracker`.
4. Tracker listens to `control/tracker`. If another device takes over, this one
   switches to read-only with a banner: "Tracking moved to another device ·
   Take over". Taking back doesn't need the code again (still a valid editor).
5. Known consequence, accepted: taps a device recorded **offline** after
   another device took over are rejected on sync. The banner makes the
   takeover visible.

### Tracker screens

**Unlock**: a single 6-character code input that upper-cases as you type,
accepts only `0-9A-Z`, uses a large monospaced font, and has a large "Unlock"
button. The rules also reject any `editors` write whose code doesn't match
`^[0-9A-Z]{6}$`.

**Home** — "Resume live game" (if one is live), "New game", "Roster",
"Past games".

**Roster** — list of players: cap, name. Add (name + cap), edit, archive
(archived players stay in history and stats, hidden from new-game selection).

**New game**
- Opponent name, date (default today).
- Player list from the roster (non-archived), sorted by cap. Each row: tick
  box (default: ticked if they played the previous game, otherwise all
  ticked if there's no previous game), name, cap field pre-filled with last
  cap.
- Reassigning a cap that another **ticked** player holds swaps the two caps.
- "Start game" → creates the game (`status: live`, `period: 1`), sets
  `team.currentGameId`, writes each ticked player's cap back to the roster as
  their new last-used cap.

**Live** (the screen that matters most)

```
 HOME  7 : 5  AWAY                 [ Q3 ▸ ]
 ┌───────────────────────┐
 │ 2  Papadakis   ●●  ▢▢ │   ← tile per lineup player, sorted by cap
 │ [   GOAL   ] [ EXCL ] │
 ├───────────────────────┤
 │ 4  Georgiou    ●      │
 │ [   GOAL   ] [ EXCL ] │
 │ …                     │
 └───────────────────────┘
 [ +1 OPPONENT GOAL ]
 [ UNDO: Goal #4 Georgiou (Q3) ]   [ Events ]
```

- Header: score, period button (Q1 → Q2 → Q3 → Q4 → SO; the step backwards is
  available in the Events/menu, not on the main button).
- Per player: GOAL target (largest), EXCL target (≥ 48 px, visually distinct
  so it's not hit by accident), goal count, exclusion count.
- 3rd exclusion → tile marked **OUT** and both targets disabled. Undo/delete of
  an exclusion re-enables it.
- **Undo** button always names the event it will remove. One tap, no dialog.
- **Events** sheet: every event in this game, newest first, each deletable.
  A goal's scorer can be changed (including from/to "scorer unknown").
  Also holds "+ Goal, scorer unknown", "Lineup", "previous period" and
  "End game".
- **Lineup** (from the Events sheet, also for past games): add a roster
  player who wasn't ticked, remove a player with no events, change a cap
  (same swap rule as New game; the roster's last-used cap is updated too).
- **End game** → in-page confirmation → `status: final`, recompute season
  stats. Viewer shows "Final".
- Screen kept awake (Wake Lock API where supported). Short vibration on
  each recorded tap where supported (Android).
- Status indicator: online / "offline — taps saved, will sync".

**Past games** — list (date, opponent, score). Open one to view/edit events
(same Events sheet), reopen it as live, or delete it (in-page confirmation).
Any change recomputes that season's stats.

### Viewer page

- Header: our team vs opponent, big score, period or "Final", LIVE badge
  while live, date.
- Our players: cap, name, goals, exclusions (OUT marked), sorted by cap.
- Timeline grouped by period: "Q2 · Goal · #5 Alexiou", "Q2 · Opponent goal".
- Below: past results this season (newest first) and the season stats table
  (games, goals, exclusions per player, sorted by goals).
- Updates live via Firestore snapshot listeners; shows a quiet "reconnecting"
  note when offline.
- If there's no game yet: friendly empty state.

### Offline and crash recovery

- Firestore initialised with persistent local cache (IndexedDB, multi-tab).
- A small **service worker** caches the app shell (HTML/CSS/JS and the pinned
  Firebase SDK files) so the tracker can be reopened with no signal if it was
  opened online at least once before.
- **Local journal** (my call): the tracker also records every event it
  creates or deletes in a local journal (localStorage/IndexedDB), marked
  pending until Firestore confirms it reached the server. If Firestore rejects
  a write (quota exhausted, takeover, revoked code), the cache rolls back,
  but the journal keeps it. The tracker then shows a persistent "N taps not
  saved · Retry" banner instead of losing them silently.
- Offline taps sync the next time the tracker page is open and online (no
  background sync on iOS); the status indicator makes that visible.
- Anonymous auth persists in IndexedDB, so the unlock survives restarts.
- Clearing site data means re-entering the code; the game data itself is safe
  in Firestore.

### Configuration

`js/config.js`: Firebase web config, team display name, team colours (accent),
UI language strings.

### Language

The UI is in English, with every visible string kept in one module so a Greek
translation is a later drop-in. (My call; the user hasn't specified.)

## Decided by the user

- Sport: water polo; goal = 1 point; quarters + penalty shootout.
- Firebase as backend.
- Same team every game; saved roster.
- Track only our team's players; opponent = score only.
- Stats: goals and exclusions only, one tap each.
- Caps default to last-used, reassignable before each game.
- Approved my three picks: Firestore, shared code with takeover, plain static
  files.
- Edit code: 6 characters, digits and capital letters.
- Expected audience is well within the free plan; stay on Spark, no paid
  plan. (The read-lean design and the loud sync-failure banner stay as
  safeguards.)

## Left to the builder

- Visual design (within: large targets, high contrast for outdoor/sunlight
  use, works portrait and landscape, team accent colour).
- File/module layout, exact Firebase SDK version.
- Rules details (e.g. `get()` vs `getAfter()` ordering in the unlock writes)
  and optional write-shape validation.
- Test approach. Expected: unit tests for the pure logic (score derivation,
  shootout split, season aggregation, cap swap, fouled-out) and rules tests
  against the Firestore emulator.
- Service worker caching strategy details.
