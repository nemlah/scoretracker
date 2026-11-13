import { t } from '../../strings.js';
import { h } from '../../ui/dom.js';

export function mount(root, ctx) {
  const go = route => () => ctx.navigate(route);
  const resume = h('button', {
    type: 'button', class: 'btn btn--primary btn--wide', 'data-testid': 'home-resume', onclick: go('/live'),
  }, t('homeResume'));
  const start = h('button', {
    type: 'button', class: 'btn btn--wide', 'data-write': true, 'data-testid': 'home-new', onclick: go('/new'),
  }, t('homeNew'));
  const rosterButton = h('button', {
    type: 'button', class: 'btn btn--wide', 'data-testid': 'home-roster', onclick: go('/roster'),
  }, t('homeRoster'));
  const games = h('button', {
    type: 'button', class: 'btn btn--wide', 'data-testid': 'home-games', onclick: go('/games'),
  }, t('homeGames'));
  root.append(h('section', { class: 'home' },
    h('h2', {}, t('homeHeading')),
    h('div', { class: 'stack' }, resume, start, rosterButton, games)));

  function update(state) {
    // Only a game that is still live can be resumed; a finished one is just history.
    const hasGame = state.game?.status === 'live';
    resume.hidden = !hasGame;
    start.classList.toggle('btn--primary', !hasGame);
  }

  return { update, unmount() { root.replaceChildren(); } };
}
