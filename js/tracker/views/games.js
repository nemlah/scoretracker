import { team } from '../../config.js';
import {
  deriveScore, formatDate, gameResult, hasShootout, isValidSeason, resultOutcome, seasonFor,
} from '../../model.js';
import * as model from '../../model.js';
import * as strings from '../../strings.js';
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

function gameRow(game) {
  const events = game.events ?? [];
  const result = game.status === 'final' ? gameResult({ ...game, events }) : null;
  const outcome = resultOutcome(result);
  const score = result ?? deriveScore(events);
  const penalty = hasShootout(game.period, events) ? ` · ${t('resultPen', { us: score.soUs, them: score.soThem })}` : '';
  // strings.js may be the previous release's: no tag then.
  const tag = strings.competitionTag?.(game) ?? null;
  const chip = game.status === 'live'
    ? h('span', { class: 'game-chip game-live', 'data-testid': 'game-chip' }, t('gameLiveBadge').toUpperCase())
    : outcome && h('span', {
      class: 'game-chip', 'data-outcome': outcome, 'data-testid': 'game-chip',
      'aria-label': t(outcome === 'D' ? 'resultNameD' : `gameOutcome${outcome}`),
    }, t(`result${outcome}`));
  return h('li', {}, h('a', {
    class: 'game-row game-row--board', href: `#/games/${encodeURIComponent(game.id)}`, 'data-testid': 'game-row',
    'aria-label': t('gameOpenFor', { opponent: game.opponent }),
  }, chip, h('span', { class: 'game-row-label' },
    h('span', { class: 'game-opponent' }, game.opponent),
    h('span', { class: 'game-date' }, formatDate(game.date) + (tag ? ` · ${tag}` : '') + penalty)),
  h('span', { class: 'game-score' }, scoreText(score, false).main),
  h('span', { class: 'tracker-chevron', 'aria-hidden': 'true' })));
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
  let competitionTouched = false; // set once either competition field has been edited by hand

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
      listRows.replaceChildren(...games.map(gameRow));
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
  const title = h('h2', { class: 'detail-team game-opponent', lang: 'el' });
  const meta = h('p', { class: 'help', 'data-testid': 'game-meta' });
  const badge = h('span', { class: 'tracker-badge' });
  const date = h('span', { class: 'tracker-board-date' });
  const ours = h('span', { class: 'detail-figure' });
  const theirs = h('span', { class: 'detail-figure' });
  const penalty = h('p', { class: 'detail-penalty', hidden: true });
  const crest = team.crest ? h('img', { class: 'detail-crest', src: team.crest, width: 40, height: 40, alt: '' }) : null;
  const score = h('section', {
    class: 'tracker-scoreboard detail-board', 'aria-label': t('gameScoreboard'), 'data-testid': 'game-score',
  },
  h('div', { class: 'tracker-board-head' }, badge, date),
  h('div', { class: 'detail-score detail-score-rows' },
    h('div', { class: 'detail-score-row', 'data-testid': 'game-score-row' },
      h('span', { class: 'detail-club' }, h('span', { class: 'detail-team game-opponent' }, team.name), crest), ours),
    h('div', { class: 'detail-score-row', 'data-testid': 'game-score-row' }, title, theirs)),
  penalty);
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
  // The competition fields exist only when repo, model and strings are all from this release.
  const competitionsOn = ctx.repo?.competitions === true && typeof model.competitionFields === 'function'
    && strings.hasString?.('competitionField') === true;
  const infoCompetition = competitionsOn ? h('select', {
    id: 'info-competition', class: 'input', 'data-testid': 'info-competition', onchange: onCompetitionInput,
  }, ...model.COMPETITIONS.map(value => h('option', { value }, strings.competitionLabel(value)))) : null;
  const infoCompetitionName = competitionsOn ? h('input', {
    id: 'info-competition-name', class: 'input', type: 'text', maxlength: model.MAX_COMPETITION_NAME, autocomplete: 'off',
    'data-testid': 'info-competition-name', oninput: onCompetitionInput,
  }) : null;
  const infoCompetitionNameField = competitionsOn ? h('div', {
    class: 'field', 'data-testid': 'info-competition-name-field', hidden: true,
  }, h('label', { for: 'info-competition-name' }, t('competitionNameLabel')), infoCompetitionName) : null;
  const infoError = h('p', { class: 'form-error', role: 'alert', 'data-testid': 'info-error', hidden: true });
  const infoSave = h('button', { type: 'submit', class: 'btn', 'data-testid': 'info-save' }, t('infoSave'));
  const infoForm = h('form', { class: 'info-form stack', novalidate: true, onsubmit: onSaveInfo },
    h('h3', {}, t('infoHeading')), meta,
    h('div', { class: 'field' }, h('label', { for: 'info-opponent' }, t('opponentLabel')), infoOpponent),
    h('div', { class: 'field' }, h('label', { for: 'info-date' }, t('dateLabel')), infoDate),
    h('div', { class: 'field' }, h('label', { for: 'info-season' }, t('seasonLabel')), infoSeason),
    competitionsOn ? h('div', { class: 'field' }, h('label', { for: 'info-competition' }, t('competitionField')), infoCompetition) : null,
    infoCompetitionNameField,
    infoError, infoSave);
  const panel = createEventsPanel(ctx, root, { onEnded: () => ctx.navigate('/') });
  const detailBody = h('div', { class: 'stack detail-body', hidden: true },
    score, h('div', { class: 'detail-card' }, panel.el),
    infoForm,
    h('div', { class: 'stack detail-card' }, liveNote,
      h('div', { class: 'detail-actions' }, reopen, del.el), reopenNote));
  const detailView = h('section', { class: 'game-detail game-detail--board' }, back, detailStatus, detailBody);

  root.append(listView, detailView);

  function showCompetition(fields) {
    infoCompetition.value = fields.competition;
    infoCompetitionName.value = fields.competitionName ?? '';
    infoCompetitionNameField.hidden = fields.competition !== 'tournament';
  }

  function onCompetitionInput() {
    competitionTouched = true;
    infoCompetitionNameField.hidden = infoCompetition.value !== 'tournament';
  }

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
    const dateText = formatDate(game.date);
    date.textContent = dateText;
    const tag = strings.competitionTag?.(game)
      ?? (strings.hasString?.('competitionLeague') ? t('competitionLeague') : null);
    meta.textContent = `${dateText} · ${game.season}${tag ? ` · ${tag}` : ''}`;
    // Filled once per game; later snapshots must not overwrite what is being typed.
    if (infoFor !== game.id) {
      infoFor = game.id;
      seasonTouched = false;
      competitionTouched = false;
      infoOpponent.value = game.opponent;
      infoDate.value = game.date;
      infoSeason.value = game.season;
      infoError.hidden = true;
    }
    // Until a competition field is edited, the form follows the stored game.
    if (competitionsOn && !competitionTouched) showCompetition(model.competitionOf(game));
    // state.writable is newer than state.active: a cached app.js from the previous release lacks it.
    const writable = state.writable ?? state.active;
    for (const field of [infoOpponent, infoDate, infoSeason, infoCompetition, infoCompetitionName, infoSave]) {
      if (field) field.disabled = !writable;
    }
    const events = game.events ?? [];
    const figures = deriveScore(events);
    ours.textContent = figures.us;
    theirs.textContent = figures.them;
    const shootout = scoreText(figures, hasShootout(game.period, events)).shootout;
    penalty.textContent = shootout ?? '';
    penalty.hidden = shootout === null;
    const live = game.status === 'live';
    badge.textContent = t(live ? 'gameLiveBadge' : 'final').toUpperCase();
    badge.classList.toggle('tracker-badge--live', live);
    liveNote.hidden = !live;
    const other = state.gameLoaded && state.game?.status === 'live' && state.game.id !== game.id;
    const blocked = !state.gameLoaded || other;
    reopen.hidden = live;
    reopen.disabled = !writable || blocked || reopening === game.id;
    reopenNote.hidden = live || !other;
    del.el.disabled = !writable;
    panel.update(game, state);
  }

  function onSaveInfo(event) {
    event.preventDefault();
    const game = detailGame;
    if (!game || !ctx.getState().active) return;
    const opponent = infoOpponent.value.trim();
    const date = infoDate.value;
    const season = infoSeason.value.trim();
    const stored = competitionsOn ? model.competitionOf(game) : null;
    const edited = competitionsOn && competitionTouched
      ? model.competitionFields(infoCompetition.value, infoCompetitionName.value) : undefined;
    const problem = opponent === '' ? t('opponentRequired') : date === '' ? t('dateRequired')
      : !isValidSeason(season) ? t('seasonInvalid') : edited === null ? t('competitionNameRequired') : null;
    infoError.hidden = problem === null;
    infoError.textContent = problem ?? '';
    if (problem !== null) return;
    // Only an edited competition that differs from the stored one is sent.
    const competitionChanged = edited !== undefined && edited !== null
      && (edited.competition !== stored.competition || edited.competitionName !== stored.competitionName);
    if (opponent === game.opponent && date === game.date && season === game.season && !competitionChanged) return;
    try {
      // Both the old and the new season change when a game moves between them; the same season
      // still lists the game's opponent and date in its results.
      recountAfter(ctx, [game.season, season], ctx.repo.updateGameInfo(game.id, { opponent, date, season, ...(competitionChanged ? edited : {}) }))
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
