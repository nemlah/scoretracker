import {
  assignCap, defaultSelection, isValidSeason, lineupFrom, seasonFor, todayIso, toggleSelected, validateLineup,
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
  let choosingLineup = false;
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
  // The season follows the date until it is edited by hand.
  let seasonTouched = false;
  const season = h('input', {
    id: 'game-season', class: 'input', type: 'text', inputmode: 'numeric', autocomplete: 'off',
    value: seasonFor(todayIso()), 'aria-describedby': 'game-season-error', 'data-testid': 'season-input',
    oninput: () => { seasonTouched = true; if (selection !== null) renderRows(); },
  });
  date.addEventListener('input', () => {
    if (!seasonTouched && date.value) season.value = seasonFor(date.value);
    if (selection !== null) renderRows();
  });
  const seasonError = h('p', { id: 'game-season-error', class: 'form-error', role: 'alert', 'data-testid': 'season-error', hidden: true },
    t('seasonInvalid'));
  const list = h('ul', { class: 'sel-list', 'data-testid': 'sel-list' });
  const lineupError = h('p', { class: 'form-error', role: 'alert', 'data-testid': 'lineup-error', hidden: true });
  const empty = h('div', { class: 'stack', hidden: true },
    h('p', {}, t('newNoRoster')),
    h('button', { type: 'button', class: 'btn btn--wide', onclick: () => ctx.navigate('/roster') }, t('newGoRoster')));
  const next = h('button', {
    type: 'submit', class: 'btn btn--primary btn--wide btn--center newgame-next', 'data-testid': 'newgame-next',
  }, t('newGameNext'));
  const back = h('button', {
    type: 'button', class: 'btn btn--ghost btn--fit', 'data-testid': 'newgame-back', onclick: showDetails,
  }, t('newGameBack'));
  const start = h('button', {
    type: 'button', class: 'btn btn--primary btn--wide btn--center', 'data-testid': 'start-game', onclick: startGame,
  }, t('startGame'));
  const detailsHeading = h('h2', {}, t('newHeading'));
  const lineupHeading = h('h2', { class: 'sel-heading', tabindex: '-1' }, t('newGameWhoHeading'));
  const detailsStep = h('section', { hidden: true },
    h('form', { class: 'new-form new-form--details', novalidate: true, onsubmit: showLineup },
      h('div', { class: 'field' }, h('label', { for: 'opponent' }, t('opponentLabel')), opponent),
      h('div', { class: 'field' }, h('label', { for: 'game-date' }, t('dateLabel')), date),
      h('div', { class: 'field' }, h('label', { for: 'game-season' }, t('seasonLabel')), season, seasonError),
      next));
  const lineupStep = h('section', { class: 'new-form', hidden: true },
    lineupHeading, back, empty, list, lineupError, start);
  const blocked = h('div', { class: 'stack', hidden: true },
    h('a', { class: 'btn btn--primary btn--wide', href: '#/live', 'data-testid': 'resume-live' }, t('endLiveGameFirst')));
  const loading = h('p', { class: 'status-line' }, t('trackerLoading'));
  root.append(h('section', { class: 'new-game' }, detailsHeading, loading, blocked, detailsStep, lineupStep));

  function renderStep(state) {
    const formAvailable = state.gameLoaded && state.game?.status !== 'live';
    detailsStep.hidden = !formAvailable || choosingLineup;
    lineupStep.hidden = !formAvailable || !choosingLineup;
    detailsHeading.hidden = !lineupStep.hidden;
  }

  function showLineup(event) {
    event.preventDefault();
    if (detailsStep.hidden || !isValidSeason(season.value.trim())) return;
    choosingLineup = true;
    renderStep(ctx.getState());
    lineupHeading.focus();
  }

  function showDetails() {
    choosingLineup = false;
    renderStep(ctx.getState());
    next.focus();
  }

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
      h('label', { class: 'sel-label' }, check, h('span', { class: 'sel-name' }, player.name),
        player.goalie === true ? h('span', { class: 'gk-badge', 'data-testid': 'sel-gk' }, t('gkBadge')) : null),
      cap, error);
    return { el, check, cap, error };
  }

  function renderRows() {
    const errors = validateLineup(selection);
    // Enabled while this device can take control by itself on the first touch (state.writable);
    // a cached app.js from the previous release lacks it.
    const current = ctx.getState();
    const writable = current.writable ?? current.active;
    const reasonOf = id => errors.find(error => error.playerId === id)?.reason;
    for (const player of selection) {
      const parts = rows.get(player.playerId);
      parts.check.checked = player.selected;
      // The field being typed in keeps its text; every other field shows the committed cap.
      if (document.activeElement !== parts.cap) parts.cap.value = player.cap ?? '';
      else if (capValue(parts.cap.value) !== player.cap) parts.cap.value = player.cap ?? '';
      parts.cap.disabled = !player.selected || !writable;
      const reason = player.selected ? reasonOf(player.playerId) : undefined;
      parts.error.hidden = reason === undefined;
      parts.error.textContent = reason === undefined ? '' : t(REASONS[reason]);
    }
    const noPlayers = errors.some(error => error.reason === 'noPlayers');
    lineupError.hidden = !noPlayers;
    lineupError.textContent = noPlayers ? t('selNoPlayers') : '';
    const seasonOk = isValidSeason(season.value.trim());
    seasonError.hidden = seasonOk;
    next.disabled = !seasonOk;
    start.disabled = starting || errors.length > 0 || !seasonOk || !writable;
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
    if (lineupStep.hidden || starting || !state.active || validateLineup(selection).length > 0 || !isValidSeason(season.value.trim())) return;
    starting = true;
    renderRows();
    try {
      const created = ctx.repo.createGame({
        opponent: opponent.value.trim() || t('opponentDefault'),
        date: date.value || todayIso(),
        season: season.value.trim(),
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
    renderStep(state);
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
