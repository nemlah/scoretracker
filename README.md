# Water polo live score tracker

A static site for one club, with a public live score, roster and season totals stored in Firebase Firestore. There is no build step.

For a GitHub repository named `scoretracker`, the published URLs are:

- Viewer: `https://<user>.github.io/scoretracker/index.html` — share this with spectators.
- Tracker: `https://<user>.github.io/scoretracker/track.html` — open this on the scorekeeper's phone and unlock with the edit code.

Replace `<user>` and `scoretracker` with your GitHub username and repository name. For a user-site repository named `<user>.github.io`, omit `/scoretracker`. The viewer always shows the current or most recent game.

## Firebase setup

Use the [Firebase console](https://console.firebase.google.com/). Keep the project on the free **Spark** plan; billing is not required.

1. Click **Create a project** (or **Add project**), enter a project name, and continue. Google Analytics is optional; you can disable it. Finish creating the project.
2. In **Project overview**, click the **Web** icon (`</>`) to add an app. Enter an app nickname, leave Firebase Hosting unchecked (GitHub Pages will host the site), and click **Register app**. In the SDK setup panel, select **Config** and copy the `firebaseConfig` object. Paste its values into the existing `firebaseConfig` export in `js/config.js`, replacing every `REPLACE_ME`. Do not paste the SDK imports or initialization code. You can retrieve the config later under **Project settings → General → Your apps → your web app → SDK setup and configuration → Config**.
3. Open **Build → Authentication → Get started → Sign-in method**. Select **Anonymous**, enable it and click **Save**. Under **Authentication → Settings → Authorized domains**, click **Add domain**, enter `<user>.github.io` and add it. Use only the hostname, without `https://` or a repository path.
4. Open **Build → Firestore Database → Create database**. Select **Standard edition** if asked and use the default database ID `(default)`. Choose location **eur3 (Europe)**. Start in **production mode** and create the database. The location cannot be changed later.
5. In **Firestore Database → Rules**, replace the entire editor contents with the contents of this repository's `firestore.rules`. Click **Publish**. These rules allow public viewing and restrict edits to the unlocked active tracker. Do not use test-mode rules on the published site.
6. In **Firestore Database → Data**, click **Start collection**. Enter collection ID `secrets`, then document ID `editCode`. Add field `code`, select type **string**, and enter your own code, for example `4KX9P2`. Click **Save**. The code must contain exactly 6 characters, using digits and capital letters only (`^[0-9A-Z]{6}$`). Share it only with scorekeepers. No other documents need to be created manually.

Firebase web config values are not secrets and can be committed to the repository. Security comes from `firestore.rules`, not from hiding the config. Keep the edit code out of source files. Optionally restrict the API key's website referrers to your GitHub Pages domain in **Google Cloud console → APIs & Services → Credentials → your API key → Application restrictions → Websites** (for example `https://<user>.github.io/*`).

## Team configuration

1. In `js/config.js`, set `team.name` to the club's display name and `team.accent` to its colour as a CSS hex value, for example `#0057b8`. Leave `EMULATOR` unchanged.
2. Update the static `<title>` in both HTML files to match the name: `<title>Your Club live score</title>` in `index.html` and `<title>Your Club tracker</title>` in `track.html`. This makes link previews show the correct name. `npm test` deliberately fails until both titles match `team.name`.
3. Save the files and commit your configuration and title changes to the repository.

## Publish on GitHub Pages

1. Put the configured site files on the repository's `main` branch, keeping `index.html` at the repository root.
2. On GitHub, open the repository's **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**. Select branch **main** and folder **/ (root)**, then click **Save**.
4. Wait for the deployment to finish and open the site URL shown by GitHub. Open `/track.html` at the same path, unlock with your code, and check that the viewer updates after a practice game.

Before the first real game, test on the actual tracker phone, especially **iPhone Safari**: unlock, record a tap, switch to another app and come back, then turn airplane mode on, record a tap, and turn it off again. Keep the tracker open online until changes sync and confirm the viewer receives them.

## At each game

1. Open the tracker online and **Unlock** with the code. One device can track at a time. Unlocking on another device takes over; the previous device shows **Tracking moved to another device**. Use **Take over** there only when you intend to move tracking back.
2. Open **Roster** to add names and cap numbers. Edit existing players or archive players who have left; archiving preserves their history.
3. Choose **Start a new game**, enter the opponent and date, tick the players taking part, and check their caps. Changing a cap to one held by another selected player swaps the caps. Tap **Start game**.
4. On the live screen, tap a player's **Goal** or **Excl.**, or add an opponent goal. Advance the period as play moves from Q1 through Q4 and, if needed, the shootout. A third exclusion marks the player out and disables their event buttons. Shootout goals are shown separately and do not count toward season goal totals.
5. Correct the last tap with **Undo**. Open **Events** to delete an earlier event, change a goal's scorer, add a goal with an unknown scorer, adjust the lineup, or go back a period.
6. From **Events**, choose **End game** and confirm. The viewer shows the final result and season totals update. **Past games** lets you correct, reopen or delete a game; totals are recalculated.

Open the tracker online at least once before relying on offline use. Offline taps stay on that phone and sync while the tracker is open again with a connection. A **taps not saved** banner means the server refused changes; resolve the cause and use **Retry**. Do not clear browser site data while changes are pending. Taps recorded offline after another device takes over can be refused when they sync.

## Change the edit code

In **Firebase console → Firestore Database → Data → secrets → editCode**, edit the `code` string and save. Use exactly 6 digits and capital letters, such as `4KX9P2`. Changing it revokes every device unlocked with the old code. Each scorekeeper must unlock again with the new code; offline devices discover the revocation when they reconnect.

## Free-plan limits

Firestore's Spark allowance is 50,000 document reads and 20,000 writes per day. This design allows about **1,000 viewer-games per day** (for example, roughly 300 spectators watching three games). This is an estimate: refreshes, game activity and other database use affect it.

When the daily quota is exceeded, reads fail and the tracker's writes are refused too, because writes require rule-check reads. The tracker shows taps as **not saved**. The quota resets at midnight US Pacific time, about 09:00/10:00 Greek time. Keep the phone's local data and retry after the reset. Monitor usage under **Firestore Database → Usage**. If the audience consistently exceeds this allowance, the paid Blaze plan is an option; it requires billing and is not needed for this setup.

## Privacy

Player names entered here are public on the internet. For minors, consider using a first name and surname initial, for example `Nikos P.`.

## Local development

Install Node.js 22 or newer and **JDK 21**. On macOS with Homebrew:

```sh
brew install openjdk@21
export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
java -version
```

Homebrew's JDK 21 is keg-only: set that PATH before running emulator scripts in each new shell (or add it to your shell configuration). On Intel Macs, use `/usr/local/opt/openjdk@21/bin` instead.

From the repository root:

```sh
npm install
npx playwright install chromium webkit
npm test
npm run test:emu
npm run test:e2e
npm run dev
```

`npm test` runs unit tests. The emulator and end-to-end commands start their own Firestore and Auth emulators. Run them separately from `npm run dev` so the ports are free. Initial dependency, browser and emulator downloads require internet access; browser SDK files and fonts are also loaded online on first use.

`npm run dev` starts the emulators for project `demo-scoretracker`, seeds the local edit code `TEST01`, and serves the site. Open:

- Viewer: http://127.0.0.1:4173/index.html?emulator=1
- Tracker: http://127.0.0.1:4173/track.html?emulator=1

Unlock with `TEST01`, add a player, start a game and record a goal; check the viewer updates. Stop with **Ctrl-C**. Emulator data is temporary and is lost when the process stops. The seed script writes only the local code document, with security rules disabled; it never seeds production. Keep `?emulator=1` on both local URLs to select the emulators. No production Firebase config is needed for this mode.
