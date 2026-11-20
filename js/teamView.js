// The Team tab's panels, for one game and for the season. The viewer loads this module on its own, off the
// critical path, and shows a line instead if it never arrives. The numbers come from teamStats.js (imported
// statically: the two load or fail together); every string is looked up in strings.js, and a figure that is
// missing is a dash, never "undefined" or "NaN".
import { EXCL_LIMIT, formatDate, playerLines } from './model.js';
import { periodLabel, t } from './strings.js';
import { gameTeamStats, pct, seasonTeamStats } from './teamStats.js';
import { h } from './ui/dom.js';

const DASH = '–';
const MINUS = '−';
const QUARTERS = [1, 2, 3, 4];

const isCount = value => Number.isSafeInteger(value) && value >= 0;
const percent = (part, whole) => {
  const value = pct(part, whole);
  return value === null ? null : t('savePctText', { pct: value });
};

// A titled card, as the Players tab's blocks are.
const block = (heading, ...content) => h('section', { class: 'panel-block' },
  h('h2', {}, heading), h('div', { class: 'panel-card' }, ...content));

// A figure that may be absent. "–" is drawn dim.
const cell = (text, testid = 'team-q', extra = '') => h('td', {
  class: `team-q${text === DASH ? ' is-none' : ''}${extra}`, 'data-testid': testid,
}, text);

// One row of a table with the four quarters and a total: a label (and what it counts), a cell per quarter,
// and the total with its percentage under it.
function figureRow({ id, label, sub = null, cells, total, percentText = null, totalClass = '' }) {
  return h('tr', { 'data-testid': id },
    h('th', { scope: 'row', class: 'team-row-head' },
      h('span', { class: 'team-label' }, label),
      sub === null ? null : h('span', { class: 'team-sub' }, sub)),
    cells,
    h('td', { class: `team-total-cell${totalClass}` },
      h('span', { class: 'team-total', 'data-testid': 'team-total' }, total),
      percentText === null ? null : h('span', { class: 'team-pct', 'data-testid': 'team-pct' }, percentText)));
}

const quarterHead = () => h('thead', {}, h('tr', {},
  h('td', { 'aria-hidden': 'true' }),
  QUARTERS.map(quarter => h('th', { scope: 'col', class: 'team-q' }, periodLabel(quarter))),
  h('th', { scope: 'col', class: 'team-total-cell' }, t('teamTotal'))));

const quarterTable = (testid, rows) => h('table', { class: 'team-table', 'data-testid': testid },
  quarterHead(), h('tbody', {}, rows));

// "scored/played" of a quarter; a quarter with none played is a dash.
const ratio = (quarter, successful) => (quarter.played > 0 ? `${quarter[successful]}/${quarter.played}` : DASH);

function situationRow(id, label, sub, counts, successful) {
  const total = counts.played > 0 ? `${counts[successful]}/${counts.played}` : DASH;
  return figureRow({
    id,
    label,
    sub,
    cells: counts.quarters.map(quarter => cell(ratio(quarter, successful))),
    total,
    percentText: percent(counts[successful], counts.played),
  });
}

// A bar that shows `part` of `total`, with a legend naming the part and the rest. Without a part (the game
// was not tracked) it is the total alone. A tracked side with no goals keeps its legend ("0 man-up · 0 other"):
// its bar is an empty track, with no fill, and still says the figures.
function goalsBlock(testid, kind, label, total, part, partLabel) {
  const split = isCount(part) && isCount(total) && part <= total;
  const rest = split ? total - part : null;
  let fill = null;
  if (split && part > 0) {
    fill = h('span', { class: `team-bar-fill team-bar-fill--${kind}`, 'data-testid': 'team-bar-fill' });
    fill.style.width = `${Math.round(100 * part / total)}%`;
  }
  return h('div', { class: 'team-goals', 'data-testid': testid },
    h('div', { class: 'team-goals-head' },
      h('span', { class: 'team-goals-label' }, label),
      h('span', { class: 'team-goals-total', 'data-testid': 'team-goals-total' }, total)),
    split ? [
      h('span', {
        class: 'team-bar', role: 'img', 'aria-label': t('teamGoalsSr', { total, part, label: partLabel }),
      }, fill),
      h('span', { class: 'team-legend' },
        h('span', { class: 'team-legend-item', 'data-testid': 'team-goals-part' },
          h('span', { class: `team-swatch team-swatch--${kind}`, 'aria-hidden': 'true' }),
          h('strong', {}, part), ` ${partLabel}`),
        h('span', { class: 'team-legend-item', 'data-testid': 'team-goals-rest' },
          h('span', { class: 'team-swatch', 'aria-hidden': 'true' }),
          h('strong', {}, rest), ` ${t('teamGoalsOther')}`)),
    ] : null);
}

// Three pips: the fouls a player has (exclusions, then penalty fouls), then the ones left. Out is all three.
function pips(kinds) {
  const shown = kinds.slice(0, EXCL_LIMIT);
  return Array.from({ length: EXCL_LIMIT }, (_, index) => h('span', {
    class: `team-pip team-pip--${shown[index] ?? 'empty'}`,
  }));
}

function troubleRow(player, line) {
  const excl = line?.excl ?? player.fouls;
  const pens = line?.pens ?? 0;
  const kinds = [...Array(excl).fill('excl'), ...Array(pens).fill('pen')];
  return h('div', { class: 'team-trouble', 'data-testid': 'foul-trouble-row', 'data-cap': player.cap },
    h('span', { class: player.out ? 'cap cap--out' : 'cap' }, player.cap),
    h('span', { class: 'team-trouble-who' },
      h('span', { class: 'team-trouble-name', 'data-testid': 'foul-trouble-name' }, player.name),
      h('span', { class: `team-trouble-note${player.out ? ' is-out' : ''}`, 'data-testid': 'foul-trouble-note' },
        player.out ? t('out') : t('teamTroubleNote', { fouls: player.fouls, limit: EXCL_LIMIT }))),
    h('span', { class: 'team-pips', role: 'img', 'aria-label': t('tileFoulsAria', { excl, pens }) }, pips(kinds)));
}

const flowRow = (label, testid, value) => h('div', { class: 'team-flow-row' },
  h('span', {}, label), h('span', { class: 'team-flow-value', 'data-testid': testid }, value));

export function gamePanel(game) {
  const stats = gameTeamStats(game);
  const lines = new Map(playerLines(game.lineup, game.events).map(line => [line.playerId, line]));
  const { goals, flow } = stats;
  return [
    block(t('teamSituationsHeading'), stats.tracked
      ? quarterTable('team-situations', [
        situationRow('team-manup', t('situationManUp'), t('teamScored'), stats.manUp, 'scored'),
        situationRow('team-mandown', t('situationManDown'), t('teamStopped'), stats.manDown, 'stopped'),
      ])
      : h('p', { class: 'team-note', 'data-testid': 'team-untracked' }, t('teamUntracked'))),
    h('section', { class: 'panel-block' },
      h('h2', {}, t('teamGoalsHeading')),
      h('div', { class: 'panel-card team-goals-card' },
        goalsBlock('team-goals-for', 'for', t('teamGoalsFor'), goals.for, goals.manUpFor, t('teamGoalsManUp')),
        goalsBlock('team-goals-against', 'against', t('teamGoalsAgainst'), goals.against,
          goals.manDownAgainst, t('teamGoalsManDown')))),
    block(t('teamFoulsHeading'),
      quarterTable('team-fouls', [
        foulRow('team-fouls-excl', t('teamExclusions'), stats.fouls.quarters.map(quarter => quarter.excl), stats.fouls.excl),
        foulRow('team-fouls-pens', t('teamPenFouls'), stats.fouls.quarters.map(quarter => quarter.pens), stats.fouls.pens),
      ]),
      stats.trouble.map(player => troubleRow(player, lines.get(player.playerId))),
      h('div', { class: 'team-flow-row team-pens' },
        h('span', {}, t('teamPensAgainst')),
        h('span', { class: 'team-pens-value', 'data-testid': 'team-pens-against' },
          t('teamPensValue', { faced: stats.pensAgainst.faced, saved: stats.pensAgainst.saved })))),
    block(t('teamFlowHeading'),
      flowRow(t('teamFlowLead'), 'flow-lead', flow.biggestLead > 0 ? `+${flow.biggestLead}` : t('teamFlowNeverAhead')),
      flowRow(t('teamFlowRun'), 'flow-run', flow.longestRun === null ? DASH : `${flow.longestRun.us}–${flow.longestRun.them}`),
      flowRow(t('teamFlowTies'), 'flow-ties', flow.neverBehind ? `${flow.ties} ${t('teamFlowNeverBehind')}` : flow.ties),
      flowRow(t('teamFlowScorers'), 'flow-scorers', flow.scorers)),
  ];
}

function foulRow(id, label, quarters, total) {
  return figureRow({
    id,
    label,
    cells: quarters.map(count => cell(count > 0 ? String(count) : DASH)),
    total: String(total),
  });
}

// --- Season -------------------------------------------------------------------------------------------

const signed = n => (n > 0 ? `+${n}` : n < 0 ? `${MINUS}${-n}` : '0');
const ratioText = (figure, successful) => (figure === null ? DASH : `${figure[successful]}/${figure.played}`);

function gameRow(row) {
  const date = row.date === null ? '' : formatDate(row.date);
  return h('tr', { 'data-testid': 'season-team-game-row', 'data-game': row.gameId },
    h('th', { scope: 'row', class: 'team-row-head' },
      h('span', { class: 'team-label' }, row.opponent ?? ''),
      h('span', { class: 'team-sub' }, date)),
    cell(ratioText(row.manUp, 'scored'), 'season-team-mu', ' team-wide'),
    cell(ratioText(row.manDown, 'stopped'), 'season-team-md', ' team-wide'),
    cell(row.excl === null ? DASH : String(row.excl), 'season-team-excl', ' team-excl'));
}

// A total cell: the figure in the big face, its percentage (or per-game rate) under it.
function totalCell(testid, figure, under, className) {
  return h('td', { class: `team-total-cell ${className}` },
    h('span', { class: 'team-total', 'data-testid': testid }, figure),
    under === null ? null : h('span', { class: 'team-pct', 'data-testid': under.testid }, under.text));
}

function seasonTotalRow({ total }) {
  const tracked = total.situationGames > 0;
  const figure = (counts, successful, id) => {
    const text = percent(counts[successful], counts.played);
    return totalCell(`season-team-${id}-total`, tracked ? `${counts[successful]}/${counts.played}` : DASH,
      tracked && text !== null ? { testid: `season-team-${id}-pct`, text } : null, 'team-wide');
  };
  const perGame = total.exclGames > 0 ? (total.excl / total.exclGames).toFixed(1) : null;
  return h('tr', { 'data-testid': 'season-team-total', class: 'team-season-total' },
    h('th', { scope: 'row', class: 'team-row-head' }, h('span', { class: 'team-label' }, t('teamSeasonTotal'))),
    figure(total.manUp, 'scored', 'mu'),
    figure(total.manDown, 'stopped', 'md'),
    totalCell('season-team-excl-total', perGame === null ? DASH : String(total.excl),
      { testid: 'season-team-excl-avg', text: perGame === null ? DASH : t('teamExclPerGame', { n: perGame }) }, 'team-excl'));
}

function byGameBlock(season) {
  return block(t('teamByGame'),
    h('table', { class: 'team-table team-games', 'data-testid': 'season-team-games' },
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, t('teamColGame')),
        h('th', { scope: 'col', class: 'team-wide' }, t('teamColMu')),
        h('th', { scope: 'col', class: 'team-wide' }, t('teamColMd')),
        h('th', { scope: 'col', class: 'team-excl' }, t('teamColExcl')))),
      h('tbody', {}, season.games.map(gameRow), seasonTotalRow(season))),
    h('p', { class: 'team-note team-legend-note' }, t('teamLegend')));
}

function quarterRow(id, label, values, total, { bold = false, diff = false } = {}) {
  const text = value => (diff ? signed(value) : String(value));
  return h('tr', { 'data-testid': id, class: bold ? 'is-bold' : null },
    h('th', { scope: 'row', class: 'team-row-head' }, h('span', { class: 'team-label' }, label)),
    values === null
      ? QUARTERS.map(() => cell(DASH))
      : values.map(value => h('td', {
        class: `team-q${diff && value < 0 ? ' is-neg' : ''}`, 'data-testid': 'team-q',
      }, text(value))),
    h('td', { class: `team-total-cell${diff && total < 0 ? ' is-neg' : ''}` },
      h('span', { class: 'team-total', 'data-testid': 'team-total' }, values === null ? DASH : text(total))));
}

function joinQuarters(labels) {
  return labels.length > 1
    ? `${labels.slice(0, -1).join(', ')} ${t('teamAnd')} ${labels.at(-1)}`
    : labels[0];
}

function quartersBlock({ quarters }) {
  const known = quarters.covered > 0;
  const losing = known ? QUARTERS.filter((quarter, index) => quarters.diff[index] < 0).map(periodLabel) : [];
  return block(t('teamQuartersHeading'),
    quarterTable('season-quarters', [
      quarterRow('sq-for', t('teamQuarterFor'), known ? quarters.for : null, quarters.totalFor),
      quarterRow('sq-against', t('teamQuarterAgainst'), known ? quarters.against : null, quarters.totalAgainst),
      quarterRow('sq-diff', t('teamQuarterDiff'), known ? quarters.diff : null, quarters.totalDiff, { bold: true, diff: true }),
    ]),
    losing.length === 0 ? null : h('p', { class: 'team-note', 'data-testid': 'season-quarters-note' },
      losing.length === 1 ? t('teamLoseOne', { quarter: losing[0] }) : t('teamLoseMany', { quarters: joinQuarters(losing) })),
    quarters.covered < quarters.of
      ? h('p', { class: 'team-note', 'data-testid': 'season-quarters-coverage' }, t('teamCovers', { n: quarters.covered, of: quarters.of }))
      : null);
}

function seasonGoalsBlock({ goals }) {
  const known = goals.situationGames > 0;
  return h('section', { class: 'panel-block' },
    h('h2', {}, t('teamGoalsHeading')),
    h('div', { class: 'panel-card team-goals-card', 'data-testid': 'season-goals' },
      goalsBlock('team-goals-for', 'for', t('teamGoalsFor'), goals.for, known ? goals.manUpFor : null, t('teamGoalsManUp')),
      goalsBlock('team-goals-against', 'against', t('teamGoalsAgainst'), goals.against,
        known ? goals.manDownAgainst : null, t('teamGoalsManDown')),
      goals.situationGames < goals.of
        ? h('p', { class: 'team-note team-note--bare', 'data-testid': 'season-goals-coverage' },
          t('teamSituationCovers', { n: goals.situationGames, of: goals.of }))
        : null));
}

export function seasonPanel(stats) {
  const season = seasonTeamStats(stats);
  if (season.games.length === 0) {
    return [h('p', { class: 'muted', 'data-testid': 'season-team-empty' }, t('resultsEmpty'))];
  }
  return [byGameBlock(season), quartersBlock(season), seasonGoalsBlock(season)];
}
