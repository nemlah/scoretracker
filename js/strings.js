// Every user-visible string lives here (English). A Greek translation can replace this table.
const STRINGS = {
  goalieLabel: 'Goalie', goalieFor: 'Goalie: {name}', gkBadge: 'GK', inGoalBadge: 'In goal',
  saveButton: 'Save', penSaveButton: 'Pen save', inGoalButton: 'In goal',
  saveFor: 'Save for {name}', penSaveFor: 'Penalty save for {name}', inGoalFor: 'Put {name} in goal',
  tileSaves: '{n} saves', tileSavesOne: '1 save', tilePenSaves: '{n} pen saves', tilePenSavesOne: '{n} pen save',
  tileSavesWithPen: '{saves} · {pens}',
  saveNamed: 'Save · #{cap} {name}', penSaveNamed: 'Penalty save · #{cap} {name}', gkInNamed: 'In goal · #{cap} {name}',
  evGoalie: 'Goalie', evGoalieFor: 'Goalie for {label}', evInGoal: 'In goal', evInGoalFor: 'In goal for {label}',
  goaliesHeading: 'Goalkeepers', colSaves: 'Saves', colPenSaves: 'Pen', colGA: 'GA', colSavePct: 'Save %',
  savePctText: '{pct}%', noShots: '—', shootoutGoalie: 'Shootout: {saved} saved, {conceded} conceded', inGoalSr: 'in goal',
  tlSaveIcon: '✋', tlSaveSr: 'Save', tlSaveText: 'Save · {player}',
  tlPenSaveIcon: '✋', tlPenSaveSr: 'Penalty saved', tlPenSaveText: 'Penalty saved · {player}',

  penButton: 'Pen',
  penFor: 'Penalty foul for {name}',
  penPip: 'P',
  penNamed: 'Penalty foul · #{cap} {name}',
  tileFoulsAria: 'Exclusions: {excl}, penalty fouls: {pens}',
  manUpButton: 'Man-up',
  manUpEndButton: 'End man-up · no goal',
  manDownEndButton: 'End man-down · stopped',
  situationSeconds: '{s} s',
  manUpEvent: 'Man-up',
  manUpEndEvent: 'End man-up · no goal',
  manDownEndEvent: 'End man-down · stopped',
  situationShort: 'MU {scored}/{muPlayed} · MD {stopped}/{mdPlayed}',
  notTracked: '—',
  situationManUp: 'Man-up',
  situationManDown: 'Man-down',
  tlPenIcon: 'P',
  tlPenSr: 'Penalty foul',
  tlManUpTag: 'man-up',
  // Release 2's timeline: the tag after a fouling-out foul, and the line under the heading.
  tlOutTag: '· out',
  timelineDated: '{date} · newest first',
  timelineNewest: 'Newest first',
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
  connectionNote: 'Reconnecting. Showing the last score received.',
  // The scoreboard's goals-by-quarter table: read out as its caption, never shown.
  quarterGrid: 'Goals by quarter',
  // The tab bar: one under the scoreboard on a game, one under the season header on home.
  tabsGame: 'Game details',
  tabsSeason: 'Season details',
  tabTimeline: 'Timeline',
  tabResults: 'Results',
  tabPlayers: 'Players',
  tabTeam: 'Team',
  teamUnavailable: 'Team stats aren\'t available right now.',
  playersEmpty: 'No player stats yet.',
  // The Team tab (js/teamView.js): one game, and the season.
  teamSituationsHeading: 'Man-up · man-down',
  teamScored: 'scored',
  teamStopped: 'stopped',
  teamTotal: 'Total',
  teamUntracked: 'Man-up and man-down weren\'t tracked in this game',
  teamGoalsHeading: 'Goals',
  teamGoalsFor: 'Goals for',
  teamGoalsAgainst: 'Goals against',
  teamGoalsManUp: 'man-up',
  teamGoalsManDown: 'while a man down',
  teamGoalsOther: 'other',
  teamGoalsSr: '{total} · {part} {label}',
  teamFoulsHeading: 'Fouls',
  teamExclusions: 'Exclusions',
  teamPenFouls: 'Penalty fouls',
  teamTroubleNote: '{fouls} of {limit} fouls · one more and out',
  teamPensAgainst: 'Penalties against',
  teamPensValue: '{faced} faced · {saved} saved',
  teamFlowHeading: 'Game flow',
  teamFlowLead: 'Biggest lead',
  teamFlowNeverAhead: 'never ahead',
  teamFlowRun: 'Longest run',
  teamFlowTies: 'Ties',
  teamFlowNeverBehind: '· never behind',
  teamFlowScorers: 'Different scorers',
  teamByGame: 'By game',
  teamColGame: 'Game',
  teamColMu: 'MU',
  teamColMd: 'MD',
  teamColExcl: 'EXCL',
  teamSeasonTotal: 'Season',
  teamExclPerGame: '{n}/game',
  teamLegend: 'MU: man-up goals / man-ups · MD: man-downs stopped / man-downs · EXCL: our exclusions',
  teamQuartersHeading: 'Goals by quarter',
  teamQuarterFor: 'For',
  teamQuarterAgainst: 'Against',
  teamQuarterDiff: 'Difference',
  teamLoseOne: '{quarter} is the only quarter we lose.',
  teamLoseMany: 'We lose {quarters}.',
  teamAnd: 'and',
  teamCovers: 'Covers {n} of {of} games',
  teamSituationCovers: 'Man-up figures cover {n} of {of} games',
  goalNamed: 'Goal · #{cap} {name}',
  goalUnknown: 'Goal · scorer unknown',
  exclNamed: 'Exclusion · #{cap} {name}',
  oppGoal: 'Opponent goal',
  unknownPlayer: '#? Unknown player',
  tlGoalIcon: '🏐',
  tlExclIcon: 'E',
  tlOutIcon: '🟥',
  tlOutText: '{player} · out',
  tlOutSr: '{foul} · out',
  celebrateGoal: 'GOAL!',
  celebrateScorer: '#{cap} {name}',
  celebrateManUp: '{scorer} · man-up',
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
  takeoverPaused: 'Taps here are paused.',
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
  failedMore: '+{n} more',
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
  moreButton: '⋯',
  moreFor: 'Goal, exclusion or penalty for {name}',
  moreSheetTitle: '#{cap} {name}',
  tileGoalsLabel: 'goals',
  tileGoalsOne: 'goal',
  tileGoalsAria: '{n} goals',
  tileGoalsAriaOne: '{n} goal',
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
  sheetCancel: 'Cancel',
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
  allGames: 'This season',
  // remove in R4: read by the R2 viewer.js
  liveBanner: 'Live: {opponent} {us}–{them} · {period}',
  liveBadge: 'LIVE · {period}',
  resultsLoading: 'Loading results…',
  resultsEmpty: 'No games yet this season.',
  resultsFailed: 'Results aren\'t available right now.',
  watchLive: 'Watch',
  gameUnavailable: 'That game isn\'t available.',
  openGameFor: 'Open the game against {opponent} on {date}',
  // Season header and result rows
  seasonRecord: '{w} W · {l} L',
  seasonRecordDraws: '{w} W · {l} L · {d} D',
  resultW: 'W',
  resultL: 'L',
  resultD: 'D',
  // A result link's accessible name: the outcome in words, the score (with its shootout), the opponent.
  resultNameW: 'Win',
  resultNameL: 'Loss',
  resultNameD: 'Draw',
  resultLabel: '{outcome} {score} against {opponent}',
  resultPen: 'pen. {us}–{them}',
  resultNoScore: '–',
};

// remove in R4: read by the R2 viewer.js
export const TIMELINE_SAVES = true;

// remove in R4: read by the R2 viewer.js
export function hasString(key) {
  return Object.hasOwn(STRINGS, key);
}

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
  if (['save', 'penSave', 'gkIn'].includes(event.type)) {
    return t(`${event.type}Named`, { cap: player.cap, name: player.name });
  }
  return t(event.type === 'goal' ? 'goalNamed' : event.type === 'pen' ? 'penNamed' : 'exclNamed', { cap: player.cap, name: player.name });
}

export function timelineEntry(event, lineup, opponent, out = false) {
  if (event.type === 'oppGoal') {
    return {
      side: 'them',
      icon: t('tlGoalIcon'),
      sr: t('tlOppGoalSr'),
      text: opponent?.trim() || t('tlOpponentFallback'),
      badge: false,
    };
  }
  const isGoal = event.type === 'goal';
  const isFoul = event.type === 'excl' || event.type === 'pen';
  const isOut = isFoul && out;
  const foul = t(event.type === 'pen' ? 'tlPenSr' : 'tlExclSr');
  const entry = {
    side: 'us',
    icon: t(isOut ? 'tlOutIcon' : isGoal ? 'tlGoalIcon' : event.type === 'pen' ? 'tlPenIcon' : 'tlExclIcon'),
    sr: isOut ? t('tlOutSr', { foul }) : isGoal ? t('tlGoalSr') : foul,
    badge: isFoul && !isOut,
  };
  if (isGoal && event.playerId == null) return { ...entry, text: t('tlUnknownScorer') };
  const player = lineup.find(candidate => candidate.playerId === event.playerId);
  const text = player ? t('tlPlayer', { cap: player.cap, name: player.name }) : t('unknownPlayer');
  if (event.type === 'save') {
    return { side: 'us', icon: t('tlSaveIcon'), sr: t('tlSaveSr'),
      text: t('tlSaveText', { player: text }), badge: false, minor: true };
  }
  if (event.type === 'penSave') {
    return { side: 'us', icon: t('tlPenSaveIcon'), sr: t('tlPenSaveSr'),
      text: t('tlPenSaveText', { player: text }), badge: false };
  }
  return { ...entry, text: isOut ? t('tlOutText', { player: text }) : text };
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

export function situationShort(counts) {
  if (counts === null) return t('notTracked');
  return t('situationShort', {
    scored: counts.manUp.scored, muPlayed: counts.manUp.played,
    stopped: counts.manDown.stopped, mdPlayed: counts.manDown.played,
  });
}
