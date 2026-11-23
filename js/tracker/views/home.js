import { team } from '../../config.js';
import { deriveScore, formatDate } from '../../model.js';
import * as model from '../../model.js';
import * as strings from '../../strings.js';
import { periodLabel, t } from '../../strings.js';
import { h } from '../../ui/dom.js';

const NAV_ICONS = {
  new: 'M12 5v14M5 12h14',
  roster: 'M16 11a4 4 0 1 0-8 0a4 4 0 1 0 8 0M4 21a8 8 0 0 1 16 0',
  competitions: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  games: 'M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0M12 7v5l3 2',
};

function navIcon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [key, value] of Object.entries({
    width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  })) svg.setAttribute(key, value);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', NAV_ICONS[name]);
  svg.append(path);
  return svg;
}

export function mount(root, ctx) {
  let unmounted = false;
  const badge = h('span', { class: 'tracker-badge tracker-badge--live' });
  const date = h('span', { class: 'tracker-board-date' });
  const score = h('span', { class: 'home-live-score', 'data-testid': 'home-live-score' });
  const opponent = h('span', { class: 'home-live-name home-live-opponent game-opponent', lang: 'el' });
  const resume = h('button', {
    type: 'button', class: 'btn btn--primary btn--wide home-resume', 'data-testid': 'home-resume',
    onclick: () => ctx.navigate('/live'),
  }, t('homeResume'));
  const live = h('section', {
    class: 'tracker-scoreboard home-live-card', 'aria-label': t('homeLive'), 'data-testid': 'home-live',
  },
  h('div', { class: 'tracker-board-head' }, badge, date),
  h('p', { class: 'home-live-line' }, h('span', { class: 'home-live-name game-opponent' }, team.name), score, opponent),
  resume);
  const rosterCount = h('span', { class: 'home-nav-count', 'data-testid': 'home-roster-count' });
  const gamesCount = h('span', { class: 'home-nav-count', 'data-testid': 'home-games-count', hidden: true });
  const start = navRow('new', 'homeNew');
  // The Competitions row needs this release's app.js (the route), repo, model and strings together.
  const competitionsOn = ctx.competitionsRoute === true && ctx.repo?.competitionLists === true
    && typeof model.listEntries === 'function' && strings.hasString?.('homeCompetitions') === true;
  const nav = h('nav', { class: 'stack home-nav', 'aria-label': t('homeNav') },
    start, navRow('roster', 'homeRoster', rosterCount),
    competitionsOn ? navRow('competitions', 'homeCompetitions') : null,
    navRow('games', 'homeGames', gamesCount));
  const home = h('section', { class: 'home home--board' }, nav);
  root.append(home);

  function navRow(route, label, count) {
    return h('button', {
      type: 'button', class: 'btn btn--wide home-nav-row', 'data-write': route === 'new',
      'data-testid': `home-${route}`, onclick: () => ctx.navigate(`/${route}`),
    }, navIcon(route), h('span', { class: 'home-nav-label' }, t(label)), count,
    h('span', { class: 'tracker-chevron', 'aria-hidden': 'true' }));
  }

  async function loadGameCount() {
    try {
      const games = await ctx.repo.listGames();
      if (unmounted) return;
      gamesCount.textContent = games.length;
      gamesCount.hidden = false;
    } catch {
      // The optional count stays hidden if the list is unavailable.
    }
  }

  function update(state) {
    const { game } = state;
    const count = (state.team?.roster ?? []).filter(player => player.archived !== true).length;
    rosterCount.textContent = t(count === 1 ? 'homeRosterCountOne' : 'homeRosterCount', { count });
    const isLive = game?.status === 'live';
    start.classList.toggle('btn--primary', !isLive);
    if (!isLive) {
      live.remove();
      return;
    }
    if (!live.parentNode) home.prepend(live);
    badge.textContent = t('liveBadge', { period: periodLabel(game.period) });
    date.textContent = formatDate(game.date);
    score.textContent = t('homeLiveScore', deriveScore(game.events ?? []));
    opponent.textContent = game.opponent;
  }

  loadGameCount();
  return {
    update,
    unmount() {
      unmounted = true;
      root.replaceChildren();
    },
  };
}
