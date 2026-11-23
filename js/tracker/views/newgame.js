import {
  assignCap, defaultSelection, isValidSeason, lineupFrom, seasonFor, todayIso, toggleSelected, validateLineup,
} from '../../model.js';
import * as model from '../../model.js';
import * as strings from '../../strings.js';
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
  // The competition fields exist only when repo, model and strings are all from this release.
  const competitionsOn = ctx.repo?.competitions === true && typeof model.competitionFields === 'function'
    && strings.hasString?.('competitionField') === true;
  const competitionSelect = competitionsOn ? h('select', {
    id: 'game-competition', class: 'input', 'data-testid': 'competition-select', onchange: onCompetitionChange,
  }, ...model.COMPETITIONS.map(value => h('option', { value }, strings.competitionLabel(value)))) : null;
  // The tournament and phase lists need this release's repo, model and strings together; otherwise the free-text form stays.
  const listsOn = competitionsOn && ctx.repo?.competitionLists === true && typeof model.listEntries === 'function'
    && typeof model.listOptions === 'function' && typeof model.listChoice === 'function' && model.LIST_NEW !== undefined
    && strings.hasString?.('phaseField') === true;
  let tournamentChoice = model.LIST_NEW; // an entry id or model.LIST_NEW; kept even when a snapshot removes the entry
  let phaseChoice = ''; // '', an entry id or model.LIST_NEW
  const names = new Map(); // entry id -> last name seen, for the "(removed)" option
  const tournamentSelect = listsOn ? h('select', {
    id: 'game-tournament', class: 'input', 'data-testid': 'tournament-select', 'aria-describedby': 'game-competition-error',
    onchange: () => { tournamentChoice = tournamentSelect.value; onCompetitionChange(); },
  }) : null;
  const tournamentNew = listsOn ? h('input', {
    id: 'game-tournament-new', class: 'input', type: 'text', maxlength: model.MAX_COMPETITION_NAME, autocomplete: 'off',
    'aria-describedby': 'game-competition-error', 'data-testid': 'tournament-new-name', oninput: onCompetitionChange,
  }) : null;
  const tournamentNewField = listsOn ? h('div', { class: 'field', hidden: true },
    h('label', { for: 'game-tournament-new' }, t('newTournamentName')), tournamentNew) : null;
  const tournamentField = listsOn ? h('div', { class: 'field', hidden: true },
    h('label', { for: 'game-tournament' }, t('tournamentField')), tournamentSelect) : null;
  const phaseSelect = listsOn ? h('select', {
    id: 'game-phase', class: 'input', 'data-testid': 'phase-select', 'aria-describedby': 'game-competition-error',
    onchange: () => { phaseChoice = phaseSelect.value; onCompetitionChange(); },
  }) : null;
  const phaseNew = listsOn ? h('input', {
    id: 'game-phase-new', class: 'input', type: 'text', maxlength: model.MAX_COMPETITION_NAME, autocomplete: 'off',
    'aria-describedby': 'game-competition-error', 'data-testid': 'phase-new-name', oninput: onCompetitionChange,
  }) : null;
  const phaseNewField = listsOn ? h('div', { class: 'field', hidden: true },
    h('label', { for: 'game-phase-new' }, t('newPhaseName')), phaseNew) : null;
  const phaseField = listsOn ? h('div', { class: 'field', hidden: true },
    h('label', { for: 'game-phase' }, t('phaseField')), phaseSelect) : null;
  const competitionName = competitionsOn && !listsOn ? h('input', {
    id: 'game-competition-name', class: 'input', type: 'text', maxlength: model.MAX_COMPETITION_NAME, autocomplete: 'off',
    'aria-describedby': 'game-competition-error', 'data-testid': 'competition-name-input', oninput: onCompetitionChange,
  }) : null;
  const competitionError = competitionsOn ? h('p', {
    id: 'game-competition-error', class: 'form-error', role: 'alert', 'data-testid': 'competition-error', hidden: true,
  }, t('competitionNameRequired')) : null;
  const competitionNameField = competitionsOn && !listsOn ? h('div', {
    class: 'field', 'data-testid': 'competition-name-field', hidden: true,
  }, h('label', { for: 'game-competition-name' }, t('competitionNameLabel')), competitionName, competitionError) : null;
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
      competitionsOn ? h('div', { class: 'field' }, h('label', { for: 'game-competition' }, t('competitionField')), competitionSelect) : null,
      competitionNameField,
      tournamentField, tournamentNewField, phaseField, phaseNewField,
      listsOn ? competitionError : null,
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
    if (detailsStep.hidden || !isValidSeason(season.value.trim()) || !renderCompetition()) return;
    choosingLineup = true;
    renderStep(ctx.getState());
    lineupHeading.focus();
  }

  function showDetails() {
    choosingLineup = false;
    renderStep(ctx.getState());
    next.focus();
  }

  // Lists as the team document has them now.
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

  // What the list fields say: { error, payload }. The payload is what createGame takes.
  function listsState() {
    const team = ctx.getState().team;
    return model.listChoice({
      competition: competitionSelect.value,
      tournamentChoice, tournamentNew: tournamentNew.value, phaseChoice, phaseNew: phaseNew.value,
      lists: { tournaments: team?.tournaments, phases: team?.phases },
    });
  }

  // Shows the fields the competition needs and the error while they are not valid; true when valid.
  function renderCompetition() {
    if (!competitionsOn) return true;
    if (listsOn) {
      const entries = currentEntries();
      const competition = competitionSelect.value;
      fillSelect(tournamentSelect, entries.tournaments, tournamentChoice, false);
      fillSelect(phaseSelect, entries.phases, phaseChoice, true);
      tournamentField.hidden = competition !== 'tournament';
      tournamentNewField.hidden = competition !== 'tournament' || tournamentChoice !== model.LIST_NEW;
      phaseField.hidden = competition !== 'league';
      phaseNewField.hidden = competition !== 'league' || phaseChoice !== model.LIST_NEW;
      const { error } = listsState();
      competitionError.hidden = error === null;
      competitionError.textContent = error === null ? '' : t(error);
      return error === null;
    }
    const tournament = competitionSelect.value === 'tournament';
    const valid = model.competitionFields(competitionSelect.value, competitionName.value) !== null;
    competitionNameField.hidden = !tournament;
    competitionError.hidden = valid;
    return valid;
  }

  function onCompetitionChange() {
    renderCompetition();
    if (selection !== null) renderRows();
  }

  // The fields createGame takes; nothing when this device does not offer them.
  function competitionPayload() {
    if (listsOn) return listsState().payload;
    return competitionsOn ? model.competitionFields(competitionSelect.value, competitionName.value) : {};
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
    const competitionOk = renderCompetition();
    next.disabled = !seasonOk || !competitionOk;
    // With the lists, Start re-checks the competition itself and returns to the details step when it no longer holds.
    start.disabled = starting || errors.length > 0 || !seasonOk || (!competitionOk && !listsOn) || !writable;
  }

  function init(state) {
    const previous = state.game ?? null;
    if (competitionsOn) {
      const { competition, competitionName: name, tournamentId, phaseId } = model.competitionOf?.(previous) ?? { competition: 'league' };
      competitionSelect.value = competition;
      if (listsOn) {
        const entries = currentEntries();
        tournamentChoice = entries.tournaments[0]?.id ?? model.LIST_NEW;
        if (competition === 'tournament') {
          const byName = name === undefined ? undefined : entries.tournaments.find(entry => model.sameListName(entry.name, name));
          // A linked id that left the list stays chosen and shows as "(removed)", so a new match needs a fresh choice.
          if (tournamentId !== undefined) {
            tournamentChoice = tournamentId;
            if (name !== undefined) names.set(tournamentId, name); // labels the "(removed)" option
          } else if (byName) {
            tournamentChoice = byName.id;
          } else if (name !== undefined) {
            // A legacy game whose name is not in the list: offer it as a new entry.
            tournamentChoice = model.LIST_NEW;
            tournamentNew.value = name;
          }
        }
        if (competition === 'league' && phaseId !== undefined) phaseChoice = phaseId;
      } else {
        competitionName.value = name ?? '';
      }
    }
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
    if (!renderCompetition()) {
      // The entry was removed after Next: show the details step, where the message is.
      showDetails();
      return;
    }
    starting = true;
    renderRows();
    try {
      const created = ctx.repo.createGame({
        opponent: opponent.value.trim() || t('opponentDefault'),
        date: date.value || todayIso(),
        season: season.value.trim(),
        lineup: lineupFrom(selection),
        roster: state.team?.roster ?? [],
        ...competitionPayload(),
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
