// Every user-visible string lives here (English). A Greek translation can replace this table.
const STRINGS = {
  penButton: 'Pen',
  penFor: 'Penalty foul for {name}',
  penNamed: 'Penalty foul · #{cap} {name}',
  tileFoulsAria: 'Exclusions: {excl}, penalty fouls: {pens}',
  manUpButton: 'Man-up',
  manUpEndButton: 'End man-up · no goal',
  manDownEndButton: 'End man-down · stopped',
  situationSeconds: '{s} s',
  manUpEvent: 'Man-up',
  manUpEndEvent: 'End man-up · no goal',
  manDownEndEvent: 'End man-down · stopped',
  manUpFigure: 'Man-up {scored}/{played}',
  manDownFigure: 'Man-down {stopped}/{played} stopped',
  figurePercent: '{text} · {pct}%',
  manUpNone: 'Man-up —',
  manDownNone: 'Man-down —',
  situationShort: 'MU {scored}/{muPlayed} · MD {stopped}/{mdPlayed}',
  notTracked: '—',
  situationManUp: 'Man-up',
  situationManDown: 'Man-down',
  tlPenIcon: '🟧',
  tlPenSr: 'Penalty foul',
  tlManUpTag: 'man-up',
  colPen: 'Pen.',
  evManUpGoal: 'Man-up goal',
  evManUpGoalFor: 'Man-up goal: {label}',

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
  tlGoalIcon: '🏐',
  tlExclIcon: '🟥',
  tlGoalSr: 'Goal',
  tlExclSr: 'Exclusion',
  tlOppGoalSr: 'Opponent goal',
  tlUnknownScorer: 'Unknown scorer',
  tlOpponentFallback: 'Opponent',
  tlPlayer: '#{cap} {name}',
  shootout: 'Shootout',
  shootoutScore: '({us} – {them} pen.)',
  scoreMain: '{us} – {them}',

  // Tracker shell
  trackerTitle: '{team} tracker',
  trackerLoading: 'Loading…',
  trackerUnavailable: 'The tracker could not start. Check your connection and reload the page.',
  navHome: 'Home',
  offlineBanner: 'Offline. Changes are saved here and sent when you reconnect.',
  takeoverBanner: 'Tracking moved to another device',
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

  // Failed taps banner
  tapNotSaved: '1 tap not saved',
  tapsNotSaved: '{n} taps not saved',
  retryFailed: 'Retry',
  discardFailed: 'Discard',
  failedGameLink: 'View game',
  failedGameGone: 'That game no longer exists.',
  retryGameGone: 'That game no longer exists, so these taps cannot be retried. Discard them.',
  retryNeedsConnection: 'Retrying needs a connection. Connect to the internet and try again.',

  // New game
  newHeading: 'New game',
  opponentLabel: 'Opponent',
  opponentDefault: 'Opponent',
  dateLabel: 'Date',
  seasonLabel: 'Season',
  seasonInvalid: 'Season must look like 2026-27.',
  lineupHeading: 'Who is playing',
  capFor: 'Cap number for {name}',
  startGame: 'Start game',
  endLiveGameFirst: 'A game is live. Resume it and end it before starting a new one.',
  newNoRoster: 'The roster is empty. Add players first.',
  newGoRoster: 'Open the roster',
  selNoPlayers: 'Tick at least one player.',
  selMissingCap: 'Enter a cap number.',
  selBadCap: 'Cap number must be a whole number from 1 to 99.',
  selDuplicateCap: 'Another player has this cap.',

  // Live
  goalButton: 'Goal',
  exclButton: 'Exclusion',
  goalFor: 'Goal for {name}',
  exclFor: 'Exclusion for {name}',
  tileGoalsLabel: 'goals',
  tileGoalsOne: 'goal',
  tileGoalsAria: 'Goals: {n}',
  tileExclAria: 'Exclusions: {n}',
  oppGoalButton: '+1 opponent goal',
  undo: 'Undo: {label} ({period})',
  undoNothing: 'Nothing to undo',
  eventsButton: 'Events',
  periodAria: 'Period {label}. Tap for {next}.',
  periodLastAria: 'Period {label}, the last period',
  syncConnecting: 'connecting…',
  syncOnline: 'online',
  syncOffline: 'offline — taps saved, will sync',
  noLiveGame: 'No game is live right now.',
  liveLoading: 'Loading the game…',

  // Confirm, events sheet
  tapAgainToConfirm: 'Tap again to confirm',
  sheetClose: 'Close',
  eventsHeading: 'Events',
  eventsEmpty: 'No events yet.',
  goalPlain: 'Goal',
  scorerLabel: 'Scorer',
  scorerFor: 'Scorer for {label}',
  scorerUnknown: 'Scorer unknown',
  scorerOption: '#{cap} {name}',
  evDelete: 'Delete',
  evDeleteFor: 'Delete {label}',
  addUnknownGoal: 'Add goal, scorer unknown',
  periodPrev: 'Back to {label}',
  periodPrevNone: 'No earlier period',
  openLineup: 'Edit lineup',
  endGame: 'End game',

  // Lineup sheet
  lineupSheetHeading: 'Lineup',
  luRemove: 'Remove',
  luRemoveFor: 'Remove {name}',
  luKeepsEvents: 'Has events',
  luAddLabel: 'Add a player',
  luAddPlaceholder: 'Choose a player…',
  luNoMore: 'Everyone on the roster is already in the lineup.',
  luNoPlayers: 'Keep at least one player.',
  luSave: 'Save lineup',

  // Past games
  gamesHeading: 'Past games',
  gamesLoading: 'Loading games…',
  gamesLoadFailed: 'Could not load the games. Check your connection and try again.',
  gamesEmpty: 'No games yet.',
  gamesBack: 'All games',
  gameLiveBadge: 'Live',
  gameOpenFor: 'Open game against {opponent}',
  gameNotFound: 'This game no longer exists.',
  reopenGame: 'Reopen game',
  reopenBlocked: 'Another game is live. End it before reopening this one.',
  deleteGame: 'Delete game',
  infoHeading: 'Game details',
  infoSave: 'Save details',
  opponentRequired: 'Enter an opponent.',
  dateRequired: 'Enter a date.',
  addGoalPeriodLabel: 'Period for the added goal',
  gameLiveNote: 'This game is live. Use the live screen to track it.',
  gameLiveOpen: 'Open the live screen',
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
  if (['manUp', 'manUpEnd', 'manDownEnd'].includes(event.type)) return t(`${event.type}Event`);
  if (event.type === 'goal' && event.playerId == null) return t('goalUnknown');
  const player = lineup.find(entry => entry.playerId === event.playerId);
  if (!player) return t('unknownPlayer');
  return t(event.type === 'goal' ? 'goalNamed' : event.type === 'pen' ? 'penNamed' : 'exclNamed', { cap: player.cap, name: player.name });
}

export function timelineEntry(event, lineup, opponent) {
  if (event.type === 'oppGoal') {
    return {
      side: 'them',
      icon: t('tlGoalIcon'),
      sr: t('tlOppGoalSr'),
      text: opponent?.trim() || t('tlOpponentFallback'),
    };
  }
  const isGoal = event.type === 'goal';
  const entry = {
    side: 'us',
    icon: t(isGoal ? 'tlGoalIcon' : event.type === 'pen' ? 'tlPenIcon' : 'tlExclIcon'),
    sr: t(isGoal ? 'tlGoalSr' : event.type === 'pen' ? 'tlPenSr' : 'tlExclSr'),
  };
  if (isGoal && event.playerId == null) return { ...entry, text: t('tlUnknownScorer') };
  const player = lineup.find(candidate => candidate.playerId === event.playerId);
  return {
    ...entry,
    text: player ? t('tlPlayer', { cap: player.cap, name: player.name }) : t('unknownPlayer'),
  };
}

export function scoreText({ us, them, soUs, soThem }, shootout) {
  return {
    main: t('scoreMain', { us, them }),
    shootout: shootout ? t('shootoutScore', { us: soUs, them: soThem }) : null,
  };
}

export function goalCountLabel(n) {
  return t(n === 1 ? 'tileGoalsOne' : 'tileGoalsLabel');
}

function figureText(counts, kind, numerator) {
  if (counts === null) return t(`${kind}None`);
  const text = t(`${kind}Figure`, counts);
  return counts.played === 0 ? text
    : t('figurePercent', { text, pct: Math.round(100 * counts[numerator] / counts.played) });
}

export function manUpText(counts) {
  return figureText(counts, 'manUp', 'scored');
}

export function manDownText(counts) {
  return figureText(counts, 'manDown', 'stopped');
}

export function situationShort(counts) {
  if (counts === null) return t('notTracked');
  return t('situationShort', {
    scored: counts.manUp.scored, muPlayed: counts.manUp.played,
    stopped: counts.manDown.stopped, mdPlayed: counts.manDown.played,
  });
}
