export const seasonStatsFull = {
  players: {
    p1: { name: 'Νίκος Λέκκας', games: 4, goals: 0, excl: 0, pens: 0 },
    p7: { name: 'Άρης Λάμπρου', games: 4, goals: 4, excl: 3, pens: 1 },
    p12: { name: 'Αλέξανδρος Κωνσταντίνος Παπαγεωργίου', games: 4, goals: 9, excl: 3, pens: 3 },
  },
  goalies: {
    p1: { name: 'Νίκος Λέκκας', games: 4, saves: 18, penSaves: 2, goalsAgainst: 14 },
  },
  situations: { manUp: { played: 6, scored: 3 }, manDown: { played: 5, stopped: 3 } },
  results: [
    {
      gameId: 'team-g1', date: '2026-11-16', opponent: 'Harbour WPC', us: 5, them: 3,
      excl: 3, pens: 2, quarters: [{ us: 2, them: 1 }, { us: 0, them: 1 }, { us: 2, them: 0 }, { us: 1, them: 1 }],
      manUp: { played: 2, scored: 1 }, manDown: { played: 3, stopped: 2 },
    },
    {
      gameId: 'team-g2', date: '2026-11-09', opponent: 'Marina WP', us: 3, them: 4,
      excl: 2, pens: 1,
      manUp: { played: 3, scored: 2 }, manDown: { played: 2, stopped: 1 },
    },
    {
      gameId: 'team-g3', date: '2026-11-02', opponent: 'Northside WPC', us: 2, them: 3,
      excl: 1, pens: 0, quarters: [{ us: 0, them: 1 }, { us: 1, them: 0 }, { us: 0, them: 1 }, { us: 1, them: 1 }],
    },
    {
      gameId: 'team-g4', date: '2026-10-26', opponent: 'Bay Aquatics', us: 4, them: 4,
      excl: 0, pens: 1, quarters: [{ us: 1, them: 0 }, { us: 0, them: 2 }, { us: 2, them: 1 }, { us: 1, them: 1 }],
      soUs: 3, soThem: 2, manUp: { played: 1, scored: 0 }, manDown: { played: 0, stopped: 0 },
    },
  ],
};

export const seasonStatsOld = {
  ...seasonStatsFull,
  results: seasonStatsFull.results.map(({ excl, pens, quarters, ...result }) => result),
};

export const seasonStatsFullExpected = {
  games: [
    {
      gameId: 'team-g1', opponent: 'Harbour WPC', date: '2026-11-16',
      manUp: { played: 2, scored: 1 }, manDown: { played: 3, stopped: 2 }, excl: 3,
    },
    {
      gameId: 'team-g2', opponent: 'Marina WP', date: '2026-11-09',
      manUp: { played: 3, scored: 2 }, manDown: { played: 2, stopped: 1 }, excl: 2,
    },
    { gameId: 'team-g3', opponent: 'Northside WPC', date: '2026-11-02', manUp: null, manDown: null, excl: 1 },
    {
      gameId: 'team-g4', opponent: 'Bay Aquatics', date: '2026-10-26',
      manUp: { played: 1, scored: 0 }, manDown: { played: 0, stopped: 0 }, excl: 0,
    },
  ],
  total: {
    manUp: { played: 6, scored: 3 }, manDown: { played: 5, stopped: 3 }, situationGames: 3, excl: 6, exclGames: 4,
  },
  quarters: {
    for: [3, 1, 4, 3], against: [2, 3, 2, 3], diff: [1, -2, 2, 0],
    totalFor: 11, totalAgainst: 10, totalDiff: 1, covered: 3, of: 4,
  },
  goals: { for: 14, against: 14, manUpFor: 3, manDownAgainst: 2, situationGames: 3, of: 4 },
};

export const seasonStatsOldExpected = {
  games: [
    {
      gameId: 'team-g1', opponent: 'Harbour WPC', date: '2026-11-16',
      manUp: { played: 2, scored: 1 }, manDown: { played: 3, stopped: 2 }, excl: null,
    },
    {
      gameId: 'team-g2', opponent: 'Marina WP', date: '2026-11-09',
      manUp: { played: 3, scored: 2 }, manDown: { played: 2, stopped: 1 }, excl: null,
    },
    { gameId: 'team-g3', opponent: 'Northside WPC', date: '2026-11-02', manUp: null, manDown: null, excl: null },
    {
      gameId: 'team-g4', opponent: 'Bay Aquatics', date: '2026-10-26',
      manUp: { played: 1, scored: 0 }, manDown: { played: 0, stopped: 0 }, excl: null,
    },
  ],
  total: {
    manUp: { played: 6, scored: 3 }, manDown: { played: 5, stopped: 3 }, situationGames: 3, excl: 0, exclGames: 0,
  },
  quarters: {
    for: [0, 0, 0, 0], against: [0, 0, 0, 0], diff: [0, 0, 0, 0],
    totalFor: 0, totalAgainst: 0, totalDiff: 0, covered: 0, of: 4,
  },
  goals: { for: 14, against: 14, manUpFor: 3, manDownAgainst: 2, situationGames: 3, of: 4 },
};
