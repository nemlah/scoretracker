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
