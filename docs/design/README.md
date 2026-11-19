# Design

| What | Where |
|---|---|
| Design system (tokens, components, brand book; built from `css/*.css` at a984976) | https://claude.ai/artifact/QM6gZEiJuLkTZ3tZQMedLv |
| Redesign canvas (Design artifact) | https://claude.ai/artifact/7yCTLzZXoQdD4UdnyXLGBb |
| Brief (prompt for a fresh Claude Design session) | `docs/design/claude-design-brief.md` |
| Tracking additions (options note: penalty goals, sprints, shots) | `docs/design/tracking-additions.md` |

Both links are private to the owner's claude.ai account.

## Status (19/11/2026)

- Direction **B · Shot Clock** chosen. Page 1 "Directions" keeps A, B and C for reference; B's boards carry the owner's comment fixes (names left, logo after the name, man-up/man-down as a plain line in the scoreboard).
- Page 2 "Viewer" (22 boards): live, final, past, no photos, reconnecting, 360 px, no game yet, season, goal celebration (full and reduced motion), each in light and dark; home-screen icon; link preview.
- Page 3 "Tracker" (19 boards): live, man-up, man-down, 360 px, unsaved-taps banner, tracking-moved banner, third-exclusion toast, events sheet, goalie ⋯ sheet; unlock, home, roster (photos on/off), new game, who is playing (photos on/off), past games, game detail; landscape.
- Page 4 "Tokens": colours light and dark with live contrast ratios, type scale, spacing, radii, touch targets, icons, logo sizes and clear space, photo sizes.
- Real club logo uploaded to the canvas (ANO Glyfada crest). Sample opponent: Vouliagmeni. Player photos are still placeholders.
- Owner comments round 1 applied: home is This season with a LIVE banner while a game is live; game screen has Timeline | Players | Team tabs and a centre-line timeline; home has Results | Players | Team tabs. Man-up/man-down moved off the scoreboard into the Team tabs.
- Team tabs use only data the tracker already records; candidates to track later are in `docs/design/tracking-additions.md`.
- Next: owner picks how to build direction B (one release, or staged: CSS token and font swap first, then viewer structure with a Team-stats module, then tracker details); then the full spec in `docs/superpowers/specs/`.

## Flow

1. Comment on artboards in the canvas, or tell Claude Code what to change; Claude Code revises the canvas.
2. Once the direction is settled: spec with a token diff against `css/base.css`, then plan, CSS implementation (sonnet), Codex review.
3. After merge: Playwright screenshots back onto the canvas, and re-sync the design system from the code.
