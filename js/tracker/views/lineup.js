import {
  assignCap, lineupFrom, playerHasEvents, validateLineup,
} from '../../model.js';
import { t } from '../../strings.js';
import { h } from '../../ui/dom.js';
import { createOverlay } from '../../ui/overlay.js';
import { recountAfter } from '../recount.js';

const REASONS = { missingCap: 'selMissingCap', badCap: 'selBadCap', duplicateCap: 'selDuplicateCap' };

const capValue = text => (text === '' ? null : Number(text));

/**
 * The lineup editor, a dialog over the live screen or the past-game detail. It edits a draft;
 * Save writes the whole lineup (and the caps back to the roster) in one go.
 */
export function createLineupSheet(ctx, host) {
  const overlay = createOverlay({ title: t('lineupSheetHeading'), testid: 'lineup-sheet', closeTestId: 'lineup-close', raised: true });
  const rows = new Map(); // playerId -> { el, cap, error, actions, hasRemove }
  let game = null; // the latest snapshot of the game being edited
  let draft = []; // [{ playerId, name, cap, selected: true }]
  // The draft when a cap field got focus; every keystroke is applied to this base, so typing
  // "12" does not leave a swap behind from the stray "1".
  let base = null;
  let saving = false;
  let optionsSignature = null;

  const list = h('ul', { class: 'sel-list', 'data-testid': 'lu-list' });
  const addSelect = h('select', {
    class: 'input', id: 'lu-add', 'data-testid': 'lu-add', onchange: onAdd,
  });
  const addField = h('div', { class: 'field' }, h('label', { for: 'lu-add' }, t('luAddLabel')), addSelect);
  const noMore = h('p', { class: 'help', 'data-testid': 'lu-none-left' }, t('luNoMore'));
  const lineupError = h('p', { class: 'form-error', role: 'alert', 'data-testid': 'lu-error', hidden: true });
  const save = h('button', {
    type: 'button', class: 'btn btn--primary btn--center', 'data-testid': 'lu-save', onclick: onSave,
  }, t('luSave'));
  overlay.body.append(list, addField, noMore, lineupError, save);
  host.append(overlay.el);

  function setDraft(next) {
    draft = next;
    renderDraft();
  }

  function buildRow(player) {
    const cap = h('input', {
      class: 'input input--cap', type: 'text', inputmode: 'numeric', maxlength: 2, autocomplete: 'off',
      'aria-label': t('capFor', { name: player.name }), 'data-testid': 'lu-cap',
      onfocus: () => { base = draft.map(entry => ({ ...entry })); },
      onblur: () => { base = null; },
      oninput: () => {
        cap.value = cap.value.replace(/\D/g, '').slice(0, 2);
        const from = base ?? draft;
        const value = capValue(cap.value);
        setDraft(value === null
          ? from.map(entry => (entry.playerId === player.playerId ? { ...entry, cap: null } : { ...entry }))
          : assignCap(from, player.playerId, value));
      },
    });
    const error = h('p', { class: 'form-error sel-error', role: 'alert', 'data-testid': 'lu-row-error', hidden: true });
    const actions = h('span', { class: 'lu-actions' });
    const el = h('li', { class: 'sel-row', 'data-testid': 'lu-row', 'data-player-id': player.playerId },
      h('span', { class: 'sel-name lu-name' }, player.name), cap, actions, error);
    return { el, cap, error, actions, hasRemove: null };
  }

  // A player with events stays in the lineup: those events would lose their scorer.
  function syncActions(parts, player, removable, writable) {
    if (parts.hasRemove !== removable) {
      parts.hasRemove = removable;
      parts.actions.replaceChildren(removable
        ? h('button', {
          type: 'button', class: 'btn btn--small', 'data-testid': 'lu-remove',
          'aria-label': t('luRemoveFor', { name: player.name }),
          onclick: () => { base = null; setDraft(draft.filter(entry => entry.playerId !== player.playerId)); },
        }, t('luRemove'))
        : h('span', { class: 'help', 'data-testid': 'lu-keeps' }, t('luKeepsEvents')));
    }
    const button = parts.actions.querySelector('button');
    if (button) button.disabled = !writable;
  }

  function renderDraft() {
    const writable = ctx.getState().active;
    const events = game?.events ?? [];
    const keep = new Set(draft.map(player => player.playerId));
    for (const [id, parts] of rows) {
      if (!keep.has(id)) { parts.el.remove(); rows.delete(id); }
    }
    const errors = validateLineup(draft);
    draft.forEach((player, index) => {
      let parts = rows.get(player.playerId);
      if (!parts) {
        parts = buildRow(player);
        rows.set(player.playerId, parts);
      }
      if (list.children[index] !== parts.el) list.insertBefore(parts.el, list.children[index] ?? null);
      // The field being typed in keeps the text the user entered unless the draft changed it.
      if (document.activeElement !== parts.cap || capValue(parts.cap.value) !== player.cap) {
        parts.cap.value = player.cap ?? '';
      }
      parts.cap.disabled = !writable;
      syncActions(parts, player, !playerHasEvents(events, player.playerId), writable);
      const reason = errors.find(error => error.playerId === player.playerId)?.reason;
      parts.error.hidden = reason === undefined;
      parts.error.textContent = reason === undefined ? '' : t(REASONS[reason]);
    });

    const noPlayers = errors.some(error => error.reason === 'noPlayers');
    lineupError.hidden = !noPlayers;
    lineupError.textContent = noPlayers ? t('luNoPlayers') : '';

    const inLineup = new Set(draft.map(player => player.playerId));
    const options = (ctx.getState().team?.roster ?? [])
      .filter(player => !player.archived && !inLineup.has(player.id))
      .sort((a, b) => a.cap - b.cap || a.name.localeCompare(b.name));
    // Rebuilt only when the choices change, so a snapshot cannot close an open picker.
    const signature = JSON.stringify(options.map(({ id, name, cap }) => [id, name, cap]));
    if (signature !== optionsSignature) {
      optionsSignature = signature;
      addSelect.replaceChildren(
        h('option', { value: '' }, t('luAddPlaceholder')),
        ...options.map(player => h('option', { value: player.id }, t('scorerOption', { cap: player.cap, name: player.name }))));
    }
    addSelect.value = '';
    addSelect.disabled = !writable;
    addField.hidden = options.length === 0;
    noMore.hidden = options.length > 0;
    save.disabled = saving || !writable || errors.length > 0;
  }

  function onAdd() {
    const player = (ctx.getState().team?.roster ?? []).find(entry => entry.id === addSelect.value);
    if (!player) return;
    base = null;
    // The roster's own cap, unless somebody in the lineup already wears it.
    const taken = draft.some(entry => entry.cap === player.cap);
    setDraft([...draft, { playerId: player.id, name: player.name, cap: taken ? null : player.cap, selected: true }]
      .sort((a, b) => (a.cap ?? 100) - (b.cap ?? 100)));
  }

  function onSave() {
    const state = ctx.getState();
    if (saving || !state.active || game === null || validateLineup(draft).length > 0) return;
    saving = true;
    const target = game;
    try {
      const write = ctx.repo.setLineup(target.id, lineupFrom(draft), state.team?.roster ?? []);
      const done = target.status === 'final' ? recountAfter(ctx, target.season, write) : Promise.resolve(write);
      done.catch(ctx.onWriteError);
    } catch (err) {
      ctx.onWriteError(err);
    }
    saving = false;
    overlay.close();
  }

  return {
    open(current, from) {
      game = current;
      base = null;
      draft = (current.lineup ?? []).map(({ playerId, name, cap }) => ({ playerId, name, cap, selected: true }));
      renderDraft();
      overlay.open(from);
    },
    close: () => overlay.close(),
    isOpen: () => overlay.isOpen(),
    update(current) {
      if (current === null) { overlay.close(); game = null; return; }
      game = current;
      if (overlay.isOpen()) renderDraft();
    },
    destroy: () => overlay.destroy(),
  };
}
