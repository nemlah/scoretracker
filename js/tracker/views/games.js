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

// model.js may be the previous release's, without parseGamesRoute: this fallback returns the same tagged
// shape with the same rules (one segment, decodable, a valid document id).
function fallbackParse(route) {
  const m = /^\/games(?:\/(.*))?$/.exec(route);
  if (m === null || m[1] === undefined || m[1] === '') return { kind: m === null ? 'invalid' : 'list' };
  if (m[1].includes('/')) return { kind: 'invalid' };
  let id;
  try { id = decodeURIComponent(m[1]); } catch { return { kind: 'invalid' }; }
  const valid = id !== '' && !id.includes('/') && id !== '.' && id !== '..'
    && !/^__.*__$/.test(id) && new TextEncoder().encode(id).length <= 1500;
  return valid ? { kind: 'detail', id } : { kind: 'invalid' };
}

const parseRoute = route => model.parseGamesRoute?.(route) ?? fallbackParse(route);
const sameMode = (a, b) => a !== null && a.kind === b.kind && a.id === b.id;

function gameRow(game, lists) {
  const events = game.events ?? [];
  const result = game.status === 'final' ? gameResult({ ...game, events }) : null;
  const outcome = resultOutcome(result);
  const score = result ?? deriveScore(events);
  const penalty = hasShootout(game.period, events) ? ` · ${t('resultPen', { us: score.soUs, them: score.soThem })}` : '';
  // strings.js may be the previous release's: no tag then.
  const tag = strings.competitionTag?.(game, lists) ?? null;
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
  let mode = null; // { kind: 'list' | 'detail' | 'invalid', id? }, never a bare string: a game id can be 'list'
  let listToken = 0;
  let unwatch = null;
  let detailGame; // undefined until the first snapshot, null once known to be missing
  let detailMeta = null;
  let reopening = null; // id of a game we asked to reopen and are waiting to see live
  let infoFor = null; // id of the game the details form was last filled from
  let seasonTouched = false;
  let competitionTouched = false; // set once either competition field has been edited by hand
  const entryInFlight = new Map(); // game id -> new entries ({ list, name }) of its saves that are not yet answered
  let autoRelink = false; // the competition fields hold the automatic legacy prefill, which follows the lists until a hand edit
  let competitionEdits = 0; // counts hand edits, so an acknowledged save can tell whether a newer edit started

  // The team document's lists, which name the tournaments and phases the games point at.
  const listsNow = () => {
    const team = ctx.getState().team;
    return { tournaments: team?.tournaments, phases: team?.phases };
  };
  const listsKey = () => JSON.stringify(listsNow());
  let loadedGames = null; // the past games shown in the list, kept to re-tag them when the lists change
  let shownListsKey = null;

  // ---- list ----
  const listStatus = h('p', { class: 'status-line', role: 'status' }, t('gamesLoading'));
  const listEmpty = h('p', { 'data-testid': 'games-empty', hidden: true }, t('gamesEmpty'));
  const listRows = h('ul', { class: 'game-list', 'data-testid': 'games-list' });
  // Only with a repo that pages; the previous repo.js lists everything at once and there is no button.
  const showMore = h('button', {
    type: 'button', class: 'btn btn--small', 'data-testid': 'games-more', hidden: true, onclick: () => loadMore(),
  }, strings.hasString?.('gamesShowMore') === true ? t('gamesShowMore') : 'Show more');
  const listView = h('section', { class: 'games' }, h('h2', {}, t('gamesHeading')), listStatus, listEmpty, listRows,
    h('div', { class: 'games-more' }, showMore));
  let cursor = null;
  let more = false;
  let pageLoading = false;
  let anyFromCache = false;
  let wasOnline = ctx.getState().online;

  function syncMore() {
    showMore.hidden = !more;
    showMore.disabled = pageLoading;
  }

  const PAGE = 20;
  // A page read from the cache while the device says it is online (the connection has just returned and
  // Firestore has not reconnected yet) is read again, quietly, a few times. The re-read asks for at least as
  // many rows as are shown, and it never overlaps a Show more: it waits for one in flight.
  const CACHED_RETRY_MS = 2000;
  const CACHED_RETRIES = 5;
  let retryTimer = null;
  let retries = 0;
  let refreshPending = false; // a re-read is waiting for the Show more in flight

  function scheduleRefresh() {
    if (!anyFromCache || ctx.getState().online === false || retries >= CACHED_RETRIES || retryTimer !== null) return;
    retries += 1;
    retryTimer = setTimeout(() => { retryTimer = null; refresh(); }, CACHED_RETRY_MS);
  }

  // A page-one answer replaces the list. One from the server settles the matter: no cached page is left, the
  // retry budget starts over and a pending retry is not needed.
  function takePage(result, shown) {
    cursor = result.cursor;
    more = result.more;
    anyFromCache = result.fromCache === true;
    if (!anyFromCache) {
      retries = 0;
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    loadedGames = shown;
    listStatus.hidden = true;
    listEmpty.hidden = shown.length > 0;
    renderRowsFromGames();
  }

  function loadList() {
    const token = listToken += 1;
    clearTimeout(retryTimer);
    retryTimer = null;
    retries = 0;
    refreshPending = false;
    listStatus.hidden = false;
    listStatus.textContent = t('gamesLoading');
    listEmpty.hidden = true;
    listRows.replaceChildren();
    loadedGames = null;
    cursor = null;
    more = false;
    anyFromCache = false;
    pageLoading = true;
    syncMore();
    const paged = typeof ctx.repo.listGamesPage === 'function';
    Promise.resolve(paged ? ctx.repo.listGamesPage() : ctx.repo.listGames()).then(result => {
      if (unmounted || token !== listToken) return;
      pageLoading = false;
      if (paged) takePage(result, result.games);
      else takePage({ cursor: null, more: false, fromCache: false }, result);
      syncMore();
      scheduleRefresh();
    }, () => {
      if (unmounted || token !== listToken) return;
      pageLoading = false;
      listStatus.textContent = t('gamesLoadFailed');
      syncMore();
    });
  }

  // The answer of a re-read for the rows shown: cut after the last of the previously shown games that it holds
  // (a game that was edited can have moved), so everything shown stays and a game that arrived on top pushes
  // nothing out of view. If none of them is in it, as many rows as were shown.
  function trimmed(result, shownCount, shownIds) {
    const games = result.games;
    const snapshots = result.snapshots ?? [];
    let at = -1;
    games.forEach((game, index) => { if (shownIds.has(game.id)) at = index; });
    const count = at >= 0 ? at + 1 : Math.min(games.length, Math.max(PAGE, shownCount));
    if (count === games.length || snapshots[count - 1] === undefined) return result;
    return { ...result, games: games.slice(0, count), cursor: snapshots[count - 1], more: true };
  }

  // Reads page one again with room for every row shown, replacing the list. The rows stay on screen until it answers.
  function refresh() {
    if (unmounted || mode?.kind !== 'list' || loadedGames === null) return;
    clearTimeout(retryTimer);
    retryTimer = null;
    if (pageLoading) {
      refreshPending = true;
      return;
    }
    const token = listToken += 1;
    const shownCount = loadedGames.length;
    const shownIds = new Set(loadedGames.map(game => game.id));
    pageLoading = true;
    syncMore();
    Promise.resolve(ctx.repo.listGamesPage({ pageSize: shownCount + PAGE })).then(result => {
      if (unmounted || token !== listToken) return;
      pageLoading = false;
      const kept = trimmed(result, shownCount, shownIds);
      takePage(kept, kept.games);
      syncMore();
      if (refreshPending) {
        refreshPending = false;
        refresh();
      } else {
        scheduleRefresh();
      }
    }, () => {
      if (unmounted || token !== listToken) return;
      pageLoading = false;
      syncMore();
      refreshPending = false;
      scheduleRefresh(); // the cache answer is still what is shown
    });
  }

  function loadMore() {
    if (pageLoading || !more || loadedGames === null) return;
    const token = listToken;
    pageLoading = true;
    syncMore();
    Promise.resolve(ctx.repo.listGamesPage({ after: cursor })).then(result => {
      if (unmounted || token !== listToken) return;
      pageLoading = false;
      cursor = result.cursor;
      more = result.more;
      anyFromCache ||= result.fromCache === true;
      if (result.fromCache !== true) {
        // A server answer starts the retry budget over and a pending retry is not needed.
        retries = 0;
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      loadedGames = [...loadedGames, ...result.games];
      renderRowsFromGames();
      syncMore();
      // A page that came from the cache while online, or a re-read that waited for this one, is read from page one.
      if (refreshPending) {
        refreshPending = false;
        refresh();
      } else {
        scheduleRefresh();
      }
    }, () => {
      if (unmounted || token !== listToken) return;
      pageLoading = false;
      syncMore();
      if (refreshPending) {
        refreshPending = false;
        refresh();
      }
    });
  }

  function renderRowsFromGames() {
    shownListsKey = listsKey();
    const lists = listsNow();
    listRows.replaceChildren(...loadedGames.map(game => gameRow(game, lists)));
  }

  // ---- detail ----
  const back = h('button', {
    type: 'button', class: 'btn btn--ghost btn--small', 'data-testid': 'games-back', onclick: () => ctx.navigate('/games'),
  }, t('gamesBack'));
  const detailStatus = h('p', { class: 'status-line', role: 'status' }, t('trackerLoading'));
  const title = h('h2', { class: 'detail-team game-opponent', lang: 'el' });
  const meta = h('p', { class: 'help game-meta', 'data-testid': 'game-meta' });
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
  // The tournament and phase lists need this release's repo, model and strings together; otherwise the free-text form stays.
  const listsOn = competitionsOn && ctx.repo?.competitionLists === true && typeof model.listEntries === 'function'
    && typeof model.listOptions === 'function' && typeof model.listChoice === 'function' && model.LIST_NEW !== undefined
    && strings.hasString?.('phaseField') === true;
  let tournamentChoice = model.LIST_NEW; // an entry id or model.LIST_NEW; kept even when a snapshot removes the entry
  let phaseChoice = ''; // '', an entry id or model.LIST_NEW
  const names = new Map(); // entry id -> last name seen, for the "(removed)" option
  const infoTournament = listsOn ? h('select', {
    id: 'info-tournament', class: 'input', 'data-testid': 'info-tournament',
    onchange: () => { tournamentChoice = infoTournament.value; onCompetitionInput(); },
  }) : null;
  const infoTournamentNew = listsOn ? h('input', {
    id: 'info-tournament-new', class: 'input', type: 'text', maxlength: model.MAX_COMPETITION_NAME, autocomplete: 'off',
    'data-testid': 'info-tournament-new-name', oninput: onCompetitionInput,
  }) : null;
  const infoTournamentNewField = listsOn ? h('div', { class: 'field', hidden: true },
    h('label', { for: 'info-tournament-new' }, t('newTournamentName')), infoTournamentNew) : null;
  const infoTournamentField = listsOn ? h('div', { class: 'field', hidden: true },
    h('label', { for: 'info-tournament' }, t('tournamentField')), infoTournament) : null;
  const infoPhase = listsOn ? h('select', {
    id: 'info-phase', class: 'input', 'data-testid': 'info-phase',
    onchange: () => { phaseChoice = infoPhase.value; onCompetitionInput(); },
  }) : null;
  const infoPhaseNew = listsOn ? h('input', {
    id: 'info-phase-new', class: 'input', type: 'text', maxlength: model.MAX_COMPETITION_NAME, autocomplete: 'off',
    'data-testid': 'info-phase-new-name', oninput: onCompetitionInput,
  }) : null;
  const infoPhaseNewField = listsOn ? h('div', { class: 'field', hidden: true },
    h('label', { for: 'info-phase-new' }, t('newPhaseName')), infoPhaseNew) : null;
  const infoPhaseField = listsOn ? h('div', { class: 'field', hidden: true },
    h('label', { for: 'info-phase' }, t('phaseField')), infoPhase) : null;
  const infoCompetitionName = competitionsOn && !listsOn ? h('input', {
    id: 'info-competition-name', class: 'input', type: 'text', maxlength: model.MAX_COMPETITION_NAME, autocomplete: 'off',
    'data-testid': 'info-competition-name', oninput: onCompetitionInput,
  }) : null;
  const infoCompetitionNameField = competitionsOn && !listsOn ? h('div', {
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
    infoCompetitionNameField, infoTournamentField, infoTournamentNewField, infoPhaseField, infoPhaseNewField,
    infoError, infoSave);
  const panel = createEventsPanel(ctx, root, { onEnded: () => ctx.navigate('/') });
  const detailBody = h('div', { class: 'stack detail-body', hidden: true },
    score, h('div', { class: 'detail-card' }, panel.el),
    infoForm,
    h('div', { class: 'stack detail-card' }, liveNote,
      h('div', { class: 'detail-actions' }, reopen, del.el), reopenNote));
  const detailView = h('section', { class: 'game-detail game-detail--board' }, back, detailStatus, detailBody);

  root.append(listView, detailView);

  function currentEntries() {
    const team = ctx.getState().team;
    return { tournaments: model.listEntries(team?.tournaments), phases: model.listEntries(team?.phases) };
  }

  // Rebuilds a select's options when they changed. A chosen id that is no longer in the list stays, marked "(removed)".
  function fillSelect(select, entries, choice, withNone) {
    for (const entry of entries) names.set(entry.id, entry.name);
    const labels = { none: () => t('noPhase'), new: () => t('addNewEntry') };
    const options = model.listOptions(entries, choice, { withNone }).map(option => ({
      value: option.value,
      text: option.kind === 'entry' ? option.name
        : option.kind === 'removed' ? `${names.get(option.value) ?? ''} ${t('listOptionRemoved')}`.trim() : labels[option.kind](),
    }));
    const key = JSON.stringify(options);
    if (select.dataset.options !== key) {
      select.dataset.options = key;
      select.replaceChildren(...options.map(({ value, text }) => h('option', { value }, text)));
    }
    select.value = choice;
  }

  // Shows the fields the selected competition needs, with the options of the current lists.
  function renderListFields() {
    const entries = currentEntries();
    const competition = infoCompetition.value;
    fillSelect(infoTournament, entries.tournaments, tournamentChoice, false);
    fillSelect(infoPhase, entries.phases, phaseChoice, true);
    infoTournamentField.hidden = competition !== 'tournament';
    infoTournamentNewField.hidden = competition !== 'tournament' || tournamentChoice !== model.LIST_NEW;
    infoPhaseField.hidden = competition !== 'league';
    infoPhaseNewField.hidden = competition !== 'league' || phaseChoice !== model.LIST_NEW;
  }

  // What the list fields say: { error, payload }. The payload is what updateGameInfo takes; "No phase" is an explicit null.
  function listsState() {
    const team = ctx.getState().team;
    return model.listChoice({
      competition: infoCompetition.value,
      tournamentChoice, tournamentNew: infoTournamentNew.value, phaseChoice, phaseNew: infoPhaseNew.value,
      lists: { tournaments: team?.tournaments, phases: team?.phases }, nullPhase: true,
    });
  }

  // Follows the stored game. Returns true when it preselected a link the game does not have yet.
  function showCompetition(game) {
    const fields = model.competitionOf(game);
    infoCompetition.value = fields.competition;
    if (!listsOn) {
      infoCompetitionName.value = fields.competitionName ?? '';
      infoCompetitionNameField.hidden = fields.competition !== 'tournament';
      return false;
    }
    const entries = currentEntries();
    let relink = false;
    tournamentChoice = entries.tournaments[0]?.id ?? model.LIST_NEW;
    infoTournamentNew.value = '';
    phaseChoice = fields.phaseId ?? '';
    infoPhaseNew.value = '';
    if (fields.tournamentId !== undefined) {
      tournamentChoice = fields.tournamentId;
      if (fields.competitionName !== undefined) names.set(fields.tournamentId, fields.competitionName);
    } else if (fields.competitionName !== undefined) {
      // A legacy game: its name picks the same-named entry, else "Add new…" with the name filled in.
      const match = entries.tournaments.find(entry => model.sameListName(entry.name, fields.competitionName));
      tournamentChoice = match ? match.id : model.LIST_NEW;
      if (!match) infoTournamentNew.value = fields.competitionName;
      relink = true;
    }
    renderListFields();
    return relink;
  }

  function onCompetitionInput() {
    competitionTouched = true;
    autoRelink = false;
    competitionEdits += 1;
    if (listsOn) renderListFields();
    else infoCompetitionNameField.hidden = infoCompetition.value !== 'tournament';
  }

  const inDetail = id => mode?.kind === 'detail' && mode.id === id;

  function startDetail(id) {
    unwatch?.();
    detailGame = undefined;
    detailMeta = null;
    infoFor = null;
    unwatch = ctx.watchGame(id, (game, snapshotMeta) => {
      if (unmounted || !inDetail(id)) return;
      detailGame = game;
      detailMeta = snapshotMeta;
      renderDetail(ctx.getState());
    });
  }

  // A route that could not name a game: nothing is subscribed, and the detail view says the game is unavailable.
  function showInvalid() {
    detailGame = null;
    detailMeta = null;
    infoFor = null;
  }

  function stopDetail() {
    unwatch?.();
    unwatch = null;
    detailGame = undefined;
    del.disarm();
    panel.disarm();
  }

  function renderDetail(state) {
    if (mode?.kind === 'list') return;
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
    const tag = strings.competitionTag?.(game, listsNow())
      ?? (strings.hasString?.('competitionLeague') ? t('competitionLeague') : null);
    meta.textContent = `${dateText} · ${game.season}${tag ? ` · ${tag}` : ''}`;
    // Filled once per game; later snapshots must not overwrite what is being typed.
    if (infoFor !== game.id) {
      infoFor = game.id;
      seasonTouched = false;
      competitionTouched = false;
      autoRelink = false;
      infoOpponent.value = game.opponent;
      infoDate.value = game.date;
      infoSeason.value = game.season;
      infoError.hidden = true;
    }
    // Until a competition field is edited, the form follows the stored game.
    if (competitionsOn && (!competitionTouched || autoRelink)) {
      // A legacy tournament link is preselected as a pending edit, so any Save writes it. It is resolved
      // again as the lists change (the team snapshot can arrive after the game) until a hand edit.
      autoRelink = showCompetition(game);
      competitionTouched = autoRelink;
    } else if (listsOn) {
      renderListFields();
    }
    // state.writable is newer than state.active: a cached app.js from the previous release lacks it.
    const writable = state.writable ?? state.active;
    for (const field of [infoOpponent, infoDate, infoSeason, infoCompetition, infoCompetitionName, infoTournament, infoTournamentNew,
      infoPhase, infoPhaseNew, infoSave]) {
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

  // Once a competition edit is saved the form follows the stored game again, so a later remote re-tag shows up
  // and an opponent-only save cannot send the stale value back. Not when another game is open or a newer edit started.
  function releaseCompetition(id, edits) {
    if (unmounted || !inDetail(id) || infoFor !== id || competitionEdits !== edits) return;
    competitionTouched = false;
    autoRelink = false;
    renderDetail(ctx.getState());
  }

  function onSaveInfo(event) {
    event.preventDefault();
    const game = detailGame;
    if (!game || !ctx.getState().active) return;
    const opponent = infoOpponent.value.trim();
    const date = infoDate.value;
    const season = infoSeason.value.trim();
    const stored = competitionsOn ? model.competitionOf(game) : null;
    // With the lists, the form's selection is always resolved against the current lists, edited or not.
    const listed = listsOn ? listsState() : null;
    const edited = !competitionsOn || !competitionTouched ? undefined
      : listsOn ? listed.payload : model.competitionFields(infoCompetition.value, infoCompetitionName.value);
    const problem = opponent === '' ? t('opponentRequired') : date === '' ? t('dateRequired')
      : !isValidSeason(season) ? t('seasonInvalid') : listed?.error ? t(listed.error)
        : edited === null ? t('competitionNameRequired') : null;
    infoError.hidden = problem === null;
    infoError.textContent = problem ?? '';
    if (problem !== null) return;
    // Only an edited competition that differs from the stored one is sent.
    const competitionChanged = edited !== undefined && edited !== null
      && (edited.competition !== stored.competition || edited.competitionName !== stored.competitionName
        || (listsOn && (edited.newEntry !== undefined || edited.tournamentId !== stored.tournamentId
          || (edited.phaseId ?? null) !== (stored.phaseId ?? null))));
    if (opponent === game.opponent && date === game.date && season === game.season && !competitionChanged) {
      // Nothing to send: a competition edited back to the stored value must not keep the form from following the game.
      if (competitionTouched) releaseCompetition(game.id, competitionEdits);
      return;
    }
    // A repeat of a new entry that is still unanswered would add it again under another id; an edited draft goes through.
    const pendingEntry = competitionChanged && edited.newEntry !== undefined ? { ...edited.newEntry } : null;
    const pending = entryInFlight.get(game.id) ?? [];
    if (pendingEntry && pending.some(entry => entry.list === pendingEntry.list && model.sameListName(entry.name, pendingEntry.name))) return;
    const sentEdits = competitionEdits;
    const settle = () => {
      if (!pendingEntry) return;
      const rest = (entryInFlight.get(game.id) ?? []).filter(entry => entry !== pendingEntry);
      if (rest.length > 0) entryInFlight.set(game.id, rest); else entryInFlight.delete(game.id);
    };
    if (pendingEntry) entryInFlight.set(game.id, [...pending, pendingEntry]);
    try {
      // Both the old and the new season change when a game moves between them; the same season
      // still lists the game's opponent and date in its results.
      recountAfter(ctx, [game.season, season], ctx.repo.updateGameInfo(game.id, { opponent, date, season, ...(competitionChanged ? edited : {}) }))
        .then(() => { settle(); if (competitionTouched) releaseCompetition(game.id, sentEdits); },
          err => { settle(); ctx.onWriteError(err); });
    } catch (err) {
      settle();
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
    const next = parseRoute(state.route);
    if (!sameMode(mode, next)) {
      if (mode !== null && mode.kind !== 'list') stopDetail();
      mode = next;
      if (next.kind === 'list') loadList();
      else if (next.kind === 'detail') startDetail(next.id);
      else showInvalid();
    }
    const online = state.online !== false;
    // A list whose pages came from the cache while offline is read again from page one once back online.
    const reload = mode.kind === 'list' && wasOnline === false && online && anyFromCache;
    wasOnline = online ? true : false;
    listView.hidden = mode.kind !== 'list';
    detailView.hidden = mode.kind === 'list';
    if (mode.kind === 'list') {
      if (reload) {
        retries = 0;
        refresh();
      }
      // A rename or a new entry re-tags the loaded rows without reloading the games.
      else if (loadedGames !== null && listsKey() !== shownListsKey) renderRowsFromGames();
      return;
    }
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
      clearTimeout(retryTimer);
      unwatch?.();
      del.destroy();
      panel.destroy();
      root.replaceChildren();
    },
  };
}
