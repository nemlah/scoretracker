import {
  assignCap, defaultSelection, lineupFrom, todayIso, toggleSelected, validateLineup,
} from '../../model.js';
import { t } from '../../strings.js';
import { h } from '../../ui/dom.js';

const MAX_OPPONENT = 40;
const REASONS = { missingCap: 'selMissingCap', badCap: 'selBadCap', duplicateCap: 'selDuplicateCap' };

export function mount(root, ctx) {
  let selection = null; // set once, from the roster and the previous game
  // The selection when a cap field got focus. Typing "12" passes through "1"; every keystroke
  // is applied to this base, so the stray "1" never leaves a swap behind.
  let base = null;
  let starting = false;
  let startedId = null;
  let unmounted = false;
  const rows = new Map(); // playerId -> { el, check, cap, error }

  const opponent = h('input', {
    id: 'opponent', class: 'input', type: 'text', maxlength: MAX_OPPONENT, autocomplete: 'off',
    enterkeyhint: 'next', 'data-testid': 'opponent-input',
  });
  const date = h('input', {
    id: 'game-date', class: 'input', type: 'date', value: todayIso(), 'data-testid': 'date-input',
  });
  const list = h('ul', { class: 'sel-list', 'data-testid': 'sel-list' });
  const lineupError = h('p', { class: 'form-error', role: 'alert', 'data-testid': 'lineup-error', hidden: true });
  const empty = h('div', { class: 'stack', hidden: true },
    h('p', {}, t('newNoRoster')),
    h('button', { type: 'button', class: 'btn btn--wide', onclick: () => ctx.navigate('/roster') }, t('newGoRoster')));
  const start = h('button', {
    type: 'button', class: 'btn btn--primary btn--wide btn--center', 'data-testid': 'start-game', onclick: startGame,
  }, t('startGame'));
  const form = h('form', { class: 'new-form', novalidate: true, onsubmit: event => { event.preventDefault(); startGame(); } },
    h('div', { class: 'field' }, h('label', { for: 'opponent' }, t('opponentLabel')), opponent),
    h('div', { class: 'field' }, h('label', { for: 'game-date' }, t('dateLabel')), date),
    h('h3', { class: 'sel-heading' }, t('lineupHeading')),
    empty, list, lineupError, start);
  const blocked = h('div', { class: 'stack', hidden: true },
    h('a', { class: 'btn btn--primary btn--wide', href: '#/live', 'data-testid': 'resume-live' }, t('endLiveGameFirst')));
  const loading = h('p', { class: 'status-line' }, t('trackerLoading'));
  root.append(h('section', { class: 'new-game' }, h('h2', {}, t('newHeading')), loading, blocked, form));
  form.hidden = true;

  function capValue(text) {
    return text === '' ? null : Number(text);
  }

  function setSelection(next) {
    selection = next;
    renderRows();
  }

  function buildRow(player) {
    const check = h('input', {
      type: 'checkbox', class: 'sel-check', 'data-testid': 'sel-check',
      onchange: () => { base = null; setSelection(toggleSelected(selection, player.playerId)); },
    });
    const cap = h('input', {
      class: 'input input--cap', type: 'text', inputmode: 'numeric', maxlength: 2, autocomplete: 'off',
      'aria-label': t('capFor', { name: player.name }), 'data-testid': 'sel-cap',
      onfocus: () => { base = selection.map(entry => ({ ...entry })); },
      onblur: () => { base = null; },
      oninput: () => {
        cap.value = cap.value.replace(/\D/g, '').slice(0, 2);
        const from = base ?? selection;
        const value = capValue(cap.value);
        setSelection(value === null
          ? from.map(entry => (entry.playerId === player.playerId ? { ...entry, cap: null } : { ...entry }))
          : assignCap(from, player.playerId, value));
      },
    });
    const error = h('p', { class: 'form-error sel-error', role: 'alert', 'data-testid': 'sel-error', hidden: true });
    const el = h('li', { class: 'sel-row', 'data-testid': 'sel-row', 'data-player-id': player.playerId },
      h('label', { class: 'sel-label' }, check, h('span', { class: 'sel-name' }, player.name)),
      cap, error);
    return { el, check, cap, error };
  }

  function renderRows() {
    const errors = validateLineup(selection);
    const reasonOf = id => errors.find(error => error.playerId === id)?.reason;
    for (const player of selection) {
      const parts = rows.get(player.playerId);
      parts.check.checked = player.selected;
      // The field being typed in keeps its text; every other field shows the committed cap.
      if (document.activeElement !== parts.cap) parts.cap.value = player.cap ?? '';
      else if (capValue(parts.cap.value) !== player.cap) parts.cap.value = player.cap ?? '';
      parts.cap.disabled = !player.selected || !ctx.getState().active;
      const reason = player.selected ? reasonOf(player.playerId) : undefined;
      parts.error.hidden = reason === undefined;
      parts.error.textContent = reason === undefined ? '' : t(REASONS[reason]);
    }
    const noPlayers = errors.some(error => error.reason === 'noPlayers');
    lineupError.hidden = !noPlayers;
    lineupError.textContent = noPlayers ? t('selNoPlayers') : '';
    start.disabled = starting || errors.length > 0 || !ctx.getState().active;
  }

  function init(state) {
    const previous = state.game ?? null;
    selection = defaultSelection(state.team?.roster ?? [], previous);
    for (const player of selection) {
      const parts = buildRow(player);
      rows.set(player.playerId, parts);
      list.append(parts.el);
    }
    empty.hidden = selection.length > 0;
    list.hidden = selection.length === 0;
    renderRows();
  }

  function startGame() {
    const state = ctx.getState();
    if (starting || !state.active || validateLineup(selection).length > 0) return;
    starting = true;
    renderRows();
    try {
      const created = ctx.repo.createGame({
        opponent: opponent.value.trim() || t('opponentDefault'),
        date: date.value || todayIso(),
        lineup: lineupFrom(selection),
        roster: state.team?.roster ?? [],
      });
      startedId = created.id;
      Promise.resolve(created.done).catch(err => {
        ctx.onWriteError(err);
        // A refused game leaves the form usable again.
        if (!unmounted) { starting = false; startedId = null; renderRows(); }
      });
    } catch (err) {
      starting = false;
      renderRows();
      ctx.onWriteError(err);
    }
  }

  function update(state) {
    const ready = state.gameLoaded;
    const isLive = state.game?.status === 'live';
    loading.hidden = ready;
    blocked.hidden = !(ready && isLive);
    form.hidden = !(ready && !isLive);
    if (ready && !isLive && selection === null) init(state);
    if (selection !== null) renderRows();
    // Go to the live screen once the new game is the team's current game.
    if (startedId !== null && state.team?.currentGameId === startedId) {
      const id = startedId;
      startedId = null;
      if (id) ctx.navigate('/live');
    }
  }

  return { update, unmount() { unmounted = true; root.replaceChildren(); } };
}
