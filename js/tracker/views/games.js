import {
  deriveScore, formatDate, hasShootout, isValidSeason, seasonFor,
} from '../../model.js';
import { scoreText, t } from '../../strings.js';
import { createConfirmButton } from '../../ui/confirm.js';
import { h } from '../../ui/dom.js';
import { recountAfter } from '../recount.js';
import { createEventsPanel } from './events.js';

function parseRoute(route) {
  const [, , id] = route.split('/');
  if (id === undefined || id === '') return null;
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

function resultText(game) {
  const score = deriveScore(game.events ?? []);
  const text = scoreText(score, hasShootout(game.period, game.events ?? []));
  return text.shootout ? `${text.main} ${text.shootout}` : text.main;
}

export function mount(root, ctx) {
  let unmounted = false;
  let mode = null; // 'list' | id of the game shown in the detail view
  let listToken = 0;
  let unwatch = null;
  let detailGame; // undefined until the first snapshot, null once known to be missing
  let detailMeta = null;
  let reopening = null; // id of a game we asked to reopen and are waiting to see live
  let infoFor = null; // id of the game the details form was last filled from
  let seasonTouched = false;

  // ---- list ----
  const listStatus = h('p', { class: 'status-line', role: 'status' }, t('gamesLoading'));
  const listEmpty = h('p', { 'data-testid': 'games-empty', hidden: true }, t('gamesEmpty'));
  const listRows = h('ul', { class: 'game-list', 'data-testid': 'games-list' });
  const listView = h('section', { class: 'games' }, h('h2', {}, t('gamesHeading')), listStatus, listEmpty, listRows);

  function loadList() {
    const token = listToken += 1;
    listStatus.hidden = false;
    listStatus.textContent = t('gamesLoading');
    listEmpty.hidden = true;
    listRows.replaceChildren();
    Promise.resolve(ctx.repo.listGames()).then(games => {
      if (unmounted || token !== listToken) return;
      listStatus.hidden = true;
      listEmpty.hidden = games.length > 0;
      listRows.replaceChildren(...games.map(game => h('li', {},
        h('a', {
          class: 'game-row', href: `#/games/${encodeURIComponent(game.id)}`, 'data-testid': 'game-row',
          'aria-label': t('gameOpenFor', { opponent: game.opponent }),
        },
        h('span', { class: 'game-date' }, formatDate(game.date)),
        h('span', { class: 'game-opponent' }, game.opponent),
        game.status === 'live' ? h('span', { class: 'game-live' }, t('gameLiveBadge')) : null,
        h('span', { class: 'game-score' }, resultText(game))))));
    }, () => {
      if (unmounted || token !== listToken) return;
      listStatus.textContent = t('gamesLoadFailed');
    });
  }

  // ---- detail ----
  const back = h('button', {
    type: 'button', class: 'btn btn--ghost btn--small', 'data-testid': 'games-back', onclick: () => ctx.navigate('/games'),
  }, t('gamesBack'));
  const detailStatus = h('p', { class: 'status-line', role: 'status' }, t('trackerLoading'));
  const title = h('h2', {});
  const meta = h('p', { class: 'help', 'data-testid': 'game-meta' });
  const score = h('p', { class: 'detail-score', 'data-testid': 'game-score' });
  const liveNote = h('div', { class: 'stack', 'data-testid': 'game-live-note' },
    h('p', { class: 'notice' }, t('gameLiveNote')),
    h('a', { class: 'btn btn--primary btn--small btn--fit', href: '#/live', 'data-testid': 'game-live-open' }, t('gameLiveOpen')));
  const reopen = h('button', {
    type: 'button', class: 'btn', 'data-testid': 'reopen-game', onclick: onReopen,
  }, t('reopenGame'));
  const reopenNote = h('p', { class: 'help', 'data-testid': 'reopen-note', hidden: true }, t('reopenBlocked'));
  const del = createConfirmButton({
    label: t('deleteGame'), testid: 'delete-game', className: 'btn--danger', onConfirm: onDelete,
  });
  // Opponent, date and season can be corrected after the game has started.
  const infoOpponent = h('input', {
    id: 'info-opponent', class: 'input', type: 'text', maxlength: 40, autocomplete: 'off', 'data-testid': 'info-opponent',
  });
  const infoDate = h('input', { id: 'info-date', class: 'input', type: 'date', 'data-testid': 'info-date' });
  const infoSeason = h('input', {
    id: 'info-season', class: 'input', type: 'text', inputmode: 'numeric', autocomplete: 'off', 'data-testid': 'info-season',
    oninput: () => { seasonTouched = true; },
  });
  // The season follows the date until it is edited by hand.
  infoDate.addEventListener('input', () => {
    if (!seasonTouched && infoDate.value) infoSeason.value = seasonFor(infoDate.value);
  });
  const infoError = h('p', { class: 'form-error', role: 'alert', 'data-testid': 'info-error', hidden: true });
  const infoSave = h('button', { type: 'submit', class: 'btn', 'data-testid': 'info-save' }, t('infoSave'));
  const infoForm = h('form', { class: 'info-form stack', novalidate: true, onsubmit: onSaveInfo },
    h('h3', {}, t('infoHeading')),
    h('div', { class: 'field' }, h('label', { for: 'info-opponent' }, t('opponentLabel')), infoOpponent),
    h('div', { class: 'field' }, h('label', { for: 'info-date' }, t('dateLabel')), infoDate),
    h('div', { class: 'field' }, h('label', { for: 'info-season' }, t('seasonLabel')), infoSeason),
    infoError, infoSave);
  const panel = createEventsPanel(ctx, root, { onEnded: () => ctx.navigate('/') });
  const detailBody = h('div', { class: 'stack', hidden: true },
    title, meta, score, liveNote,
    h('div', { class: 'detail-actions' }, reopen, del.el), reopenNote, infoForm, panel.el);
  const detailView = h('section', { class: 'game-detail' }, back, detailStatus, detailBody);

  root.append(listView, detailView);

  function startDetail(id) {
    unwatch?.();
    detailGame = undefined;
    detailMeta = null;
    infoFor = null;
    unwatch = ctx.watchGame(id, (game, snapshotMeta) => {
      if (unmounted || mode !== id) return;
      detailGame = game;
      detailMeta = snapshotMeta;
      renderDetail(ctx.getState());
    });
  }

  function stopDetail() {
    unwatch?.();
    unwatch = null;
    detailGame = undefined;
    del.disarm();
    panel.disarm();
  }

  function renderDetail(state) {
    if (typeof mode !== 'string' || mode === 'list') return;
    const game = detailGame;
    // A missing document that only the cache has answered for is still on its way.
    const loading = game === undefined || (game === null && detailMeta?.fromCache && state.online);
    detailStatus.hidden = !loading && game !== null;
    detailStatus.textContent = loading ? t('trackerLoading') : t('gameNotFound');
    detailBody.hidden = game === null || game === undefined;
    if (game === null || game === undefined) return;

    title.textContent = game.opponent;
    meta.textContent = `${formatDate(game.date)} · ${game.season}`;
    // Filled once per game; later snapshots must not overwrite what is being typed.
    if (infoFor !== game.id) {
      infoFor = game.id;
      seasonTouched = false;
      infoOpponent.value = game.opponent;
      infoDate.value = game.date;
      infoSeason.value = game.season;
      infoError.hidden = true;
    }
    for (const field of [infoOpponent, infoDate, infoSeason, infoSave]) field.disabled = !state.active;
    score.textContent = resultText(game);
    const live = game.status === 'live';
    liveNote.hidden = !live;
    const other = state.gameLoaded && state.game?.status === 'live' && state.game.id !== game.id;
    const blocked = !state.gameLoaded || other;
    reopen.hidden = live;
    reopen.disabled = !state.active || blocked || reopening === game.id;
    reopenNote.hidden = live || !other;
    del.el.disabled = !state.active;
    panel.update(game, state);
  }

  function onSaveInfo(event) {
    event.preventDefault();
    const game = detailGame;
    if (!game || !ctx.getState().active) return;
    const opponent = infoOpponent.value.trim();
    const date = infoDate.value;
    const season = infoSeason.value.trim();
    const problem = opponent === '' ? t('opponentRequired') : date === '' ? t('dateRequired')
      : !isValidSeason(season) ? t('seasonInvalid') : null;
    infoError.hidden = problem === null;
    infoError.textContent = problem ?? '';
    if (problem !== null) return;
    if (opponent === game.opponent && date === game.date && season === game.season) return;
    try {
      // Both the old and the new season change when a game moves between them; the same season
      // still lists the game's opponent and date in its results.
      recountAfter(ctx, [game.season, season], ctx.repo.updateGameInfo(game.id, { opponent, date, season }))
        .catch(ctx.onWriteError);
    } catch (err) {
      ctx.onWriteError(err);
    }
  }

  function onReopen() {
    const game = detailGame;
    if (!game || !ctx.getState().active) return;
    reopening = game.id;
    reopen.disabled = true;
    try {
      recountAfter(ctx, game.season, ctx.repo.reopenGame(game.id)).catch(err => {
        reopening = null;
        ctx.onWriteError(err);
        renderDetail(ctx.getState());
      });
    } catch (err) {
      reopening = null;
      ctx.onWriteError(err);
    }
  }

  function onDelete() {
    const game = detailGame;
    if (!game || !ctx.getState().active) return;
    try {
      // deleteGame reads from the server first, so it fails (and nothing changes) when offline.
      recountAfter(ctx, game.season, ctx.repo.deleteGame(game.id))
        .then(() => { if (!unmounted) ctx.navigate('/games'); }, ctx.onWriteError);
    } catch (err) {
      ctx.onWriteError(err);
    }
  }

  function update(state) {
    const id = parseRoute(state.route);
    const next = id ?? 'list';
    if (next !== mode) {
      if (mode !== null && mode !== 'list') stopDetail();
      mode = next;
      if (next === 'list') loadList();
      else startDetail(next);
    }
    listView.hidden = mode !== 'list';
    detailView.hidden = mode === 'list';
    if (mode === 'list') return;
    // Once the reopened game is the team's current game, the live screen can show it.
    if (reopening !== null && state.team?.currentGameId === reopening
      && state.game?.id === reopening && state.game.status === 'live') {
      reopening = null;
      ctx.navigate('/live');
      return;
    }
    renderDetail(state);
  }

  return {
    update,
    unmount() {
      unmounted = true;
      unwatch?.();
      del.destroy();
      panel.destroy();
      root.replaceChildren();
    },
  };
}
