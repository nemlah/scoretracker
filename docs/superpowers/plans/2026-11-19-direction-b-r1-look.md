# Direction B, Release 1 (the look) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the viewer and the tracker direction B's look (tokens, fonts, scoreboard, controls, brand files) on today's page structure, with no class or test-id changes.

**Architecture:** Mostly CSS: new token values and new custom properties in `css/base.css` (viewer dark overrides in `css/viewer.css`, tracker overrides in `css/tracker.css`), then each app's rules restyled onto them. One small pure module, `js/accent.js`, computes the two club-colour properties. It is loaded with a caught dynamic `import()`, so a phone whose cache lacks it keeps the CSS fallbacks. Brand files (icons, manifest, link preview) are generated once by a Playwright script and committed.

**Tech Stack:** Vanilla ES modules, plain CSS custom properties, `node --test` unit tests, Playwright e2e against the Firebase emulators, service-worker app shell (`sw.js`).

**Spec:** `docs/superpowers/specs/2026-11-19-direction-b-redesign-design.md`, section "Release 1 — the look", plus "Constraints (all releases)". Token values are copied from there; where this plan and the spec differ, the spec wins, except for the one decision noted under Task 1.

## Global Constraints

- **No DOM structure changes, class renames or test-id changes** in R1. Existing unit, emulator and e2e suites pass **unchanged**. Visible wording is unchanged: e2e asserts it.
- **Mixed cache:**
  - Every new custom property (`--muted`, `--line-strong`, `--board`, `--board-line`, `--board-muted`, `--led`, `--out-text`, `--accent-on-board`, `--on-accent`) is read with a fallback outside `base.css`, e.g. `var(--board, #0B1320)`, `var(--on-accent, #FFFFFF)`, `var(--accent-on-board, var(--accent))`.
  - No new named imports. `js/accent.js` is only ever loaded through a caught dynamic `import()`.
- **Colours only through tokens:** after Tasks 3 and 4, every hex colour in `css/viewer.css` and `css/tracker.css` sits in a custom-property declaration.
- **Type weights:** body text uses Sofia Sans 400/600/700. Numbers use Sofia Sans Extra Condensed 700/800. Any rule that sets `font-weight: 600` on `var(--font-num)` moves to 700.
- **Shape:** radii are 4 (badges), 6 (buttons, inputs), 8 (cards, tiles) and 12 (sheet tops). Spacing steps are 4/8/12/16/24/32. Controls are at least 44 px.
- **360 px:** no sideways scroll at 360 px wide, portrait or landscape, with two-digit caps and the longest names in the e2e seeds.
- **Reduced motion:** every animation keeps its `prefers-reduced-motion: reduce` variant.
- **e2e:**
  - No `waitForTimeout`, except to check that nothing happened.
  - Every assertion must be able to fail.
  - Focused run: `firebase emulators:exec --only firestore,auth --project demo-scoretracker "npx playwright test <file> --reporter=list"`. `npm run test:e2e -- <file>` ignores the file argument.
- **Commits:** the controller commits Codex's work; Codex's sandbox can't commit here. Each commit carries the trailer of the model that wrote it.

## Review Focus

1. **Stale base.css:** a fresh `viewer.css` or `tracker.css` loaded beside a stale `base.css` should still look right. That holds if every new property is read with a fallback; the Task 2 test `new properties are read with a fallback outside base.css` pins it.
2. **Dark mode:** the viewer in dark mode should never show a white block or dark-on-dark text. Task 3's test `viewer.css colours live in tokens` and the dark assertions in `viewer-look.spec.js` pin it.
3. **360 px with fonts:** at 360 px, nothing should overflow, both with Sofia loaded and with Google Fonts blocked (fallback stack). Task 3 and Task 4 look specs pin it.
4. **Other club colours:** a club colour other than blue should still give readable caps and a visible board bar. Task 1 unit tests over blue, red, yellow and green pin it.
5. **Celebration:** the GOAL banner should read amber on the board, in light and dark. Task 3's `viewer-look.spec.js` celebration assertion pins it.

---

### Task 1: Club-colour pair module (Codex, medium)

**Files:**
- Create: `js/accent.js`
- Create: `tests/unit/accent.test.js`
- Modify: `js/viewer.js:21` (after the `--accent` line)
- Modify: `js/tracker/app.js:27` (after the `--accent` line)
- Modify: `sw.js` SHELL list: add `'./js/accent.js'` after `'./js/celebrate.js'` (`tests/unit/sw-shell.test.js` requires it)

**Decision (deviates from the spec's "inline the helper"):** a separate module loaded with a caught dynamic `import()`. It is unit-testable, and a phone whose cache lacks the file keeps the CSS fallbacks, which is the same mixed-cache safety the spec asked for.

**Interfaces:**
- Produces:
  - `contrastRatio(a: string, b: string): number`, the WCAG 2.x ratio of two `#rrggbb` colours (case-insensitive).
  - `accentPair(accent: string): { onAccent: string, accentOnBoard: string }`, with lowercase `#rrggbb` outputs.
  - Task 2's token test imports `contrastRatio`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/accent.test.js`:
  - `contrastRatio('#ffffff', '#000000')` is 21 (±0.01); `contrastRatio('#0b1320', '#0b1320')` is 1.
  - **`onAccent`:** `'#ffffff'` for blue `#0057b8`, red `#c8102e` and green `#00843d`; `'#0b1320'` for yellow `#f2b705`. For each, the chosen text has the higher contrast of the two.
  - **`accentOnBoard`, contrast:** for each of the four colours, `contrastRatio(accentOnBoard, '#0b1320') >= 3`.
  - **`accentOnBoard`, unchanged colours:** yellow `#f2b705`, which already clears 3:1, is returned unchanged.
  - **`accentOnBoard`, smallest step:** blue is returned lighter than `#0057b8`, and the step before it (5 % less white) is below 3:1.
  - **Bad input:** `accentPair('blue')` returns `{ onAccent: '#ffffff', accentOnBoard: 'blue' }`, so the CSS keeps working.
- [ ] **Step 2:** Run `node --test tests/unit/accent.test.js`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `js/accent.js`.**
  - Board and ink are both `#0b1320`. A colour that clears 3:1 on `#0b1320` also clears it on the darker viewer-dark board `#05090f`, so one board value covers both.
  - The mixing algorithm (the canvas boards use the same one):

    ```js
    // mix(a, b, t): per sRGB channel Math.round(a*(1-t) + b*t), back to lowercase #rrggbb
    // accentOnBoard: for t = 0, 0.05, 0.10 … 1: first mix(accent, '#ffffff', t) with ratio >= 3 on '#0b1320'
    ```
- [ ] **Step 4: Wire it in.** In `js/viewer.js` and `js/tracker/app.js`, right after the `--accent` line:

  ```js
  import('./accent.js').then(({ accentPair }) => {          // '../accent.js' in app.js
    const pair = accentPair(teamConfig.accent);
    document.documentElement.style.setProperty('--on-accent', pair.onAccent);
    document.documentElement.style.setProperty('--accent-on-board', pair.accentOnBoard);
  }).catch(() => {});
  ```
  Add `'./js/accent.js'` to SHELL.
- [ ] **Step 5:** Run `npm test`. Expected: all unit tests pass, including `sw-shell`.
- [ ] **Step 6: Commit** (controller): `feat(look): club-colour pair for caps and the board bar`.

---

### Task 2: Tokens, fonts and the token contrast test (Codex, medium)

**Files:**
- Modify: `css/base.css:1-12`, `css/viewer.css:5-15` (the dark `:root` block), `css/tracker.css:180-186`
- Modify: `index.html:6-11`, `track.html:6-11`
- Create: `tests/unit/tokens.test.js`

**Interfaces:**
- Consumes: `contrastRatio` from `js/accent.js` (Task 1).
- Produces: the custom properties and values in the spec's three token tables ("Tokens", "New properties", "Tracker properties"). Tasks 3–4 use these names.

- [ ] **Step 1: Write the failing tests** in `tests/unit/tokens.test.js`. Read the custom properties of three blocks with a regex: base.css `:root`, the viewer.css `@media (prefers-color-scheme: dark) :root`, and the tracker.css `:root` that holds `--pen`. Then test:
  - **`light tokens meet contrast`.** Light means base.css, plus tracker.css for the tracker tokens.
    - At 4.5:1: `ink/paper`, `ink/pool`, `muted/paper`, `muted/pool`, `water-text/paper`, `water-text/pool`, `rope/paper`, `out-text/paper`, `led/board`, `board-muted/board`, `#ffffff/sit-up-strong`, `ink/sit-down-strong`, `#ffffff/pen`, `ink/sit-up`, `ink/sit-down`, `ink/led`.
    - At 3:1: `line-strong/paper`, `line-strong/pool`.
  - **`viewer dark tokens meet contrast`:** the same text pairs that exist in dark, over the dark values: `ink`, `muted`, `water-text`, `rope` and `out-text` on dark `paper` and `pool`; `led` and `board-muted` on dark `board`; `line-strong/paper` at 3:1.
  - **`values match the spec`:** spot-check `--board` `#0B1320`, `--led` `#FFC23D`, `--pen` `#6B3FB5`, dark `--paper` `#131E2E` (case-insensitive).
  - **`new properties are read with a fallback outside base.css`:** for each new property name, `css/viewer.css` and `css/tracker.css` contain no `var(--name)` without a comma fallback.
  - **`Sofia fonts are linked`:** `index.html` and `track.html` contain the Sofia link below and no `Fira+Sans`.
- [ ] **Step 2:** Run `node --test tests/unit/tokens.test.js`. Expected: FAIL (old values; new properties missing).
- [ ] **Step 3: Set the tokens** exactly as the spec's three tables.
  - **`base.css`:** light values, plus the new properties, plus `--font-body` / `--font-num`.
    - Add `--accent-on-board` and `--on-accent` only as fallbacks in rules, never as `:root` values; JS sets them.
    - `.cap` text becomes `var(--on-accent, #FFFFFF)`.
    - `.rope` gets `display: none` (direction B has no lane rope; the markup goes in R2/R3).
  - **`viewer.css`:** the dark block gets the spec's "Viewer dark" column for both the existing and the new properties. Remove the `.rope` opacity rule.
  - **`tracker.css`:** `--pen`, `--sit-up`, `--sit-down`, `--sit-up-strong` and `--sit-down-strong` per the tracker table.
  - **If a contrast pair fails with the spec's values,** don't change the value. Stop and report the pair and its ratio.
- [ ] **Step 4: Fonts and theme colour.**
  - In both HTML files, replace the Fira link with `https://fonts.googleapis.com/css2?family=Sofia+Sans:wght@400;600;700&family=Sofia+Sans+Extra+Condensed:wght@700;800&display=swap`.
  - `theme-color`: `index.html` light `#F4F6F8` and dark `#0B1320`; `track.html` `#0B1320`.
- [ ] **Step 5:** Run `npm test`. Expected: all pass.
- [ ] **Step 6: Commit** (controller): `feat(look): direction B tokens and Sofia fonts`.

---

### Task 3: Viewer restyle (sonnet)

**Files:**
- Modify: `css/viewer.css` (and shared rules in `css/base.css` only if a rule there is viewer-only in effect)
- Create: `tests/e2e/viewer-look.spec.js`
- Modify: `tests/unit/tokens.test.js` (add one test)

**Interfaces:**
- Consumes: Task 2's properties and Task 1's `--on-accent` / `--accent-on-board`.
- Produces: the list of viewer items that need markup (for R2), in the task report.

**What it must look like:** spec "Release 1 → Viewer, restyled in place", boards `VGame`, `VGameFinal`, `VSeason`.
- **`.scoreboard`:** background `var(--board, #0B1320)`.
  - `.score` digits in `var(--led, #FFC23D)`, `var(--font-num)` 800.
  - ANOG's `.team-name` gets a 6 px `var(--accent-on-board, var(--accent))` bar before it; the opponent `.team-name` uses `var(--board-muted, #A9B4C2)`.
  - The status badges, period, `.situation-figures` and `.quarter-scores` sit on the board in board colours.
- **Live banner** (`.live-banner`): `var(--led)` background with ink text. The past-nav back link uses B link styling.
- **Celebration:** `--banner-bg: var(--board, #0B1320)` and `--banner-ink: var(--led, #FFC23D)` in both schemes. Remove the dark override's swap.
- **Everything else:** sections, tables, timeline and goalie tables get the new colours, type, radii and spacing. Keep today's glyph icons.

- [ ] **Step 1: Write the failing tests.**
  - **Unit:** `tokens.test.js` gets `viewer.css colours live in tokens`: every `#hex` in `css/viewer.css` is on a line that declares a custom property (`--name: …`).
  - **e2e:** `tests/e2e/viewer-look.spec.js`. Seed a live game with the existing viewer e2e helpers; use the longest seeded names and two-digit caps.
    1. `body` font-family contains `Sofia Sans`.
    2. `.scoreboard` background is `rgb(11, 19, 32)`.
    3. `.score` colour is `rgb(255, 194, 61)`.
    4. `--on-accent` on `document.documentElement` is `#ffffff`, and `--accent-on-board` is set and not `#0057b8`.
    5. With `colorScheme: 'dark'`, the body background is `rgb(11, 19, 32)` and a section card background is `rgb(19, 30, 46)`.
    6. At 360 × 740, `document.scrollingElement.scrollWidth <= 360`, both as-is and with `page.route('https://fonts.googleapis.com/**', r => r.abort())`.
    7. After a goal, `celebration-banner` has background `rgb(11, 19, 32)` and `celebration-goal` colour `rgb(255, 194, 61)`, in light and dark. Trigger it the way `viewer-celebration.spec.js` does.
- [ ] **Step 2:** Run the unit test and the focused e2e file. Expected: FAIL on the colour assertions.
- [ ] **Step 3: Restyle `css/viewer.css`.**
  - Move every remaining hex into tokens; celebration-local tokens stay local custom properties.
  - Use only the fallbacks from Global Constraints.
- [ ] **Step 4: Run everything.**
  - `npm test` passes.
  - The focused `viewer-look.spec.js` passes.
  - Every `tests/e2e/viewer*.spec.js` passes unchanged, on both projects (chromium and webkit).
- [ ] **Step 5: Look.**
  - Take Playwright screenshots of: live game, final game, games list/season, past game, empty state, and celebration (also with reduced motion). Take each at 360 and 390, in light and dark, and save them to the scratchpad.
  - Compare them with the spec and fix what's off.
  - The report lists every board detail that needs markup, as the "R2 markup list".
- [ ] **Step 6: Commit:** `feat(look): viewer in direction B colours and type`.

---

### Task 4: Tracker restyle (sonnet)

**Files:**
- Modify: `css/tracker.css`
- Create: `tests/e2e/tracker-look.spec.js`
- Modify: `tests/unit/tokens.test.js` (extend the Task 3 test to `css/tracker.css`)

**Interfaces:**
- Consumes: Task 2's properties, Task 1's properties.
- Produces: the list of tracker items that need markup (for R3), in the task report.

**What it must look like:** spec "Release 1 → Tracker, restyled in place" and its boards.
- **Board elements:**
  - `.live-head` and the score row (`.live-score`) on `var(--board, #0B1320)`, with `--led` digits.
  - `.btn--goal`: board background with `--led` text.
- **Action tiles:**
  - `.btn--excl`: red outline, `var(--rope)`.
  - `.btn--pen`: `var(--pen)` fill with white text.
  - `.btn--save`: `var(--water)` fill with white text.
  - `.btn--pen-save`: teal outline.
  - `.btn--more`: ink outline.
- **Foul pips:** `.pip.is-on` red, `.pip.is-pen` purple, empty pips `var(--line-strong, #7A8796)`.
- **Situation** (`[data-testid="situation"]`, `data-state`):
  - Man-up: page tint `var(--sit-up)`, band `var(--sit-up-strong)` with white text.
  - Man-down: page tint `var(--sit-down)`, band `repeating-linear-gradient(135deg, #E8590C 0 10px, #F37A3A 10px 20px)` with ink text. Put both colours in tokens.
- **Banners and the rest:**
  - `.banner--failed` (unsaved): pale red with Retry and Discard.
  - `.banner--takeover` (moved): pale amber, and the screen dims as today.
  - Dock, `.toast`, `.sheet`, the setup screens, game list and detail follow the boards.

- [ ] **Step 1: Write the failing tests.**
  - **Unit:** `tokens.test.js`'s colours-in-tokens test also covers `css/tracker.css`.
  - **e2e:** `tests/e2e/tracker-look.spec.js`. Use the existing tracker helpers to unlock and start a game with situations tracked.
    1. `.btn--goal` background is `rgb(11, 19, 32)`.
    2. `.btn--pen` background is `rgb(107, 63, 181)`.
    3. In a man-up, `[data-testid="situation"]` background is `rgb(14, 122, 78)` and its colour is `rgb(255, 255, 255)`.
    4. In a man-down, its `background-image` contains `repeating-linear-gradient` and its colour is `rgb(11, 19, 32)`.
    5. At 360 × 740 and at 740 × 360, `scrollWidth <= viewport width`, with fonts loaded and with fonts blocked.
- [ ] **Step 2:** Run the unit test and the focused e2e file. Expected: FAIL.
- [ ] **Step 3:** Restyle `css/tracker.css` and move every hex into tokens.
- [ ] **Step 4: Run everything.**
  - `npm test` passes.
  - The focused `tracker-look.spec.js` passes.
  - Every `tests/e2e/tracker*.spec.js` passes unchanged.
- [ ] **Step 5: Look.**
  - Take screenshots of: live, man-up, man-down, unsaved banner, moved banner, toast, events sheet, goalie sheet, unlock, home, roster, new game, lineup, past games, and landscape. Take them at 360 and 390, in light only.
  - Compare them with the spec.
  - The report lists the "R3 markup list".
- [ ] **Step 6: Commit:** `feat(look): tracker in direction B colours and type`.

---

### Task 5: Brand files (sonnet)

**Precondition (controller):** `img/anog-crest.png` is in the repo, 512 px. The controller copies it from the canvas asset store first: asset `bbcc3e71cefa4897612d1a62399a6b6a` of https://claude.ai/artifact/7yCTLzZXoQdD4UdnyXLGBb, saved with Artifact `read` and `path`.

**Files:**
- Create:
  - `scripts/brand-assets.mjs`;
  - `img/icon-180.png`, `img/icon-192.png`, `img/icon-512.png`, `img/og.png`;
  - `manifest.webmanifest`;
  - `tests/unit/brand.test.js`.
- Modify: `index.html`, `track.html`, `sw.js` (`CACHE` name `wp-shell-v1` → `wp-shell-v2`).

**Interfaces:**
- Consumes: `img/anog-crest.png`.
- Produces: the files above; R2 reuses `img/anog-crest.png`.

- [ ] **Step 1: Write the failing test** in `tests/unit/brand.test.js`. Read the PNG width and height from the IHDR bytes 16–23.
  - **`icons exist at their sizes`:** 180, 192, 512 square; `og.png` is 1200 × 630.
  - **`manifest is valid`:** it parses; `name` is `ANOG live score`, `short_name` is `ANOG`, `start_url` is `./`, `display` is `standalone`, `theme_color` is `#0B1320`, `background_color` is `#F4F6F8`; its icons list the 192 and 512 files with matching `sizes`.
  - **`pages link the icons`:**
    - Both pages have `<link rel="apple-touch-icon" href="img/icon-180.png">`.
    - `index.html` has `<link rel="manifest" href="manifest.webmanifest">`.
    - `index.html` has `og:title` `ANOG live score`, `og:description` `Every game, goal by goal`, and `og:image` `https://nemlah.github.io/scoretracker/img/og.png`.
  - **`cache name is v2`:** `sw.js` contains `wp-shell-v2::`.
- [ ] **Step 2:** Run `node --test tests/unit/brand.test.js`. Expected: FAIL.
- [ ] **Step 3: Write `scripts/brand-assets.mjs`.** It uses `chromium` from `@playwright/test`, renders inline HTML with `page.setContent`, and screenshots exact-size pages.
  - **Icons:** board `#0B1320` square, the crest centred at 73 % (board `VIcon`). The crest is embedded as a data URL from `img/anog-crest.png`.
  - **`og.png`:** board `VLinkPreview`:
    - 1200 × 630, `#0B1320`, padding 72/96, crest 360 px, gap 64;
    - a "LIVE SCORES" pill: 2 px `#FFC23D` border, `#FFC23D` 28 px 700 text, a 14 px dot;
    - "ANOG" in Sofia Sans Extra Condensed 800 at 168 px, white;
    - "Every game, goal by goal" 40 px 600 in `#A9B4C2`;
    - a 12 px `#FFC23D` strip along the bottom.

    It waits for `document.fonts.ready`.
  - Run it with `node scripts/brand-assets.mjs` and commit the PNGs.
- [ ] **Step 4:** Add `manifest.webmanifest`, the link and meta tags, and the cache bump.
  - Add `'./manifest.webmanifest'`, `'./img/icon-180.png'`, `'./img/icon-192.png'` and `'./img/icon-512.png'` to SHELL. `og.png` stays out; only link crawlers fetch it.
  - Extend `brand.test.js` with `shell lists the manifest and icons`.
- [ ] **Step 5:** Run `npm test` (all pass) and the full e2e suite (unchanged).
- [ ] **Step 6: Commit:** `feat(look): home-screen icons, manifest and link preview`.

---

### Task 6: Release check (controller)

- [ ] **Step 1: Run every suite on the branch:** `npm test`, `npm run test:emu`, `npm run test:e2e`. All pass.
- [ ] **Step 2: Mixed-cache check.** Serve this branch. In a Playwright page, route `css/base.css` to the previous main's copy (`git show main:css/base.css`) and load the viewer and the tracker.
  - Expected: no unstyled board or white-on-white text.
  - Then route `js/accent.js` to a 404 and expect blue caps with white numbers.
- [ ] **Step 3: Canvas.**
  - Publish the Task 3 and Task 4 screenshots to the canvas on a new page, "R1 build", next to the matching boards.
  - Ask the owner to approve them there.
- [ ] **Step 4: Markup lists.** Mechanic appends the Task 3 and Task 4 markup lists to the spec: the viewer items under Release 2, the tracker items under Release 3.
- [ ] **Step 5: Reviews.**
  - **Codex** (high, read-only, fresh thread) reviews the whole branch, because Tasks 3–5 are Claude-written.
  - **Sonnet** reviews it too, because Tasks 1–2 are Codex-written.
  - Fix rounds go per the user's routing.
- [ ] **Step 6: Release.** Follow the release routine once the owner says so: live-game check, fast-forward merge, push, Pages check, session log.
