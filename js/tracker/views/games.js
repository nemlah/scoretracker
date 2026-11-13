import { deriveScore, formatDate, hasShootout } from '../../model.js';
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
  const panel = createEventsPanel(ctx, root, { onEnded: () => ctx.navigate('/') });
  const detailBody = h('div', { class: 'stack', hidden: true },
    title, meta, score, liveNote,
    h('div', { class: 'detail-actions' }, reopen, del.el), reopenNote, panel.el);
  const detailView = h('section', { class: 'game-detail' }, back, detailStatus, detailBody);

  root.append(listView, detailView);

  function startDetail(id) {
    unwatch?.();
    detailGame = undefined;
    detailMeta = null;
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
    meta.textContent = formatDate(game.date);
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
