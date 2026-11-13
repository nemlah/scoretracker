# Water Polo Live Score Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Static GitHub Pages site with a public live viewer (`index.html`) and a code-locked tracker (`track.html`) for one water polo team's goals and exclusions, backed by Firestore.

**Architecture:** Plain HTML/CSS/ES-module JS, no build step. The Firebase JS SDK is loaded in the browser through an import map pointing at gstatic, and in Node through the npm package of the same version, so `js/repo.js` runs unchanged in both. Pure game logic lives in `js/model.js` (unit-tested with `node --test`). Firestore access is in `js/repo.js` (integration-tested against the emulator), security is in `firestore.rules` (rules-tested against the emulator), and the UI is tested end-to-end with Playwright against the emulator.

**Tech Stack:** Firebase JS SDK 12.19.0 (Firestore, Anonymous Auth), Firestore security rules v2, Node 26 `node:test`, `@firebase/rules-unit-testing` 5.0.2, `firebase-tools` 15.34.2 (emulators, needs JDK 21), `@playwright/test` 1.64.1.

**Spec:** `docs/superpowers/specs/2026-11-13-waterpolo-scoretracker-design.md`

## Global Constraints

- Firebase JS SDK **12.19.0** exactly. Browser import map:
  `firebase/app` → `https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js`, `firebase/auth` → `…/firebase-auth.js`, `firebase/firestore` → `…/firebase-firestore.js`. Node: npm `firebase@12.19.0`. Code always imports the bare specifiers `firebase/app|auth|firestore`.
- Dev dependencies are pinned to exact versions: `firebase-tools@15.34.2`, `@firebase/rules-unit-testing@5.0.2`, `@playwright/test@1.64.1`. The site has no other runtime dependencies and uses no framework.
- No build step. All URLs and paths are **relative**, so the site works at both `<user>.github.io/` and `<user>.github.io/<repo>/`.
- Every user-visible string comes from `js/strings.js` (English).
- Dates are displayed as `DD/MM/YYYY` and stored as ISO `YYYY-MM-DD`. "Today" is computed in `Europe/Athens`.
- Never write `undefined` to Firestore. Omit the key instead (e.g. a goal with an unknown scorer has no `playerId` key).
- Edit code format: `^[0-9A-Z]{6}$`.
- `EXCL_LIMIT = 3`. `PERIODS = [1, 2, 3, 4, 'SO']`. Seasons start 1 August and are named `"YYYY-YY"`.
- Tap targets: GOAL ≥ 56 px tall, EXCL ≥ 48 px, every other control ≥ 44 px. Text inputs have font-size ≥ 16 px (prevents iOS zoom). High contrast for outdoor use. Accent colour from `js/config.js`.
- Emulator: project id `demo-scoretracker`, Firestore `127.0.0.1:8080`, Auth `127.0.0.1:9099`. Static test server `127.0.0.1:4173`. Browser emulator mode turns on only when the host is `localhost` or `127.0.0.1` **and** the URL has `?emulator=1`.
- UI tasks: load the `frontend-design:frontend-design` skill before writing CSS/markup.
- Commits: conventional messages; trailer naming the model that wrote the commit. Never push.

## Review Focus

1. **Tracker reopened with no signal in the middle of a game.** It must open straight into the live game with every tap shown, then sync when signal returns. Test: Task 10, `offline.spec.js` "reloads offline into the live game".
2. **Taps from a device that lost control** (another device took over, or the code changed) are shown as "not saved" with Retry, never dropped silently. Tests: Task 10, "taps after losing control are flagged"; Task 7, "revoked code".
3. **Accidental double-tap on GOAL** records one goal. Tests: Task 1 `isDuplicateTap`; Task 8 `taps.test.js` "ignores duplicate"; Task 8 e2e "double tap".
4. **Cap collisions when ticking or reassigning players.** A game can't start with duplicate or missing caps. Tests: Task 2 `toggleSelected`/`validateLineup`; Task 8 e2e "new game".
5. **Viewer opened before any game exists, or while the current game is deleted.** It shows an empty state; no blank page or console crash. Tests: Task 6 e2e "empty state" and "deleted while watching".

## File Map

```
index.html, track.html        page shells (import map, CSS, one module entry each)
sw.js                         service worker (app-shell cache)
.nojekyll                     disable Jekyll on Pages
css/base.css                  tokens (accent var), typography, shared components
css/viewer.css, css/tracker.css
js/config.js                  Firebase web config, team name/accent, emulator switch
js/strings.js                 all UI copy + label/score formatting
js/model.js                   pure game/lineup/season logic (no imports)
js/journal.js                 local journal of event writes (pending/failed)
js/firebase.js                browser init (persistent cache, anon auth, emulator)
js/repo.js                    all Firestore reads/writes
js/ui/dom.js                  h()/clear() DOM helpers
js/sw-register.js             registers sw.js
js/viewer.js                  viewer page
js/tracker/app.js             tracker boot, state, routing, banners, write-error handling
js/tracker/taps.js            tap/undo/retry pipeline (unit-tested)
js/tracker/statsQueue.js      dirty-season queue for stats recompute (unit-tested)
js/tracker/views/{unlock,home,roster,newgame,live,events,lineup,games}.js
firestore.rules, firebase.json
scripts/serve.mjs             static server for tests/dev
scripts/seed-emulator.mjs     seeds secrets/editCode = TEST01 for local dev
tests/unit/*.test.js          node --test (no emulator)
tests/emulator/*.test.js      node --test inside emulators:exec
tests/e2e/*.spec.js           Playwright inside emulators:exec
playwright.config.js, package.json, README.md
```

---

### Task 1: Scaffold + game logic

**Files:**
- Create: `package.json`, `.gitignore`, `.nojekyll`, `js/model.js`, `tests/unit/model.game.test.js`

**Interfaces:**
- Produces (in `js/model.js`; document the shapes with JSDoc typedefs at the top of the file):
  - `Event = { id: string, type: 'goal'|'excl'|'oppGoal', period: 1|2|3|4|'SO', ts: number, playerId?: string }`
  - `LineupEntry = { playerId: string, name: string, cap: number }`
  - `PERIODS`, `EXCL_LIMIT = 3`, `DUPLICATE_TAP_MS = 1000`
  - `nextPeriod(p) -> p|null`, `prevPeriod(p) -> p|null`
  - `makeEvent(type, period, playerId = null, now = Date.now(), id = crypto.randomUUID()) -> Event`
  - `withPlayer(event, playerId|null) -> Event`
  - `deriveScore(events) -> { us, them, soUs, soThem }`. Exclusions are ignored; events in period `'SO'` count only toward `soUs`/`soThem`.
  - `hasShootout(period, events) -> boolean`: true if `period === 'SO'` or any event is in `'SO'`.
  - `playerLines(lineup, events) -> [{ playerId, name, cap, goals, soGoals, excl, out }]`, sorted by cap.
  - `lastEvent(events) -> Event|null`: highest `ts`; a tie goes to the later array index.
  - `timeline(events) -> [{ period, events: Event[] }]`: newest period first, newest event first.
  - `isDuplicateTap(prevEvent|null, type, playerId|null, now, windowMs = DUPLICATE_TAP_MS) -> boolean`
  - `playerHasEvents(events, playerId) -> boolean`

- [ ] **Step 1: Init the repo and scaffold**

`git init -b main`. `package.json`: `{"name":"waterpolo-scoretracker","private":true,"type":"module","scripts":{"test":"node --test \"tests/unit/**/*.test.js\""}}`. `.gitignore`: `node_modules/ test-results/ playwright-report/ *-debug.log`. `.nojekyll` is empty. Commit the existing `docs/` first: `git add docs && git commit -m "docs: design spec and implementation plan"`.

- [ ] **Step 2: Write the failing tests** in `tests/unit/model.game.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../../js/model.js';
const ev = (type, period, playerId, ts, id = `e${ts}`) => m.makeEvent(type, period, playerId, ts, id);

test('makeEvent omits playerId when null', () => {
  const e = m.makeEvent('oppGoal', 2, null, 1000, 'x');
  assert.deepEqual(e, { id: 'x', type: 'oppGoal', period: 2, ts: 1000 });
  assert.equal('playerId' in e, false);
  assert.deepEqual(m.makeEvent('goal', 1, 'p1', 5, 'y'), { id: 'y', type: 'goal', period: 1, ts: 5, playerId: 'p1' });
  assert.match(m.makeEvent('goal', 1, 'p1').id, /^[0-9a-f-]{36}$/);
});
test('withPlayer reassigns or clears the scorer, keeps id/ts', () => {
  const e = ev('goal', 1, null, 10, 'g');
  assert.deepEqual(m.withPlayer(e, 'p2'), { id: 'g', type: 'goal', period: 1, ts: 10, playerId: 'p2' });
  assert.equal('playerId' in m.withPlayer(m.withPlayer(e, 'p2'), null), false);
});
test('nextPeriod / prevPeriod', () => {
  assert.equal(m.nextPeriod(1), 2); assert.equal(m.nextPeriod(4), 'SO'); assert.equal(m.nextPeriod('SO'), null);
  assert.equal(m.prevPeriod('SO'), 4); assert.equal(m.prevPeriod(1), null);
});
test('deriveScore splits shootout and ignores exclusions', () => {
  const events = [ev('goal',1,'p1',1), ev('oppGoal',1,null,2), ev('excl',2,'p2',3), ev('goal',4,null,4),
                  ev('goal','SO','p1',5), ev('oppGoal','SO',null,6), ev('oppGoal','SO',null,7)];
  assert.deepEqual(m.deriveScore(events), { us: 2, them: 1, soUs: 1, soThem: 2 });
  assert.deepEqual(m.deriveScore([]), { us: 0, them: 0, soUs: 0, soThem: 0 });
});
test('hasShootout', () => {
  assert.equal(m.hasShootout('SO', []), true);
  assert.equal(m.hasShootout(4, [ev('goal','SO','a',1)]), true);
  assert.equal(m.hasShootout(4, [ev('goal',4,'a',1)]), false);
});
test('playerLines: per-player counts, sorted by cap, OUT at 3 exclusions', () => {
  const lineup = [{ playerId:'a', name:'Alexiou', cap:5 }, { playerId:'b', name:'Papadakis', cap:2 }];
  const events = [ev('goal',1,'a',1), ev('goal','SO','a',2), ev('excl',1,'b',3), ev('excl',2,'b',4), ev('excl',3,'b',5), ev('goal',2,null,6)];
  assert.deepEqual(m.playerLines(lineup, events), [
    { playerId:'b', name:'Papadakis', cap:2, goals:0, soGoals:0, excl:3, out:true },
    { playerId:'a', name:'Alexiou',   cap:5, goals:1, soGoals:1, excl:0, out:false },
  ]);
});
test('lastEvent: highest ts, ties to later index', () => {
  assert.equal(m.lastEvent([]), null);
  assert.equal(m.lastEvent([ev('goal',1,'a',5,'x'), ev('goal',1,'a',3,'y')]).id, 'x');
  assert.equal(m.lastEvent([ev('goal',1,'a',5,'x'), ev('goal',1,'a',5,'y')]).id, 'y');
});
test('timeline: newest period first, newest event first', () => {
  const t = m.timeline([ev('goal',1,'a',1,'1'), ev('oppGoal',2,null,3,'3'), ev('goal',1,'a',2,'2')]);
  assert.deepEqual(t.map(g => [g.period, g.events.map(e => e.id)]), [[2, ['3']], [1, ['2', '1']]]);
});
test('isDuplicateTap: same type + player within the window', () => {
  const prev = ev('goal', 1, 'a', 1000);
  assert.equal(m.isDuplicateTap(prev, 'goal', 'a', 1999), true);
  assert.equal(m.isDuplicateTap(prev, 'goal', 'a', 2000), false);
  assert.equal(m.isDuplicateTap(prev, 'excl', 'a', 1500), false);
  assert.equal(m.isDuplicateTap(prev, 'goal', 'b', 1500), false);
  assert.equal(m.isDuplicateTap(null, 'goal', 'a', 1500), false);
  assert.equal(m.isDuplicateTap(ev('oppGoal', 1, null, 1000), 'oppGoal', null, 1500), true);
});
test('playerHasEvents', () => {
  assert.equal(m.playerHasEvents([ev('excl',1,'a',1)], 'a'), true);
  assert.equal(m.playerHasEvents([ev('goal',1,null,1)], 'a'), false);
});
```

- [ ] **Step 3: Run** `npm test`. Expected: FAIL (cannot find module `js/model.js`).
- [ ] **Step 4: Implement the Task 1 exports in `js/model.js`.** Every function is pure and returns new objects; no imports.
- [ ] **Step 5: Run** `npm test`. Expected: all pass.
- [ ] **Step 6: Commit** `feat: game logic model`

---

### Task 2: Lineup, season and date logic

**Files:**
- Modify: `js/model.js`
- Test: `tests/unit/model.season.test.js`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces (in `js/model.js`):
  - `RosterPlayer = { id, name, cap: number, archived: boolean }`. `Selection = { playerId, name, cap: number|null, selected: boolean }`. `Game = { id, opponent, date, season, status: 'live'|'final', period, lineup: LineupEntry[], events: Event[] }`.
  - `CAP_MIN = 1`, `CAP_MAX = 99`
  - `defaultSelection(roster, previousGame|null) -> Selection[]`: only non-archived players, sorted by cap and then name. If there's no previous game, everyone is selected; otherwise only players in the previous game's lineup.
  - `assignCap(selection, playerId, cap) -> Selection[]`: preserves array order. If another **selected** player holds `cap`, the two swap caps.
  - `toggleSelected(selection, playerId) -> Selection[]`: when ticking a player whose cap is held by another selected player, the ticked player's cap becomes `null`.
  - `validateLineup(selection) -> [{ playerId: string|null, reason: 'noPlayers'|'missingCap'|'badCap'|'duplicateCap' }]`: checks selected players only, in selection order. Returns an empty array when the lineup is valid.
  - `lineupFrom(selection) -> LineupEntry[]`: selected players only, sorted by cap.
  - `rosterWithCaps(roster, lineup) -> RosterPlayer[]`
  - `seasonFor(isoDate) -> string`
  - `gameResult(game) -> { gameId, date, opponent, us, them, soUs?, soThem? }`: the `so*` keys are present only when `hasShootout`.
  - `aggregateSeason(games, roster) -> { players: { [id]: { name, games, goals, excl } }, results: Result[] }`: `status === 'final'` games only. Names come from the roster, falling back to the lineup snapshot. Shootout goals don't count. Results are sorted newest date first.
  - `formatDate(iso) -> 'DD/MM/YYYY'`, `todayIso(now = new Date(), timeZone = 'Europe/Athens') -> 'YYYY-MM-DD'`

- [ ] **Step 1: Write the failing tests** in `tests/unit/model.season.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../../js/model.js';
const ev = (type, period, playerId, ts) => m.makeEvent(type, period, playerId, ts, `e${ts}`);
const roster = [
  { id:'a', name:'Alexiou', cap:5, archived:false }, { id:'b', name:'Papadakis', cap:2, archived:false },
  { id:'c', name:'Georgiou', cap:7, archived:false }, { id:'z', name:'Old', cap:9, archived:true },
];
const caps = sel => sel.map(s => [s.playerId, s.cap]);

test('defaultSelection: no previous game → all active ticked, by cap', () => {
  assert.deepEqual(m.defaultSelection(roster, null), [
    { playerId:'b', name:'Papadakis', cap:2, selected:true },
    { playerId:'a', name:'Alexiou', cap:5, selected:true },
    { playerId:'c', name:'Georgiou', cap:7, selected:true },
  ]);
});
test('defaultSelection: previous game → only its lineup ticked', () => {
  const prev = { lineup: [{ playerId:'a', name:'Alexiou', cap:5 }] };
  assert.deepEqual(m.defaultSelection(roster, prev).map(s => [s.playerId, s.selected]), [['b',false],['a',true],['c',false]]);
});
test('assignCap swaps with the selected holder and does not mutate', () => {
  const sel = m.defaultSelection(roster, null);
  assert.deepEqual(caps(m.assignCap(sel, 'a', 2)), [['b',5],['a',2],['c',7]]);
  assert.equal(sel[1].cap, 5);
});
test('assignCap does not swap with an unselected holder', () => {
  const sel = m.assignCap(m.toggleSelected(m.defaultSelection(roster, null), 'b'), 'a', 2);
  assert.deepEqual(caps(sel), [['b',2],['a',2],['c',7]]);
});
test('toggleSelected: ticking into a collision clears the ticked cap', () => {
  let sel = m.toggleSelected(m.defaultSelection(roster, null), 'b');
  sel = m.toggleSelected(m.assignCap(sel, 'a', 2), 'b');
  assert.deepEqual(sel[0], { playerId:'b', name:'Papadakis', cap:null, selected:true });
  assert.deepEqual(m.validateLineup(sel), [{ playerId:'b', reason:'missingCap' }]);
});
test('validateLineup: ok, empty, bad, duplicate', () => {
  const base = m.defaultSelection(roster, null);
  assert.deepEqual(m.validateLineup(base), []);
  assert.deepEqual(m.validateLineup(base.map(s => ({ ...s, selected:false }))), [{ playerId:null, reason:'noPlayers' }]);
  for (const bad of [0, 100, 2.5]) {
    assert.deepEqual(m.validateLineup(base.map(s => s.playerId === 'c' ? { ...s, cap: bad } : s)), [{ playerId:'c', reason:'badCap' }]);
  }
  assert.deepEqual(m.validateLineup(base.map(s => s.playerId === 'c' ? { ...s, cap: 2 } : s)),
    [{ playerId:'b', reason:'duplicateCap' }, { playerId:'c', reason:'duplicateCap' }]);
});
test('lineupFrom and rosterWithCaps', () => {
  const lineup = m.lineupFrom(m.assignCap(m.defaultSelection(roster, null), 'a', 11));
  assert.deepEqual(lineup, [{ playerId:'b', name:'Papadakis', cap:2 }, { playerId:'c', name:'Georgiou', cap:7 }, { playerId:'a', name:'Alexiou', cap:11 }]);
  const r = m.rosterWithCaps(roster, lineup);
  assert.equal(r.find(p => p.id === 'a').cap, 11);
  assert.equal(r.find(p => p.id === 'z').cap, 9);
  assert.equal(roster[0].cap, 5);
});
test('seasonFor: 1 August cutoff', () => {
  assert.equal(m.seasonFor('2026-08-01'), '2026-27');
  assert.equal(m.seasonFor('2026-07-31'), '2025-26');
  assert.equal(m.seasonFor('2027-01-15'), '2026-27');
  assert.equal(m.seasonFor('2099-12-01'), '2099-00');
});
test('gameResult includes shootout only when there was one', () => {
  const g = { id:'g1', date:'2026-11-08', opponent:'Rivals', period:4, events:[ev('goal',1,'a',1), ev('oppGoal',2,null,2)] };
  assert.deepEqual(m.gameResult(g), { gameId:'g1', date:'2026-11-08', opponent:'Rivals', us:1, them:1 });
  assert.deepEqual(m.gameResult({ ...g, period:'SO', events:[...g.events, ev('goal','SO','a',3)] }),
    { gameId:'g1', date:'2026-11-08', opponent:'Rivals', us:1, them:1, soUs:1, soThem:0 });
});
test('aggregateSeason: final only, roster names, games played, no shootout goals', () => {
  const games = [
    { id:'g1', date:'2026-10-01', opponent:'A', status:'final', period:'SO',
      lineup:[{ playerId:'a', name:'Alex', cap:5 }, { playerId:'b', name:'Papadakis', cap:2 }, { playerId:'q', name:'Guest', cap:13 }],
      events:[ev('goal',1,'a',1), ev('excl',1,'b',2), ev('goal','SO','a',3), ev('goal',2,null,4)] },
    { id:'g2', date:'2026-10-08', opponent:'B', status:'final', period:4, lineup:[{ playerId:'a', name:'Alexiou', cap:5 }], events:[ev('goal',3,'a',1)] },
    { id:'g3', date:'2026-10-15', opponent:'C', status:'live', period:1, lineup:[{ playerId:'a', name:'Alexiou', cap:5 }], events:[ev('goal',1,'a',1)] },
  ];
  const s = m.aggregateSeason(games, roster);
  assert.deepEqual(s.players, {
    a: { name:'Alexiou', games:2, goals:2, excl:0 },
    b: { name:'Papadakis', games:1, goals:0, excl:1 },
    q: { name:'Guest', games:1, goals:0, excl:0 },
  });
  assert.deepEqual(s.results.map(r => r.gameId), ['g2', 'g1']);
});
test('formatDate and todayIso', () => {
  assert.equal(m.formatDate('2026-11-08'), '08/11/2026');
  assert.equal(m.todayIso(new Date('2026-11-12T22:30:00Z')), '2026-11-13');
});
```

- [ ] **Step 2: Run** `npm test`. Expected: the new tests FAIL (functions not exported).
- [ ] **Step 3: Implement the Task 2 exports in `js/model.js`.** `todayIso` uses `Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' })`.
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: lineup, season and date logic`

---

### Task 3: Local journal

**Files:**
- Create: `js/journal.js`
- Test: `tests/unit/journal.test.js`

**Interfaces:**
- Produces: `createJournal(storage, key = 'wp-journal') -> Journal`. `storage` is anything with `getItem`/`setItem`.
  - `Entry = { id: string, gameId: string, op: 'add'|'remove'|'replace', event: Event, status: 'pending'|'failed' }`. For `replace`, `event` is the new version of the event.
  - `record(gameId, op, event) -> Entry` (status `pending`, persisted)
  - `reconcile(gameId, serverEvents) -> { confirmed: number, failed: Entry[] }`. Applies to pending entries of that game only:
    - `add` is confirmed if a server event has `event.id`.
    - `remove` is confirmed if no server event has that id.
    - `replace` is confirmed if the server event with that id has the same `playerId` (both missing counts as the same).
    - Confirmed entries are deleted; unconfirmed ones become `failed`.
  - `failed(gameId?) -> Entry[]`, `markRetried(entryId)` (sets status back to `pending`), `discard(entryId)`
  - Callers run `reconcile` **only** on a game snapshot with `fromCache === false && hasPendingWrites === false`.

- [ ] **Step 1: Write the failing tests.** Use a `Map`-backed fake storage. Test names and assertions:
  - `add confirmed when server has the event`: `record('g','add',e1)`, then `reconcile('g',[e1])` returns `{confirmed:1, failed:[]}`, and `failed()` is `[]`.
  - `add failed when server lacks it, and it persists`: `reconcile('g',[])` → `failed[0].event.id === e1.id`. A fresh `createJournal(sameStorage).failed('g').length === 1`.
  - `remove semantics`: confirmed when the id is absent from the server; failed when present.
  - `replace semantics`: confirmed when the server copy has `playerId === 'p2'`; failed when it still has `'p1'`. Also confirmed when both lack `playerId`.
  - `reconcile only touches the given game`: a pending entry for `'h'` stays pending after `reconcile('g', [])`.
  - `markRetried and discard`: after `markRetried`, `failed()` is empty and the entry is pending again. After `discard`, it's gone from storage.
  - `corrupt storage starts empty`: `getItem` returns `'{not json'`. `createJournal` doesn't throw and `failed()` is `[]`.
  - `throwing storage falls back to memory`: `setItem` throws. `record` + `reconcile` still work within the instance.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `createJournal` in `js/journal.js`.** Store the entries as a JSON array under `key`. Entry ids come from `crypto.randomUUID()`.
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: local write journal`

---

### Task 4: Security rules + emulator tooling

**Prerequisite:** `java -version` reports JDK ≥ 21. If not, stop and report **BLOCKED: JDK 21 missing**. The main session asks the user before running `brew install openjdk@21`.

**Files:**
- Create: `firestore.rules`, `firebase.json`, `tests/emulator/rules.test.js`
- Modify: `package.json` (devDependencies + scripts), creating `package-lock.json`

**Interfaces:**
- Produces: `npm run test:emu` = `firebase emulators:exec --only firestore,auth --project demo-scoretracker "node --test \"tests/emulator/**/*.test.js\""`. The `test:e2e` script is added in Task 6.

- [ ] **Step 1: Install dev deps:** `npm i -D --save-exact firebase@12.19.0 firebase-tools@15.34.2 @firebase/rules-unit-testing@5.0.2`. Write `firebase.json`:
  `{"firestore":{"rules":"firestore.rules"},"emulators":{"firestore":{"host":"127.0.0.1","port":8080},"auth":{"host":"127.0.0.1","port":9099},"ui":{"enabled":false},"singleProjectMode":true}}`
- [ ] **Step 2: Write the failing tests** in `tests/emulator/rules.test.js`. Use `initializeTestEnvironment({ projectId:'demo-scoretracker', firestore:{ rules: readFileSync('firestore.rules','utf8'), host:'127.0.0.1', port:8080 } })`. In `beforeEach`: `clearFirestore()`, then seed `secrets/editCode = {code:'AB12CD'}` with rules disabled. Helpers seed `editors/{uid}` and `control/tracker` with rules disabled. Tests use `assertSucceeds`/`assertFails`:
  - `public can read team, games, stats, control`
  - `public cannot write team/main, games/g1, stats/2026-27, control/tracker, editors/x`
  - `secrets are unreadable, even by the active tracker`
  - `editor claim`: as `u1`, `editors/u1 {code:'ZZZZZZ'}` fails, `{code:'ab12cd'}` fails, `{code:'AB12CD', x:1}` fails, `{code:'AB12CD', claimedAt: serverTimestamp()}` succeeds
  - `cannot create editors doc for another uid`. `cannot read another uid's editors doc`; can read own.
  - `takeover`: a valid editor can set `control/tracker {activeUid: self}`; setting another uid fails; a signed-in non-editor fails
  - `valid editor who is not active cannot write games, team, stats`
  - `active tracker can write games, team, stats`
  - `changing the secret revokes`: after the secret is set to `'NEW999'` (rules disabled), the old active tracker can neither write `games/g1` nor take over
- [ ] **Step 3: Run** `npm run test:emu`. Expected: FAIL (no rules file, so everything is denied or loading errors).
- [ ] **Step 4: Write `firestore.rules`:**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function secretCode() { return get(/databases/$(database)/documents/secrets/editCode).data.code; }
    function signedIn() { return request.auth != null; }
    function isValidEditor() {
      return signedIn()
        && exists(/databases/$(database)/documents/editors/$(request.auth.uid))
        && get(/databases/$(database)/documents/editors/$(request.auth.uid)).data.code == secretCode();
    }
    function isActiveTracker() {
      return isValidEditor()
        && get(/databases/$(database)/documents/control/tracker).data.activeUid == request.auth.uid;
    }
    match /secrets/{id} { allow read, write: if false; }
    match /editors/{uid} {
      allow read, delete: if signedIn() && request.auth.uid == uid;
      allow create, update: if signedIn() && request.auth.uid == uid
        && request.resource.data.keys().hasOnly(['code', 'claimedAt'])
        && request.resource.data.code is string
        && request.resource.data.code.matches('^[0-9A-Z]{6}$')
        && request.resource.data.code == secretCode();
    }
    match /control/tracker {
      allow read: if true;
      allow write: if isValidEditor() && request.resource.data.activeUid == request.auth.uid;
    }
    match /team/main        { allow read: if true; allow write: if isActiveTracker(); }
    match /games/{gameId}   { allow read: if true; allow write: if isActiveTracker(); }
    match /stats/{season}   { allow read: if true; allow write: if isActiveTracker(); }
  }
}
```

- [ ] **Step 5: Run** `npm run test:emu`. Expected: all rules tests pass.
- [ ] **Step 6: Commit** `feat: firestore security rules with code-gated single tracker`

---

### Task 5: Config, Firebase init, repository layer

**Files:**
- Create: `js/config.js`, `js/firebase.js`, `js/repo.js`, `tests/emulator/helpers.js`, `tests/emulator/repo.test.js`

**Interfaces:**
- Consumes: `seasonFor`, `rosterWithCaps`, `aggregateSeason` (model). Rules from Task 4.
- Produces:
  - `js/config.js`: `firebaseConfig` (placeholder values `'REPLACE_ME'`), `team = { name: 'Our Team', accent: '#0057b8' }`, `EMULATOR = { projectId:'demo-scoretracker', host:'127.0.0.1', firestorePort:8080, authPort:9099 }`, `useEmulator(loc = globalThis.location) -> boolean`.
  - `js/firebase.js` (browser only):
    - `initFirebase({ emulator = useEmulator() } = {}) -> { app, db, auth }`. Uses `initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })`. In emulator mode it uses `initializeApp({ projectId, apiKey:'demo' })` plus `connectFirestoreEmulator` and `connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings:true })`.
    - `signIn(auth) -> Promise<string uid>`: waits for the first `onAuthStateChanged`, then reuses the persisted user or calls `signInAnonymously`.
  - `js/repo.js`: `createRepo(db) -> Repo`. Every snapshot callback is `(data|null, meta: { fromCache, hasPendingWrites })`; game data includes `id`.
    - `watchTeam(cb)`, `watchGame(gameId, cb)`, `watchStats(season, cb)`, `watchControl(cb)`, `watchOwnEditor(uid, cb)`. Each returns an unsubscribe function.
    - `listGames() -> Promise<Game[]>`: date descending.
    - `unlock(uid, code) -> Promise<void>`: writes `editors/{uid} {code, claimedAt}` and then calls `takeOver(uid)`. It rejects with the Firestore error (`code === 'permission-denied'` for a wrong code). If `navigator.onLine === false` it rejects immediately with `{ code: 'unavailable' }`.
    - `takeOver(uid) -> Promise<void>`
    - `saveRoster(roster) -> Promise<void>`: `team/main` merge.
    - `createGame({ opponent, date, lineup, roster }) -> { id, done: Promise<void> }`: one batch that creates the game (`season: seasonFor(date)`, `status:'live'`, `period:1`, `events:[]`, timestamps) and merges `team/main` with `currentGameId: id` and `roster: rosterWithCaps(roster, lineup)`.
    - `addEvent(gameId, event)` (`arrayUnion`), `removeEvent(gameId, event)` (`arrayRemove`), `replaceEvent(gameId, oldEvent, newEvent)` (one batch: remove, then union). Each returns a Promise.
    - `setPeriod(gameId, period)`, `setLineup(gameId, lineup, roster)` (batch: game lineup + team roster caps), `endGame(gameId)` (`status:'final'`), `reopenGame(gameId)` (`status:'live'` + `team.currentGameId`), `deleteGame(gameId)`. After a delete, `currentGameId` points at the newest remaining game by date, or `null`.
    - `recomputeSeason(season) -> Promise<void>`: `getDocsFromServer` on games where `season == season`, then `aggregateSeason`, then `setDoc(stats/{season}, {...agg, updatedAt})`. It rejects when offline.
    - Every write also sets `updatedAt: serverTimestamp()` on the doc it touches.
- [ ] **Step 1: Write the failing tests.** `tests/emulator/helpers.js` exports two things:
  - `makeClient(name)`: a named modular app with the default memory cache, connected to both emulators and signed in anonymously. Returns `{ db, uid, repo }`.
  - `testEnv`: rules-unit-testing, used for seeding and clearing.

  Seed `secrets/editCode = 'AB12CD'` before each test. The tests in `repo.test.js`:
  - `unlock rejects a wrong code with permission-denied and leaves control untouched`
  - `unlock with the right code makes this uid the active tracker` (`control/tracker.activeUid === uid`)
  - `createGame writes a live game, sets team.currentGameId and roster caps`: lineup cap 11 for player `a` → `team.roster` entry `a` has cap 11; game `season === '2026-27'` for date `2026-11-08`
  - `add, replace, remove events round-trip; unknown-scorer goal has no playerId field`
  - `endGame marks final and writes stats/{season}`: `players.a.goals === 1`, `results.length === 1`
  - `after takeover by a second client, the first client's addEvent rejects with permission-denied`
  - `deleteGame repoints currentGameId to the newest remaining game and recomputeSeason drops it`
- [ ] **Step 2: Run** `npm run test:emu`. Expected: the repo tests FAIL (module missing).
- [ ] **Step 3: Implement `js/config.js`, `js/repo.js`, `js/firebase.js`** as specified above.
- [ ] **Step 4: Run** `npm run test:emu`. Expected: all pass (rules + repo).
- [ ] **Step 5: Commit** `feat: firebase init and repository layer`

---

### Task 6: Viewer page (+ shared UI foundation, Playwright harness)

**Files:**
- Create: `index.html`, `css/base.css`, `css/viewer.css`, `js/strings.js`, `js/ui/dom.js`, `js/viewer.js`, `scripts/serve.mjs`, `playwright.config.js`, `tests/e2e/helpers.js`, `tests/e2e/viewer.spec.js`, `tests/unit/strings.test.js`
- Modify: `package.json` (`@playwright/test@1.64.1` exact; script `"test:e2e": "firebase emulators:exec --only firestore,auth --project demo-scoretracker \"playwright test\""`)

**Interfaces:**
- Consumes: `createRepo`, `initFirebase`. The viewer does not call `signIn` because public reads need no auth. Model: `deriveScore`, `hasShootout`, `playerLines`, `timeline`, `formatDate`, `seasonFor`, `todayIso`.
- Produces:
  - `js/strings.js`:
    - `t(key, params = {}) -> string`, with `{name}` interpolation. A missing key returns the key itself and logs `console.warn`.
    - `periodLabel(p)`: `'Q1'…'Q4'`, `'Shootout'`.
    - `eventLabel(event, lineup)` returns one of:
      - `'Goal · #5 Alexiou'`
      - `'Goal · scorer unknown'`
      - `'Exclusion · #2 Papadakis'`
      - `'Opponent goal'`
      - `'#? Unknown player'` when the player isn't in the lineup
    - `scoreText(score, shootout) -> { main: '9 – 9', shootout: '(4 – 3 pen.)' | null }` (en dash with spaces)
  - `js/ui/dom.js`: `h(tag, attrs, ...children) -> Element` (`class`, `on*` handlers, `data-*`, `disabled`, other attributes; children may be strings, nodes, arrays or null/false) and `clear(el)`.
  - `scripts/serve.mjs <port>`: static server for the repo root on `127.0.0.1`, with correct MIME types and `Cache-Control: no-store`.
  - `tests/e2e/helpers.js`: `seed(path, data)`, `update(path, data)`, `remove(path)` (rules disabled), and `resetAll()` (clear Firestore + `DELETE http://127.0.0.1:9099/emulator/v1/projects/demo-scoretracker/accounts`).
  - `playwright.config.js`: `workers: 1`; webServer `node scripts/serve.mjs 4173`; projects `chromium` and `webkit` (`devices['iPhone 15']`).
  - Viewer DOM test ids: `score-us`, `score-them`, `shootout`, `period`, `live-badge`, `final-badge`, `player-row` (with `data-cap`), `player-goals`, `player-excl`, `player-out`, `timeline-item`, `result-row`, `season-row`, `empty-state`, `connection-note`, `game-date`.
- [ ] **Step 1: Write the failing unit test** `tests/unit/strings.test.js`. It asserts the `eventLabel` outputs listed above and that `scoreText({us:9,them:9,soUs:4,soThem:3}, true)` deep-equals `{ main:'9 – 9', shootout:'(4 – 3 pen.)' }`. With `false`, `shootout` is `null`.
- [ ] **Step 2: Write the failing e2e specs** in `tests/e2e/viewer.spec.js`. Open `/index.html?emulator=1` and call `resetAll()` before each test:
  - `empty state when there is no team or game`: `empty-state` is visible.
  - `live game`: seed `team/main {currentGameId:'g1', roster}` and game `g1` (period 2, live, date `2026-11-08`, events giving 3–2 and player cap 2 with 3 exclusions).
    - `score-us` = `3`, `score-them` = `2`, `period` = `Q2`, `live-badge` visible, `game-date` = `08/11/2026`.
    - The `player-row[data-cap="2"]` row contains a visible `player-out`.
    - The first `timeline-item` contains `Q2`.
  - `updates live without reload`: `update` adds a goal event; `score-us` becomes `4` within 5 s.
  - `final with shootout and season tables`: seed a final game in period `SO` with a 9–9 (4–3) score, plus `stats/2026-27` with 2 results and 2 players.
    - `final-badge` is visible and `shootout` = `(4 – 3 pen.)`.
    - There are 2 `result-row`s, and `season-row`s are sorted by goals descending.
  - `game deleted while watching → empty state`: delete `games/g1` while the page is open; `empty-state` becomes visible, and there's no page error (`page.on('pageerror')` collects none).
- [ ] **Step 3: Run** `npm test` (strings fail) and `npm run test:e2e` (viewer fails). Install browsers first: `npx playwright install chromium webkit`.
- [ ] **Step 4: Implement** `strings.js`, `dom.js`, `serve.mjs`, `index.html` (import map per Global Constraints, `<meta name="viewport">`, theme-color, `css/base.css` + `css/viewer.css`, `<script type="module" src="js/viewer.js">`), and `viewer.js`.
  - `viewer.js`: `watchTeam` → `watchGame(team.currentGameId)` → `watchStats(game.season)`, falling back to `seasonFor(todayIso())` when there's no game. Re-subscribe when `currentGameId` changes. While offline, show `connection-note`.
  - Layout per the spec's Viewer page section.
- [ ] **Step 5: Run** `npm test` and `npm run test:e2e`. Expected: all pass on chromium and webkit.
- [ ] **Step 6: Commit** `feat: public live viewer`

---

### Task 7: Tracker shell, unlock, takeover, home, roster

**Files:**
- Create: `track.html`, `css/tracker.css`, `js/tracker/app.js`, `js/tracker/views/unlock.js`, `js/tracker/views/home.js`, `js/tracker/views/roster.js`, `tests/e2e/tracker-access.spec.js`, `tests/e2e/tracker-roster.spec.js`

**Interfaces:**
- Consumes: `initFirebase`, `signIn`, `createRepo`, `createJournal(localStorage)`, `t`, `h`.
- Produces:
  - **App state:** `{ uid, editor: 'unknown'|'none'|'valid', active: boolean, online: boolean, team, control, failedTaps: Entry[], route, notice: string|null }`. `active = control?.activeUid === uid`.
  - **Routes (hash):** `#/`, `#/roster`, `#/new`, `#/live`, `#/games`, `#/games/<id>`. A gate shows `unlock` whenever `editor !== 'valid'`.
  - **View contract:** `mount(root, ctx) -> { update(state), unmount() }`, where `ctx = { repo, journal, navigate(route), getState(), onWriteError(err) }`. Views with text inputs ignore `update` while an input has focus.
  - **`onWriteError(err)`** handles `permission-denied` two ways:
    - If `state.active`, the code was revoked: set `editor = 'none'` and `notice = t('codeChanged')`, then show unlock.
    - Otherwise, the takeover banner is already showing.
    - Any other error is shown as a toast.
  - **Read-only mode:** every write control carries `data-write`. While `!state.active`, the app disables them all and shows the takeover banner (test id `takeover-banner`, button `take-over`).
  - **Test ids:** `code-input`, `unlock-btn`, `unlock-error`, `home-resume`, `home-new`, `home-roster`, `home-games`, `roster-row` (`data-player-id`), `roster-add-name`, `roster-add-cap`, `roster-add-btn`, `roster-archive`.
- [ ] **Step 1: Write the failing e2e specs.** Seed `secrets/editCode='AB12CD'` in `beforeEach`.

  `tracker-access.spec.js`:
  - `code input upper-cases and keeps only 6 of 0-9A-Z`: type `ab1-2cdx`; the value is `AB12CD`.
  - `wrong code shows error and stays locked`.
  - `right code unlocks and survives reload`: after reload, `home-new` is visible without entering the code again.
  - `second device takes over; first becomes read-only and can take back`: two browser contexts. A's `home-new` is disabled and `takeover-banner` is visible; after A clicks `take-over`, B shows the banner.
  - `revoked code: next write shows unlock with code-changed notice`: unlock, then `update('secrets/editCode', {code:'NEW999'})`, then add a roster player. `code-input` becomes visible along with the notice text.

  `tracker-roster.spec.js`:
  - `add, edit, archive players; persists across reload`: add Alexiou #5 and Papadakis #2; rows are sorted by cap; rename one; archive one, and it moves to the archived section. Reload: same state.
  - `rejects empty name and cap outside 1–99`.
- [ ] **Step 2: Run** `npm run test:e2e`. Expected: the new specs FAIL.
- [ ] **Step 3: Implement** `track.html` (same import map, `css/base.css` + `css/tracker.css`, entry `js/tracker/app.js`), `app.js` (boot: `initFirebase`, then `signIn`, then watchers for own editor, control, team, `online`/`offline` events), and the three views.
  - **Unlock:** `inputmode="text"`, `autocapitalize="characters"`, `maxlength=6`, filtered on input. When offline it shows `t('unlockNeedsConnection')`.
- [ ] **Step 4: Run** `npm run test:e2e`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: tracker unlock, takeover, home and roster`

---

### Task 8: New game + live tracking

**Files:**
- Create: `js/tracker/taps.js`, `js/tracker/views/newgame.js`, `js/tracker/views/live.js`, `tests/unit/taps.test.js`, `tests/e2e/tracker-live.spec.js`
- Modify: `js/tracker/app.js` (game watcher with journal reconcile, failed-taps banner)

**Interfaces:**
- Consumes: model (`defaultSelection`, `assignCap`, `toggleSelected`, `validateLineup`, `lineupFrom`, `makeEvent`, `isDuplicateTap`, `lastEvent`, `deriveScore`, `hasShootout`, `playerLines`, `nextPeriod`, `todayIso`), `repo`, `journal`, `strings`.
- Produces:
  - `createTapper({ repo, journal, getGame, isActive, onError, now = Date.now, vibrate = (ms) => navigator.vibrate?.(ms) }) -> Tapper`:
    - `tap(type, playerId|null) -> Event|null`. Returns `null` if the device isn't active, there's no live game, the player is OUT (for `goal`/`excl`), or the tap is a duplicate of **this device's last tap**.
      - Otherwise it builds the event with `makeEvent(type, game.period, playerId, now())`.
      - Then it calls `journal.record(game.id,'add',e)`, then `repo.addEvent(game.id,e).catch(onError)` (not awaited), then `vibrate(30)`.
    - `undo() -> Event|null`: journals `remove` of `lastEvent(game.events)` and calls `repo.removeEvent`.
    - `retryFailed(gameId)`: re-issues each failed entry's op after `markRetried`. `discardFailed(gameId)`.
  - `app.js` `watchGameWithJournal(gameId, cb)`: wraps `repo.watchGame`. On server-confirmed snapshots (`!fromCache && !hasPendingWrites`) it runs `journal.reconcile` and refreshes `state.failedTaps`.
  - **Failed-taps banner:** test id `failed-banner`, text `t('tapsNotSaved', {n})`, buttons `retry-failed` and `discard-failed`.
  - **New game:**
    - `previousGame` is the game `team.currentGameId` points at.
    - If a live game exists, the form is replaced by a link to resume it (`t('endLiveGameFirst')`).
    - Test ids: `opponent-input`, `date-input`, `sel-row` (`data-player-id`), `sel-check`, `sel-cap`, `sel-error`, `start-game`.
  - **Live screen test ids:**
    - Header and score: `score-us`, `score-them`, `shootout`, `period-next` (label = current period; disabled at `SO`).
    - Per player: `tile` (`data-cap`), `tile-goal`, `tile-excl`, `tile-goals`, `tile-excl-count`, `tile-out`.
    - Controls: `opp-goal`, `undo` (label `t('undo', {label: eventLabel(e, lineup), period: periodLabel(e.period)})` → `Undo: Goal · #5 Alexiou (Q1)`; disabled when there are no events), `events-open` (wired in Task 9), `sync-status` (`online` / `offline — taps saved, will sync`).
  - **Wake lock:** request `navigator.wakeLock.request('screen')` on mount, re-request on `visibilitychange` → visible, and release on unmount. Ignore when unsupported.
- [ ] **Step 1: Write the failing unit tests** `tests/unit/taps.test.js`. The fakes record calls:
  - `records journal entry before calling repo.addEvent`: the order of calls is asserted.
  - `ignores duplicate tap within 1000 ms, accepts after`: `now` is stubbed at 0, then 500, then 1000; that gives 1 call, then 2 calls.
  - `no-op when inactive or no live game`.
  - `no-op for goal/excl on an OUT player; oppGoal still works`.
  - `undo removes lastEvent and journals remove`.
  - `repo rejection is passed to onError`.
  - `retryFailed re-issues add/remove/replace with the original event objects`.
- [ ] **Step 2: Write the failing e2e** `tests/e2e/tracker-live.spec.js`. Seed the roster (Papadakis #2, Alexiou #5, Georgiou #7) and unlock in `beforeEach`.
  - `new game: all ticked, cap swap, duplicate blocked, start`:
    - Set Alexiou's `sel-cap` to 2; Papadakis's shows 5.
    - Untick Georgiou, set Papadakis's cap to 7, re-tick Georgiou. Georgiou's cap is empty, his `sel-error` is visible, and `start-game` is disabled.
    - Fix the cap, then start: the live screen is shown.
  - `goal, exclusion, opponent goal, undo label`: GOAL on cap 5 → `score-us` 1 and `undo` text `Undo: Goal · #5 Alexiou (Q1)`. `opp-goal` → `score-them` 1. `undo` → `score-them` 0.
  - `third exclusion marks OUT and disables tile buttons`.
  - `period button advances to Shootout and stops; shootout goal shown separately`.
  - `double tap records one goal`: `dblclick` on `tile-goal` → `score-us` 1.
  - `viewer updates live from tracker taps`: a second context opens `/index.html?emulator=1`; after 2 tracker goals, the viewer `score-us` reads 2 within 5 s.
  - `next new game defaults to previous lineup and last caps`: end via `repo` helper `update('games/<id>', {status:'final'})`, open New game; ticks and caps match the previous game.
- [ ] **Step 3: Run** `npm test` and `npm run test:e2e`. Expected: new tests FAIL.
- [ ] **Step 4: Implement** `taps.js`, `newgame.js`, `live.js`, and the `app.js` additions. The live layout follows the spec sketch: one column of tiles in portrait, two columns in landscape (≥ 700 px wide); GOAL is the largest target in each tile; `opp-goal` and `undo` are pinned at the bottom with `env(safe-area-inset-bottom)` padding.
- [ ] **Step 5: Run** `npm test` and `npm run test:e2e`. Expected: all pass.
- [ ] **Step 6: Commit** `feat: new game setup and live tracking`

---

### Task 9: Events sheet, lineup edits, end/reopen/delete, past games, stats recompute

**Files:**
- Create: `js/tracker/statsQueue.js`, `js/tracker/views/events.js`, `js/tracker/views/lineup.js`, `js/tracker/views/games.js`, `tests/unit/statsQueue.test.js`, `tests/e2e/tracker-events.spec.js`
- Modify: `js/tracker/views/live.js` (wire `events-open`), `js/tracker/app.js` (drain the stats queue on boot and on `online`)

**Interfaces:**
- Consumes: `repo`, `journal`, model (`timeline`, `withPlayer`, `prevPeriod`, `makeEvent`, `assignCap`, `validateLineup`, `playerHasEvents`, `gameResult`, `formatDate`), `eventLabel`, `periodLabel`.
- Produces:
  - `createStatsQueue(storage, recompute: (season) => Promise<void>, key = 'wp-stats-dirty') -> { markDirty(season), drain() -> Promise<{ done: string[], failed: string[] }>, dirty() -> string[] }`. Seasons are unique and persisted. A `drain()` call made while another is in flight returns that same promise.
  - Every end / reopen / delete, and every event or lineup change to a `final` game, calls `markDirty(game.season)` and then `drain()`.
  - **In-page confirm** (End game, Delete game): the first tap arms the button (label `t('tapAgainToConfirm')`) for 4 s; a second tap within that window performs the action.
  - **Events sheet** (overlay on the live screen and on the past-game detail):
    - Lists all events newest first: `ev-row` with a `ev-delete` button and, for goals, an `ev-scorer` `<select>` (lineup players + "Scorer unknown"). Delete journals `remove`; a scorer change journals `replace` and calls `repo.replaceEvent`.
    - Actions: `add-unknown-goal`, `period-prev`, `open-lineup`, `end-game`.
  - **Lineup sheet:**
    - Rows `lu-row` with `lu-cap` (assignCap semantics over the lineup) and `lu-remove`, shown only when `!playerHasEvents`.
    - `lu-add` select lists roster players not in the lineup; `lu-save` calls `repo.setLineup` and is disabled while `validateLineup` reports errors.
  - **Past games:**
    - The list shows `game-row` rows (date `DD/MM/YYYY`, opponent, score).
    - The detail view has `reopen-game` (disabled with a note while another game is live), `delete-game`, and the events sheet inline.
- [ ] **Step 1: Write the failing unit tests** `tests/unit/statsQueue.test.js`:
  - `markDirty dedupes and persists`
  - `drain removes successes, keeps failures`: recompute rejects for `'2025-26'` → `{ done:['2026-27'], failed:['2025-26'] }` and `dirty()` is `['2025-26']`.
  - `concurrent drain shares one run`: recompute is called once per season.
- [ ] **Step 2: Write the failing e2e** `tests/e2e/tracker-events.spec.js`, starting from a live game created through the UI:
  - `delete an earlier event`: 3 goals; delete the oldest from the sheet → `score-us` 2. The viewer timeline shows 2 goals.
  - `scorer-unknown goal, then assign scorer`: `add-unknown-goal` → score +1 and no tile goal; set `ev-scorer` to Alexiou → his `tile-goals` is 1.
  - `lineup: add forgotten player and swap caps mid-game`: a new tile appears; the caps swap.
  - `previous period from the sheet`.
  - `end game needs a second tap; viewer shows Final and season stats`.
  - `past games: reopen then delete`: after the delete, the viewer shows `empty-state` (it was the only game), and `stats/<season>` has no results.
- [ ] **Step 3: Run** `npm test` and `npm run test:e2e`. Expected: new tests FAIL.
- [ ] **Step 4: Implement** `statsQueue.js`, the three views, and the wiring.
- [ ] **Step 5: Run** `npm test` and `npm run test:e2e`. Expected: all pass.
- [ ] **Step 6: Commit** `feat: event corrections, lineup edits, game history and season stats`

---

### Task 10: Service worker + offline and takeover end-to-end

**Files:**
- Create: `sw.js`, `js/sw-register.js`, `tests/unit/sw-shell.test.js`, `tests/e2e/offline.spec.js`
- Modify: `js/viewer.js`, `js/tracker/app.js` (import `sw-register.js`)

**Interfaces:**
- Produces:
  - **`sw.js`** (classic script):
    - `const CACHE = 'wp-shell-v1'`. A `SHELL` array lists every local page/CSS/JS file plus the three pinned gstatic SDK URLs, between the comment markers `// SHELL-START` and `// SHELL-END`.
    - install: `addAll(SHELL)`. activate: delete other caches, `clients.claim()`.
    - fetch:
      - same-origin GET is **network-first** with cache fallback (`ignoreSearch: true`) and refreshes the cache entry;
      - `https://www.gstatic.com/firebasejs/` GET is **cache-first**, storing on a miss;
      - everything else (Firestore/Auth traffic) is not intercepted.
  - `js/sw-register.js`: registers `./sw.js` when `'serviceWorker' in navigator`. Errors are logged, never thrown.
- [ ] **Step 1: Write the failing unit test** `tests/unit/sw-shell.test.js`. It parses the `SHELL` strings between the markers, then asserts:
  - every relative entry exists on disk;
  - every `*.html` at the root and every file under `js/` and `css/` is listed;
  - the gstatic entries contain `12.19.0`.
- [ ] **Step 2: Write the failing e2e** `tests/e2e/offline.spec.js` (chromium only; `test.skip` for others):
  - `reloads offline into the live game with all taps`:
    - Set up online: unlock, create a game, 2 goals. Wait for `navigator.serviceWorker.ready`.
    - `context.setOffline(true)`, 1 more goal → `sync-status` shows offline text and `score-us` reads 3.
    - `page.reload()` while offline → the live screen shows 3.
    - `setOffline(false)` → a separate viewer context shows 3 within 10 s.
  - `taps after losing control are flagged, retried after taking back`:
    - Device A goes offline and taps a goal. Device B takes over online. A comes back online.
    - A shows `failed-banner` with `1`, and the viewer score is unchanged.
    - A clicks `take-over`, then `retry-failed` → the viewer `score-us` increments and the banner disappears.
- [ ] **Step 3: Run** `npm test` and `npm run test:e2e`. Expected: new tests FAIL.
- [ ] **Step 4: Implement** `sw.js` and `sw-register.js`, and import the registration from both entry modules.
- [ ] **Step 5: Run** `npm test` and `npm run test:e2e`. Expected: all pass.
- [ ] **Step 6: Commit** `feat: offline app shell`

---

### Task 11: Local dev script, README, session log

**Files:**
- Create: `scripts/seed-emulator.mjs`, `README.md`, `docs/session-log.md`
- Modify: `package.json` (script `"dev": "firebase emulators:exec --only firestore,auth --project demo-scoretracker \"node scripts/seed-emulator.mjs && node scripts/serve.mjs 4173\""`)

- [ ] **Step 1: `scripts/seed-emulator.mjs`** sets `secrets/editCode = {code:'TEST01'}` with rules disabled and prints the two local URLs (`/index.html?emulator=1`, `/track.html?emulator=1`).
- [ ] **Step 2: Verify** with `npm run dev`. Open `http://127.0.0.1:4173/track.html?emulator=1`, unlock with `TEST01`, add a player, start a game, and tap a goal; check that the viewer URL shows it. Stop with Ctrl-C.
- [ ] **Step 3: `README.md`** covers the following, in order:
  - What it is: the viewer URL and tracker URL.
  - Firebase setup, the spec's steps 1–6, written as exact console clicks:
    - Firestore location `eur3`;
    - the code doc `secrets/editCode` with a `code` string matching `^[0-9A-Z]{6}$`;
    - pasting `firestore.rules`;
    - adding `<user>.github.io` to Auth authorized domains.
  - Filling in `js/config.js` (team name, accent).
  - GitHub Pages: Settings → Pages → Deploy from branch `main` / root.
  - Day-to-day use: unlock, roster, new game, the live screen, corrections, end game.
  - Changing the code (it revokes all devices).
  - Free-plan quota: ~1,000 viewer-games/day, and what happens when it's exceeded.
  - Privacy note: names are public; for minors, use first name + surname initial.
  - Local development: JDK 21, `npm install`, `npx playwright install chromium webkit`, `npm test`, `npm run test:emu`, `npm run test:e2e`, `npm run dev`.
- [ ] **Step 4: Run the full suite:** `npm test && npm run test:emu && npm run test:e2e`. Expected: all pass.
- [ ] **Step 5: `docs/session-log.md`**: a 5–10 line "where we left off" note (what was built, test status, the user's remaining setup steps from the README).
- [ ] **Step 6: Commit** `docs: README, local dev script, session log`
