import { t } from '../../strings.js';
import { clear, h } from '../../ui/dom.js';

const MAX_NAME = 40;

export const byCapThenName = (a, b) => a.cap - b.cap || a.name.localeCompare(b.name);

// Returns { name, cap } or { error } for raw form input.
export function validatePlayer(rawName, rawCap) {
  const name = rawName.trim();
  if (!name) return { error: t('rosterNameRequired') };
  const text = rawCap.trim();
  const cap = /^\d{1,3}$/.test(text) ? Number(text) : NaN;
  if (!(cap >= 1 && cap <= 99)) return { error: t('rosterCapRange') };
  return { name, cap };
}

const sameRoster = (a, b) => a.length === b.length && a.every((p, i) =>
  p.id === b[i].id && p.name === b[i].name && p.cap === b[i].cap && p.archived === b[i].archived);

export function mount(root, ctx) {
  let editingId = null;
  // Roster we have just written but the team snapshot has not reflected yet, so quick
  // successive edits build on each other instead of on a stale snapshot.
  let optimistic = null;

  const currentRoster = () => optimistic ?? ctx.getState().team?.roster ?? [];

  async function save(next) {
    optimistic = next;
    try {
      await ctx.repo.saveRoster(next);
    } catch (err) {
      if (optimistic === next) optimistic = null;
      // Show the authoritative roster again, not the rows we only hoped to save.
      renderList();
      ctx.onWriteError(err);
    }
  }

  function change(id, patch) {
    save(currentRoster().map(player => (player.id === id ? { ...player, ...patch } : player)));
    renderList();
  }

  // Add form: built once and never re-rendered, so focus survives snapshots.
  const nameInput = h('input', {
    id: 'roster-name', class: 'input', type: 'text', maxlength: MAX_NAME, autocomplete: 'off',
    'data-write': true, 'data-testid': 'roster-add-name', oninput: () => hideError(),
  });
  const capInput = h('input', {
    id: 'roster-cap', class: 'input input--cap', type: 'text', inputmode: 'numeric', maxlength: 3, autocomplete: 'off',
    'data-write': true, 'data-testid': 'roster-add-cap', oninput: () => hideError(),
  });
  const addError = h('p', { class: 'form-error', role: 'alert', 'data-testid': 'roster-error', hidden: true });
  const hideError = () => { addError.hidden = true; };
  const form = h('form', { class: 'add-form', novalidate: true, onsubmit: add },
    h('div', { class: 'field field--grow' }, h('label', { for: 'roster-name' }, t('rosterNameLabel')), nameInput),
    h('div', { class: 'field' }, h('label', { for: 'roster-cap' }, t('rosterCapLabel')), capInput),
    h('button', { type: 'submit', class: 'btn btn--primary', 'data-write': true, 'data-testid': 'roster-add-btn' }, t('rosterAdd')),
  );

  function add(event) {
    event.preventDefault();
    const result = validatePlayer(nameInput.value, capInput.value);
    if (result.error) {
      addError.textContent = result.error;
      addError.hidden = false;
      return;
    }
    hideError();
    save([...currentRoster(), { id: crypto.randomUUID(), name: result.name, cap: result.cap, archived: false }]);
    nameInput.value = '';
    capInput.value = '';
    nameInput.focus();
    renderList();
  }

  const list = h('ul', { class: 'roster-list', 'data-testid': 'roster-list' });
  const empty = h('p', { class: 'help', 'data-testid': 'roster-empty' }, t('rosterEmpty'));
  const archivedSummary = h('summary', {});
  const archivedList = h('ul', { class: 'roster-list' });
  const archived = h('details', { class: 'archived', 'data-testid': 'roster-archived', hidden: true },
    archivedSummary, archivedList);

  root.append(h('section', { class: 'roster' },
    h('h2', {}, t('rosterHeading')), form, addError, empty, list, archived));

  function row(player, isArchived) {
    const action = isArchived
      ? h('button', {
        type: 'button', class: 'btn btn--small', 'data-write': true, 'data-testid': 'roster-unarchive',
        'aria-label': t('rosterUnarchiveFor', { name: player.name }),
        onclick: () => change(player.id, { archived: false }),
      }, t('rosterUnarchive'))
      : h('button', {
        type: 'button', class: 'btn btn--small', 'data-write': true, 'data-testid': 'roster-archive',
        'aria-label': t('rosterArchiveFor', { name: player.name }),
        onclick: () => change(player.id, { archived: true }),
      }, t('rosterArchive'));
    const edit = h('button', {
      type: 'button', class: 'btn btn--small', 'data-write': true, 'data-testid': 'roster-edit',
      'aria-label': t('rosterEditFor', { name: player.name }),
      onclick: () => { editingId = player.id; renderList(); list.querySelector('[data-testid="roster-edit-name"]')?.focus(); },
    }, t('rosterEdit'));
    return h('li', { class: 'roster-row', 'data-testid': 'roster-row', 'data-player-id': player.id },
      h('span', { class: isArchived ? 'cap cap--out' : 'cap' }, player.cap),
      h('span', { class: 'roster-name' }, player.name),
      // Archived players can only be unarchived; editing happens once they are back on the roster.
      h('span', { class: 'row-actions' }, isArchived ? null : edit, action));
  }

  function editRow(player) {
    const name = h('input', {
      class: 'input', type: 'text', maxlength: MAX_NAME, value: player.name, 'aria-label': t('rosterNameLabel'),
      'data-write': true, 'data-testid': 'roster-edit-name',
    });
    const cap = h('input', {
      class: 'input input--cap', type: 'text', inputmode: 'numeric', maxlength: 3, value: String(player.cap),
      'aria-label': t('rosterCapLabel'), 'data-write': true, 'data-testid': 'roster-edit-cap',
    });
    const error = h('p', { class: 'form-error', role: 'alert', hidden: true, 'data-testid': 'roster-edit-error' });
    const finish = () => { editingId = null; renderList(); };
    const submit = event => {
      event.preventDefault();
      const result = validatePlayer(name.value, cap.value);
      if (result.error) {
        error.textContent = result.error;
        error.hidden = false;
        return;
      }
      editingId = null;
      change(player.id, { name: result.name, cap: result.cap });
    };
    return h('li', { class: 'roster-row roster-row--editing', 'data-testid': 'roster-row', 'data-player-id': player.id },
      h('form', { class: 'edit-form', novalidate: true, onsubmit: submit },
        name, cap,
        h('button', { type: 'submit', class: 'btn btn--primary btn--small', 'data-write': true, 'data-testid': 'roster-save' }, t('rosterSave')),
        h('button', { type: 'button', class: 'btn btn--small', 'data-testid': 'roster-cancel', onclick: finish }, t('rosterCancel')),
        error));
  }

  function renderList() {
    const players = currentRoster();
    const fill = (target, group, isArchived) => {
      clear(target);
      for (const player of [...group].sort(byCapThenName)) {
        target.append(editingId === player.id && !isArchived ? editRow(player) : row(player, isArchived));
      }
    };
    const live = players.filter(player => !player.archived);
    const gone = players.filter(player => player.archived);
    fill(list, live, false);
    fill(archivedList, gone, true);
    empty.hidden = players.length > 0;
    archived.hidden = gone.length === 0;
    archivedSummary.textContent = t('rosterArchivedHeading', { n: gone.length });
  }

  renderList();

  function update(state) {
    const roster = state.team?.roster ?? [];
    if (optimistic && sameRoster(roster, optimistic)) optimistic = null;
    // An open edit form keeps its draft; it re-renders when the edit ends.
    if (editingId !== null) return;
    renderList();
  }

  return { update, unmount() { root.replaceChildren(); } };
}
