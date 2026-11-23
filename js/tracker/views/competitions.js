import * as model from '../../model.js';
import * as strings from '../../strings.js';
import { t } from '../../strings.js';
import { h } from '../../ui/dom.js';

// This view is loaded on demand, but model.js, strings.js and repo.js are separate files that a phone can
// hold from the previous release. available() says whether all three are from this release.
const STRING_KEYS = [
  'homeCompetitions', 'tournamentsHeading', 'phasesHeading', 'listAdd', 'listRename', 'listRemove', 'listInUse',
  'listNameRequired', 'listNameDuplicate', 'listCheckFailed', 'competitionsUnavailable', 'phaseField',
];

export function available(ctx) {
  return ctx.repo?.competitionLists === true
    && typeof ctx.repo.addListEntry === 'function' && typeof ctx.repo.renameListEntry === 'function'
    && typeof ctx.repo.removeListEntry === 'function' && typeof ctx.repo.listGamesFromServer === 'function'
    && ['listEntries', 'listName', 'sameListName', 'competitionOf'].every(name => typeof model[name] === 'function')
    && STRING_KEYS.every(key => strings.hasString?.(key) === true);
}

const LISTS = [
  { list: 'tournaments', heading: 'tournamentsHeading', testid: 'competitions-tournaments' },
  { list: 'phases', heading: 'phasesHeading', testid: 'competitions-phases' },
];

export function mount(root, ctx) {
  const maxLength = model.MAX_COMPETITION_NAME ?? 40;
  let state = ctx.getState();
  let unmounted = false;
  let wasOnline = state.online;
  // Which entries a game uses, as the server last said. Remove stays off until it is known.
  let used = { tournaments: new Set(), phases: new Set() };
  let usedKnown = false;
  let checkFailed = false;
  let checking = false;
  let removing = false;

  const writable = () => state.active === true || state.writable === true;
  const removable = (list, id) => writable() && state.online !== false && usedKnown && !checkFailed && !removing
    && !used[list].has(id);

  async function readUse() {
    try {
      const games = await ctx.repo.listGamesFromServer();
      const next = { tournaments: new Set(), phases: new Set() };
      for (const game of games) {
        const fields = model.competitionOf(game);
        if (fields.tournamentId !== undefined) next.tournaments.add(fields.tournamentId);
        if (fields.phaseId !== undefined) next.phases.add(fields.phaseId);
      }
      return next;
    } catch {
      return null; // offline or a read error: the answer is unknown
    }
  }

  async function refreshUse() {
    if (checking) return;
    checking = true;
    const next = await readUse();
    checking = false;
    if (unmounted) return;
    if (next) {
      used = next;
      usedKnown = true;
      checkFailed = false;
    } else {
      checkFailed = true;
    }
    sync();
  }

  // Looks again at the moment of the click, then removes only an entry no game uses.
  async function remove(list, id) {
    if (removing) return;
    removing = true;
    syncRemoves();
    const next = await readUse();
    removing = false;
    if (unmounted) return;
    if (next) {
      used = next;
      usedKnown = true;
      checkFailed = false;
    } else {
      checkFailed = true;
    }
    if (next && !next[list].has(id) && writable()) {
      ctx.repo.removeListEntry(list, id).catch(err => ctx.onWriteError(err));
    }
    sync();
  }

  const note = h('p', { class: 'help', 'data-testid': 'list-check-note', role: 'status', hidden: true }, t('listCheckFailed'));

  function createSection({ list, heading, testid }) {
    let editingId = null;
    // The open editor row is built once per edit and kept across re-renders, so its draft and focus survive snapshots.
    let editor = null;
    let editorFor = null;
    let renderedKey = null;
    // Entries added here that the team snapshot does not show yet, so a quick second add sees them.
    const pending = new Map();

    const entriesNow = () => model.listEntries(state.team?.[list]);
    const namesNow = except => [...entriesNow().filter(entry => entry.id !== except).map(entry => entry.name),
      ...[...pending].filter(([id]) => id !== except).map(([, name]) => name)];

    const addError = h('p', { class: 'form-error', role: 'alert', hidden: true, 'data-testid': 'list-error' });
    const addInput = h('input', {
      class: 'input', type: 'text', maxlength: maxLength, autocomplete: 'off', 'aria-label': t(heading),
      'data-write': true, 'data-testid': 'list-add-input', oninput: () => { addError.hidden = true; },
    });
    const form = h('form', { class: 'add-form', novalidate: true, onsubmit: add },
      h('div', { class: 'field field--grow' }, addInput),
      h('button', { type: 'submit', class: 'btn btn--primary', 'data-write': true, 'data-testid': 'list-add' }, t('listAdd')));
    const rows = h('ul', { class: 'roster-list', 'data-testid': 'list-entries' });
    const el = h('section', { class: 'competitions-section', 'data-testid': testid },
      h('h2', {}, t(heading)), form, addError, rows);

    function check(raw, except) {
      const name = model.listName(raw);
      if (name === null) return { error: t('listNameRequired') };
      if (namesNow(except).some(other => model.sameListName(other, name))) return { error: t('listNameDuplicate') };
      return { name };
    }

    function add(event) {
      event.preventDefault();
      const result = check(addInput.value);
      if (result.error) {
        addError.textContent = result.error;
        addError.hidden = false;
        return;
      }
      addError.hidden = true;
      try {
        const { id, done } = ctx.repo.addListEntry(list, result.name);
        pending.set(id, result.name);
        done.catch(err => ctx.onWriteError(err)).finally(() => pending.delete(id));
      } catch (err) {
        ctx.onWriteError(err);
        return;
      }
      addInput.value = '';
      addInput.focus();
    }

    function row(entry) {
      const inUse = used[list].has(entry.id);
      return h('li', { class: 'roster-row', 'data-testid': 'list-entry', 'data-entry-id': entry.id },
        h('span', { class: 'list-name', lang: 'el' }, entry.name),
        h('span', { class: 'row-actions' },
          h('button', {
            type: 'button', class: 'btn btn--small', 'data-write': true, 'data-testid': 'list-rename',
            'aria-label': `${t('listRename')}: ${entry.name}`,
            onclick: () => { editingId = entry.id; renderRows(); editor?.querySelector('input')?.focus(); },
          }, t('listRename')),
          h('button', {
            type: 'button', class: 'btn btn--small', 'data-testid': 'list-remove', 'data-remove-id': entry.id,
            'aria-label': `${t('listRemove')}: ${entry.name}`, disabled: true,
            onclick: () => remove(list, entry.id),
          }, t('listRemove'))),
        h('p', { class: 'help list-used', 'data-testid': 'list-in-use', hidden: !inUse }, t('listInUse')));
    }

    function editRow(entry) {
      const input = h('input', {
        class: 'input', type: 'text', maxlength: maxLength, value: entry.name, 'aria-label': `${t('listRename')}: ${entry.name}`,
        'data-write': true, 'data-testid': 'list-rename-input', oninput: () => { error.hidden = true; },
      });
      const error = h('p', { class: 'form-error', role: 'alert', hidden: true, 'data-testid': 'list-error' });
      const submit = event => {
        event.preventDefault();
        const result = check(input.value, entry.id);
        if (result.error) {
          error.textContent = result.error;
          error.hidden = false;
          return;
        }
        editingId = null;
        if (result.name !== entry.name) {
          ctx.repo.renameListEntry(list, entry.id, result.name).catch(err => ctx.onWriteError(err));
        }
        renderRows();
      };
      return h('li', { class: 'roster-row roster-row--editing', 'data-testid': 'list-entry', 'data-entry-id': entry.id },
        h('form', { class: 'edit-form', novalidate: true, onsubmit: submit },
          input,
          h('button', { type: 'submit', class: 'btn btn--primary btn--small', 'data-write': true, 'data-testid': 'list-rename-save' }, t('rosterSave')),
          h('button', {
            type: 'button', class: 'btn btn--small', 'data-testid': 'list-rename-cancel',
            onclick: () => { editingId = null; renderRows(); },
          }, t('rosterCancel')),
          error));
    }

    // Replaces every row except `keep` without moving it, which would drop focus from its input.
    function place(nodes, keep) {
      const at = nodes.indexOf(keep);
      if (at < 0 || keep.parentNode !== rows) {
        rows.replaceChildren(...nodes);
        return;
      }
      for (const child of [...rows.children]) if (child !== keep) child.remove();
      for (const node of nodes.slice(0, at)) rows.insertBefore(node, keep);
      rows.append(...nodes.slice(at + 1));
    }

    function renderRows() {
      const entries = entriesNow();
      for (const entry of entries) pending.delete(entry.id);
      if (editingId !== null && !entries.some(entry => entry.id === editingId)) editingId = null;
      if (editingId === null || editorFor !== editingId) editor = null;
      const nodes = entries.map(entry => {
        if (entry.id !== editingId) return row(entry);
        if (editor === null) {
          editor = editRow(entry);
          editorFor = entry.id;
        }
        return editor;
      });
      place(nodes, editor);
      applyRemoves();
      renderedKey = key();
    }

    function applyRemoves() {
      for (const button of rows.querySelectorAll('[data-testid="list-remove"]')) {
        button.disabled = !removable(list, button.dataset.removeId);
      }
    }

    const key = () => JSON.stringify([entriesNow(), editingId, entriesNow().map(entry => used[list].has(entry.id))]);

    return {
      el,
      render() { if (key() !== renderedKey) renderRows(); },
      syncRemoves: applyRemoves,
    };
  }

  const sections = LISTS.map(createSection);
  root.append(h('div', { class: 'competitions', 'data-testid': 'competitions' }, note, ...sections.map(section => section.el)));

  function syncRemoves() {
    for (const section of sections) section.syncRemoves();
  }

  function sync() {
    for (const section of sections) section.render();
    note.hidden = !(checkFailed || state.online === false);
    syncRemoves();
  }

  sync();
  refreshUse();

  return {
    update(next) {
      state = next;
      // The server could not be asked while offline; ask again once the connection is back.
      if (!wasOnline && next.online && checkFailed) refreshUse();
      wasOnline = next.online;
      sync();
    },
    unmount() {
      unmounted = true;
      root.replaceChildren();
    },
  };
}
