# Claude Design brief: ANOG Scoretracker visual refresh

Paste everything below the line into Claude (Design) as one message. The first line already links the design system.

---

Use the ANOG Scoretracker design system (https://claude.ai/artifact/QM6gZEiJuLkTZ3tZQMedLv) as the starting point.

Make a Design canvas for a visual refresh of the ANOG Scoretracker, a live water polo score app for one Greek club.

## The product

Two phone-first web pages, hand-written HTML/CSS (custom properties, no framework, no build step), hosted on GitHub Pages.

**Viewer** (public). Parents and fans follow the current or latest game from the stands or from home. It follows the phone's light/dark setting. It shows:
- Live / Final badge, scoreboard (ANOG vs opponent), period (Q1–Q4; a shootout is shown separately)
- Quarter-by-quarter scores
- Man-up / man-down figures ("Man-up 3/5 · 60%", "Man-down 4/6 stopped")
- Game timeline: goals (ours and theirs), exclusions, penalty fouls, saves, man-up goals
- Our players: cap, name, goals, exclusions, penalty fouls; "Out" after a third exclusion
- Goalkeepers: saves, penalty saves, goals against, save %
- This season: results list and player totals; past games list and game detail
- Empty state ("No game yet"), a reconnecting note, and a goal celebration overlay (ball into the net, water) that needs a reduced-motion version

**Tracker** (one scorekeeper). Used poolside, one-handed, sometimes with wet hands, often in bright sun, while watching play. Light theme only. Screens:
- Unlock (6-character code), Home, Roster (add, edit, archive), New game and "Who is playing" (tick players, set caps)
- Live: a header with score, period and man-up state; a grid of player tiles (cap badge, name, goal count, exclusion pips, Goal / Exclusion / Pen buttons); a goalie tile in two rows ("In goal" in the head, Save / Pen save, with Goal / Exclusion / Pen behind ⋯); a bottom dock with Undo, Opponent goal, Period, Man-up and Events
- During a man-up the whole page tints green, during a man-down red, with an "End man-up · no goal" / "End man-down · stopped" button and a seconds counter
- Events sheet (delete earlier events, change a scorer, adjust the lineup, end the game), Past games and game detail
- Banners: "Taps not saved" (affected games, Retry, Discard) and "Tracking moved to another device" (Take over); toasts

## The current identity (evolve it; drop a part only for a stated reason)

- Colours, light: ink #0E2238, paper #FFFFFF, pool #EEF5F8, water #0F7FA8 (as text: #0B6A8C), rope #D7263D, line #C9D6DF, accent #0057B8 (the club colour).
- Viewer dark: ink #EAF2F7, paper #0E2238, pool #08192A, water #5CC3EC, rope #FF6B7D, line #2B4660.
- Tracker only: man-up tint #4FCB82 with strong #146B3A, man-down tint #F0626B with strong #B3202F, penalty #9A4A00.
- Type: Fira Sans 400/600 for text; Fira Sans Extra Condensed 600/700 for every number (scores, caps, counts), tabular figures.
- One decorative device: a lane-rope stripe across the top of the page (accent / white / rope-red segments).
- The cap badge: a round disc in the club accent with the cap number in the condensed face; grey when the player is out.

## Coming later: club logo and player photos (placeholders now)

**Club logo.** The ANOG logo will be added later, and its shape is not known yet: it may be a round crest or a wide wordmark. Reserve one logo slot that fits both a square mark and a wide one (up to about 3:1), and show both shapes on the directions page.
- Where it goes:
  - the viewer header and the scoreboard beside "ANOG"
  - the tracker header and the unlock screen
  - the home-screen icon and the link-preview image (one small artboard each)
- The opponent has no logo, so their side of the scoreboard stays text. The scoreboard must still look balanced with a logo on our side only.
- The logo must work on light and dark backgrounds. Show a plate behind it for when no dark-background version exists.
- Draw the placeholder as a plainly labelled box ("Club logo"), never an invented crest.

**Player photos.** Photos are optional for each player. Some players will have one and many won't, and the club may turn photos off entirely because they show minors on a public page.
- Every place that shows a photo falls back to the cap badge, and the design must look complete with no photos at all.
- The cap number stays visible wherever a photo appears (for example as a small badge on the photo).
- Where photos appear:
  - the viewer's players and goalkeepers lists
  - goal entries in the timeline
  - the scorer in the goal celebration
  - the tracker's roster and "Who is playing"
- On the tracker's live tiles the cap badge stays the main identifier, because the scorekeeper finds players by cap number. A photo there is optional and must not make tiles taller or shrink the buttons below 48 px.
- Draw photo placeholders as neutral circles labelled as photos: no faces, no stock photos. Mix them, so some players show a photo placeholder and others the cap-badge fallback.

## Constraints

- The club colour is configurable (any hex, default #0057B8). Every direction must still work with another club's colour: show one artboard with a red accent (#C8102E) and one with a yellow accent (#F2B705), and say how text on the accent stays readable.
- Phones: design at 390 × 844 and check 360 px wide, our worst case; nothing clips or wraps badly at 360. The tracker also has a short landscape layout (500 px tall or less).
- WCAG AA: text 4.5:1; large text, icons and control borders 3:1; in both viewer themes. Normal, man-up and man-down must differ in lightness and label, not hue alone.
- Tracker touch targets at least 48 px, with enough gap that a hurried thumb does not hit the neighbour. Goal and Undo must be impossible to confuse.
- Fonts from Google Fonts only, with Greek glyphs: a Greek translation is coming, and Greek labels run about 30% longer than English.
- Dates DD/MM/YYYY, 24-hour time.
- Real icons instead of the emoji and letters the timeline uses now (✋ for saves, "P" for penalty fouls): simple stroke icons that can be inlined as SVG.
- No gradient washes, glassmorphism, emoji, or left-border accent cards.

## Content

Realistic, never lorem ipsum: ANOG against a Greek club, 9–7 in Q3; players named by first name and surname initial ("Nikos P.", "Giorgos K."), which is the app's privacy rule for minors; caps 1–14 with caps 1 and 13 as goalkeepers; one player on two exclusions, one player Out; man-up 3/5.

## What to make

Page 1, "Directions": three directions, one row each. Each row holds Viewer live (light), Viewer live (dark) and Tracker live, all 390 × 844, plus a sticky note with the idea in two sentences and what it changes compared with the current tokens. Each row shows the logo slot (the square mark in one artboard, the wide one in another) and a players list that mixes photo placeholders with cap-badge fallbacks. Direction A refines the current pool and lane-rope identity; B and C each take a distinct idea from the world of water polo (pool deck, scoreboard, caps, lane lines, shot clock). Then stop and ask me which direction to take.

After I pick:
- Page 2, "Viewer": every viewer state above, light and dark, including the empty state, a final result, a past game, the celebration and its reduced-motion frame, the players list with photos and with none, the home-screen icon and link-preview image, and 360 px checks.
- Page 3, "Tracker": every tracker screen and state above, including the man-up and man-down tints, both banners, the events sheet, roster and "Who is playing" with photos and with none, a 360 px live screen and the landscape layout.
- Page 4, "Tokens": one sheet with the colour tokens (light and viewer dark), type scale, spacing, radii, icons, the logo slot (sizes and clear space for square and wide marks) and photo sizes. Keep the current token names where the role survives (ink, paper, pool, water, water-text, rope, line, accent, font-body, font-num); new names follow the same style. Show each colour's contrast ratio against the background it is used on.

Title each artboard by surface, screen and state (for example "viewer-live-dark", "tracker-live-manup-360"), so each one maps to a screen in the code.
