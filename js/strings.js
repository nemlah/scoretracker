// Every user-visible string lives here (English). A Greek translation can replace this table.
const STRINGS = {
  viewerTitle: '{team} live score',
  live: 'Live',
  final: 'Final',
  playersHeading: 'Our players',
  colPlayer: 'Player',
  colGoals: 'Goals',
  colExcl: 'Excl.',
  colGames: 'Games',
  out: 'Out',
  penaltyGoals: '+{n} pen.',
  timelineHeading: 'Game timeline',
  timelineEmpty: 'No goals or exclusions yet.',
  seasonHeading: 'This season',
  resultsHeading: 'Results',
  totalsHeading: 'Player totals',
  emptyTitle: 'No game yet',
  emptyBody: 'The live score appears here as soon as a game starts.',
  connectionNote: 'Reconnecting. Showing the last score received.',
  goalNamed: 'Goal · #{cap} {name}',
  goalUnknown: 'Goal · scorer unknown',
  exclNamed: 'Exclusion · #{cap} {name}',
  oppGoal: 'Opponent goal',
  unknownPlayer: '#? Unknown player',
  shootout: 'Shootout',
  shootoutScore: '({us} – {them} pen.)',
  scoreMain: '{us} – {them}',

  // Tracker shell
  trackerTitle: '{team} tracker',
  trackerLoading: 'Loading…',
  trackerUnavailable: 'The tracker could not start. Check your connection and reload the page.',
  navHome: 'Home',
  offlineBanner: 'Offline. Changes are saved here and sent when you reconnect.',
  takeoverBanner: 'Another device is tracking. This one is read-only.',
  takeoverButton: 'Take over',
  takeoverNeedsConnection: 'Taking over needs a connection. Connect to the internet and try again.',
  writeFailed: 'That change could not be saved. Try again.',

  // Unlock
  unlockHeading: 'Enter the tracker code',
  unlockHelp: 'The code is 6 letters and digits.',
  unlockLabel: 'Tracker code',
  unlockButton: 'Unlock',
  unlockWorking: 'Checking…',
  unlockWrongCode: 'That code is not right. Check it and try again.',
  unlockFailed: 'Could not unlock. Try again.',
  unlockNeedsConnection: 'Unlocking needs a connection. Connect to the internet and try again.',
  codeChanged: 'The code was changed. Enter the new code to keep tracking.',

  // Home
  homeHeading: 'Tracker',
  homeResume: 'Resume game',
  homeNew: 'Start a new game',
  homeRoster: 'Roster',
  homeGames: 'Past games',

  // Roster
  rosterHeading: 'Roster',
  rosterNameLabel: 'Name',
  rosterCapLabel: 'Cap number',
  rosterAdd: 'Add player',
  rosterEdit: 'Edit',
  rosterEditFor: 'Edit {name}',
  rosterSave: 'Save',
  rosterCancel: 'Cancel',
  rosterArchive: 'Archive',
  rosterArchiveFor: 'Archive {name}',
  rosterUnarchive: 'Unarchive',
  rosterUnarchiveFor: 'Unarchive {name}',
  rosterArchivedHeading: 'Archived ({n})',
  rosterEmpty: 'No players yet. Add your first player above.',
  rosterNameRequired: 'Enter a name.',
  rosterCapRange: 'Cap number must be a whole number from 1 to 99.',
};

export function t(key, params = {}) {
  if (!Object.hasOwn(STRINGS, key)) {
    console.warn(`Missing string: ${key}`);
    return key;
  }
  return Object.entries(params).reduce(
    (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
    STRINGS[key],
  );
}

export function periodLabel(period) {
  return period === 'SO' ? t('shootout') : `Q${period}`;
}

export function eventLabel(event, lineup) {
  if (event.type === 'oppGoal') return t('oppGoal');
  if (event.type === 'goal' && event.playerId == null) return t('goalUnknown');
  const player = lineup.find(entry => entry.playerId === event.playerId);
  if (!player) return t('unknownPlayer');
  return t(event.type === 'goal' ? 'goalNamed' : 'exclNamed', { cap: player.cap, name: player.name });
}

export function scoreText({ us, them, soUs, soThem }, shootout) {
  return {
    main: t('scoreMain', { us, them }),
    shootout: shootout ? t('shootoutScore', { us: soUs, them: soThem }) : null,
  };
}
