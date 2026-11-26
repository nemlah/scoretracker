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

const RETRY_MS = 3000;

export function mount(root, ctx) {
  const maxLength = model.MAX_COMPETITION_NAME ?? 40;
  let state = ctx.getState();
  let unmounted = false;
  // Which entries a game uses, as the server last said. Remove stays off until it is known.
  let used = { tournaments: new Set(), phases: new Set() };
  let usedKnown = false;
  const failed = new Set(); // 'list/id' of the entries whose last check could not be made
  let checking = false;
  let removing = false;
  let retryTimer = null;

  const keyOf = (list, id) => `${list}/${id}`;
  const entryRefs = () => LISTS.flatMap(({ list }) => model.listEntries(state.team?.[list]).map(entry => ({ list, id: entry.id })));
  const checkFailed = () => failed.size > 0;
  const writable = () => state.active === true || state.writable === true;
  const removable = (list, id) => writable() && state.online !== false && usedKnown && !failed.has(keyOf(list, id))
    && !removing && !used[list].has(id);

  // Asks about the given entries ({ list, id }) and returns a Map of 'list/id' to true (a game links it), false,
  // or null (the check could not be made). With this release's repo each entry is one query of its own, in
  // parallel; with the previous repo.js the whole games list is read once.
  async function readUse(refs) {
    const results = new Map();
    if (typeof ctx.repo.listEntryInUse === 'function') {
      await Promise.all(refs.map(async ({ list, id }) => {
        try {
          results.set(keyOf(list, id), await ctx.repo.listEntryInUse(list, id) === true);
        } catch {
          results.set(keyOf(list, id), null); // offline or a read error: the answer is unknown
        }
      }));
      return results;
    }
    try {
      const games = await ctx.repo.listGamesFromServer();
      const linked = { tournaments: new Set(), phases: new Set() };
      for (const game of games) {
        const fields = model.competitionOf(game);
        if (fields.tournamentId !== undefined) linked.tournaments.add(fields.tournamentId);
        if (fields.phaseId !== undefined) linked.phases.add(fields.phaseId);
      }
      for (const { list, id } of refs) results.set(keyOf(list, id), linked[list].has(id));
    } catch {
      for (const { list, id } of refs) results.set(keyOf(list, id), null);
    }
    return results;
  }

  // Takes the results of a check. An entry whose check failed while online is tried again after RETRY_MS, one
  // round at a time and only for the failed entries; offline, update() asks again when the connection returns.
  function applyUse(results) {
    for (const [key, value] of results) {
      const [list, ...rest] = key.split('/');
      const id = rest.join('/');
      if (value === null) {
        failed.add(key);
        continue;
      }
      failed.delete(key);
      usedKnown = true;
      used[list][value ? 'add' : 'delete'](id);
    }
    if (results.size === 0) usedKnown = true;
    const present = new Set(entryRefs().map(({ list, id }) => keyOf(list, id)));
    for (const key of failed) if (!present.has(key)) failed.delete(key);
    if (checkFailed() && state.online !== false && retryTimer === null) {
      retryTimer = setTimeout(() => { retryTimer = null; refreshUse(); }, RETRY_MS);
    }
  }

  async function refreshUse() {
    if (checking || removing || unmounted) return;
    checking = true;
    // The first round asks about every entry; later rounds only about those whose check failed.
    const refs = usedKnown ? entryRefs().filter(({ list, id }) => failed.has(keyOf(list, id))) : entryRefs();
    const results = await readUse(refs);
    checking = false;
    if (unmounted) return;
    applyUse(results);
    sync();
  }

  // Looks again at the moment of the click, at this entry only, then removes it if no game uses it.
  async function remove(list, id) {
    if (removing) return;
    removing = true;
    syncRemoves();
    const results = await readUse([{ list, id }]);
    removing = false;
    if (unmounted) return;
    applyUse(results);
    if (results.get(keyOf(list, id)) === false && writable()) {
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
        // Against the entry as the latest snapshot has it, not as it was when the editor opened.
        const current = entriesNow().find(item => item.id === entry.id);
        if (current && result.name !== current.name) {
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
    note.hidden = !(checkFailed() || state.online === false);
    syncRemoves();
  }

  sync();
  refreshUse();

  return {
    update(next) {
      state = next;
      sync();
      // A failed check is asked again once the device is online, unless a retry is already waiting.
      if (checkFailed() && next.online !== false && retryTimer === null) refreshUse();
    },
    unmount() {
      unmounted = true;
      clearTimeout(retryTimer);
      root.replaceChildren();
    },
  };
}
