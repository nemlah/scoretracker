# Viewer: calmer foul icons and a water polo goal celebration — Design (short)

Date: 14/11/2026
Status: approved 14/11/2026
Extends: `2026-11-13-waterpolo-scoretracker-design.md` and
`2026-11-14-man-up-man-down-design.md`. Viewer only; the tracker is unchanged.

## Intent

- The red card (🟥) on every exclusion in the viewer timeline is too strong
  for an ordinary 20-second exclusion. It should mark only the foul that puts
  a player out.
- When our team scores, the viewer should celebrate on screen to cheer up
  the people watching. The celebration must look like water polo, not a
  generic party effect.

## Goals

1. **Foul icons in the viewer timeline.**
   - Ordinary exclusion: a small grey letter badge **E**.
   - Penalty foul: a small grey letter badge **P**.
   - The foul that brings a player to 3 fouls (exclusions + penalty fouls,
     counted in event order): 🟥, and the line says the player is out (for
     example "#2 Papadakis · out"). This applies whether that third foul is
     an exclusion or a penalty foul.
   - Screen readers hear "Exclusion", "Penalty foul", or the foul plus "out".
2. **Goal celebration on the viewer**, when a new goal of ours appears in
   the live game:
   - a pool-blue wave rises from the bottom of the screen and drains away;
   - splash droplets in pool blue and the team colour;
   - a yellow-and-blue water polo ball arcs into a goal net;
   - **GOAL!** in large type in the team colour, with the scorer below
     ("#5 Alexiou"), plus "· man-up" when the goal scored a man-up. A goal
     with an unknown scorer shows "GOAL!" alone.
   - About 2.5 s in total. Tapping the banner dismisses it. The rest of the
     page stays readable and usable underneath (the overlay doesn't block
     taps except on the banner).
   - Viewers whose phone is set to reduce motion get the banner only (fade
     in and out), with no wave, splash or ball movement.

## When the celebration fires

- Only for a live game, only for our goals (any period, shootout included).
- Fires when a goal id appears that the viewer hadn't seen in the previous
  render of the same game.
- Does not fire on page load or reload, when a goal is removed (Undo,
  delete), when a scorer is changed (same goal id), for corrections to a
  final game, or when the viewer switches to another game.
- Several new goals in one update (for example after a reconnect): one
  celebration, naming the most recent goal.
- A new goal while a celebration is showing restarts it with the new scorer.

## Non-goals

- Sound or vibration on viewers' phones.
- Anything for opponent goals.
- Changes to the tracker (its tiles, Events sheet and wording stay as
  they are).
- A setting to turn the celebration off (reduce-motion is the off switch
  for the movement).

## Constraints

- No build step, no external libraries, no image files: the ball, net,
  wave and droplets are drawn inline (SVG and CSS). A new JS file goes into
  `SHELL` in `sw.js`.
- Every visible string lives in `js/strings.js`.
- Works in the viewer's light and dark palettes, and at phone width
  (~360 px) without sideways scrolling.
- The overlay is hidden from screen readers; the score's existing
  `aria-live` and the timeline already announce the goal.
- The existing timeline behaviour (scroll position and focus kept across
  live updates, man-up tag) is unchanged.

## Approaches considered

| Option | Trade-off |
|---|---|
| **Page elements animated with CSS, plus inline SVG for the ball and net, in one small viewer module (chosen)** | No dependency, works offline from the app shell, easy to honour reduce-motion with CSS. Enough for a few dozen droplets. |
| A confetti/particle library from a CDN | Rejected: first outside dependency on a site that has none, must be pinned and cached for offline, and its look is generic. |
| Canvas animation | Rejected: smoother for thousands of particles, which a goal burst doesn't need; costs an animation loop and cleanup. |

## Decided by the owner

- Red card only on the foul that puts a player out.
- The big celebration (option A) rather than a scoreboard-only one, and it
  must be water polo specific.
- The E / P letter badges were proposed by the builder and not objected to.

## Left to the builder

- Exact choreography and timing within about 2.5 s, droplet count, SVG
  drawing of the ball and net, exact colours within the existing tokens
  (`--pool`, `--water`, `--accent`, `--rope`).
- Test approach. Expected: unit tests for "which foul is the third" and for
  "which goal ids are new"; e2e for the icons, the celebration firing on a
  live goal, not firing on load / Undo / scorer change / final-game edit,
  and the reduced-motion variant.
