import { prevPeriod, makeEvent, withPlayer } from '../../model.js';
const ADD_PERIODS = [1, 2, 3, 4, 'SO'];
const DEFAULT_ADD_PERIOD = '4';
import { eventLabel, periodLabel, t } from '../../strings.js';
import { createConfirmButton } from '../../ui/confirm.js';
import { h } from '../../ui/dom.js';
import { createOverlay } from '../../ui/overlay.js';
import { recountAfter } from '../recount.js';
import { createLineupSheet } from './lineup.js';

const PERIOD_LOCK_MS = 1000;

// Newest first; two events in the same millisecond keep their order in the game (later first).
function newestFirst(events) {
  return events.map((event, index) => ({ event, index }))
    .sort((a, b) => b.event.ts - a.event.ts || b.index - a.index)
    .map(entry => entry.event);
}

function lineupSignature(lineup) {
  return JSON.stringify(lineup.map(({ playerId, name, cap }) => [playerId, name, cap]));
}

function scorerOptions(event, lineup) {
  const options = [h('option', { value: '' }, t('scorerUnknown'))];
  for (const player of [...lineup].sort((a, b) => a.cap - b.cap)) {
    options.push(h('option', { value: player.playerId }, t('scorerOption', { cap: player.cap, name: player.name })));
  }
  // A scorer who is no longer in the lineup keeps showing, rather than silently turning into "unknown".
  if (event.playerId != null && !lineup.some(player => player.playerId === event.playerId)) {
    options.push(h('option', { value: event.playerId }, t('unknownPlayer')));
  }
  return options;
}

/**
 * The corrections list for one game: every event (newest first) with delete and scorer
 * assignment, plus period, lineup and end-game actions. Shared by the live screen's dialog and
 * the past-game detail, where it sits inline. `host` receives the lineup dialog.
 */
export function createEventsPanel(ctx, host, { onEnded = () => {} } = {}) {
  const rows = new Map(); // event id -> { el, label, period, select, remove, shown, lineupKey }
  let game = null;
  let periodLocked = false;
  let periodTimer = null;

  const lineupSheet = createLineupSheet(ctx, host);

  const addUnknown = h('button', {
    type: 'button', class: 'btn', 'data-testid': 'add-unknown-goal', onclick: onAddUnknown,
  }, t('addUnknownGoal'));
  // A goal added to a game that is no longer live has no "current" period: ask, defaulting to Q4.
  const addPeriod = h('select', {
    class: 'input ev-addperiod', 'aria-label': t('addGoalPeriodLabel'), 'data-testid': 'add-goal-period', hidden: true,
  }, ADD_PERIODS.map(period => h('option', { value: String(period) }, periodLabel(period))));
  addPeriod.value = DEFAULT_ADD_PERIOD;
  const periodPrev = h('button', {
    type: 'button', class: 'btn', 'data-testid': 'period-prev', onclick: onPeriodPrev,
  }, t('periodPrevNone'));
  const openLineup = h('button', {
    type: 'button', class: 'btn', 'data-testid': 'open-lineup', onclick: event => game && lineupSheet.open(game, event.currentTarget),
  }, t('openLineup'));
  const endGame = createConfirmButton({
    label: t('endGame'), testid: 'end-game', className: 'btn--end',
    onConfirm: () => onEnd(),
  });
  const list = h('ul', { class: 'ev-list', 'data-testid': 'ev-list' });
  const empty = h('p', { class: 'help', 'data-testid': 'ev-empty' }, t('eventsEmpty'));
  const el = h('div', { class: 'events' },
    h('div', { class: 'ev-actions' }, h('span', { class: 'ev-add' }, addUnknown, addPeriod), periodPrev, openLineup, endGame.el),
    empty, list);

  // Writes on a final game change the season stats; those also queue a recount.
  function send(target, start) {
    try {
      const write = Promise.resolve(start());
      (target.status === 'final' ? recountAfter(ctx, target.season, write) : write).catch(ctx.onWriteError);
    } catch (err) {
      ctx.onWriteError(err);
    }
  }

  function onAddUnknown() {
    const target = game;
    if (!target || !ctx.getState().active) return;
    const state = ctx.getState();
    if (target.status === 'live' && state.game?.id === target.id) {
      // The tapper keeps the per-device duplicate guard and the vibration.
      ctx.tapper.tap('goal', null);
      return;
    }
    const chosen = addPeriod.value === 'SO' ? 'SO' : Number(addPeriod.value);
    const event = makeEvent('goal', target.status === 'live' ? target.period : chosen, null);
    ctx.journal.record(target.id, 'add', event);
    send(target, () => ctx.repo.addEvent(target.id, event));
  }

  function onDelete(eventId) {
    const target = game;
    const event = target?.events?.find(entry => entry.id === eventId);
    if (!event || !ctx.getState().active) return;
    ctx.journal.record(target.id, 'remove', event);
    send(target, () => ctx.repo.removeEvent(target.id, event));
  }

  function onScorer(eventId, playerId) {
    const target = game;
    const event = target?.events?.find(entry => entry.id === eventId);
    if (!event || !ctx.getState().active) return;
    if ((event.playerId ?? '') === playerId) return;
    const changed = withPlayer(event, playerId === '' ? null : playerId);
    ctx.journal.record(target.id, 'replace', changed);
    send(target, () => ctx.repo.replaceEvent(target.id, event, changed));
  }

  // A second tap inside a second would skip a period, so the button is refused for a moment.
  function onPeriodPrev() {
    const target = game;
    if (!target || periodLocked || !ctx.getState().active || target.status !== 'live') return;
    const previous = prevPeriod(target.period);
    if (previous === null) return;
    periodLocked = true;
    periodPrev.disabled = true;
    periodTimer = setTimeout(() => {
      periodLocked = false;
      periodTimer = null;
      if (game) update(game, ctx.getState());
    }, PERIOD_LOCK_MS);
    send(target, () => ctx.repo.setPeriod(target.id, previous));
  }

  function onEnd() {
    const target = game;
    if (!target || !ctx.getState().active || target.status !== 'live') return;
    try {
      recountAfter(ctx, target.season, ctx.repo.endGame(target.id)).catch(ctx.onWriteError);
    } catch (err) {
      ctx.onWriteError(err);
      return;
    }
    onEnded(target);
  }

  function buildRow(event) {
    const period = h('span', { class: 'ev-period' }, periodLabel(event.period));
    const label = h('span', { class: 'ev-label' });
    const remove = h('button', {
      type: 'button', class: 'btn btn--small', 'data-testid': 'ev-delete', onclick: () => onDelete(event.id),
    }, t('evDelete'));
    const select = event.type === 'goal' ? h('select', {
      class: 'input ev-scorer', 'data-testid': 'ev-scorer', onchange: () => onScorer(event.id, select.value),
    }) : null;
    const li = h('li', { class: 'ev-row', 'data-testid': 'ev-row', 'data-event-id': event.id },
      h('div', { class: 'ev-line' }, period, label),
      h('div', { class: 'ev-controls' }, select, remove));
    return { el: li, label, period, select, remove, shown: null, lineupKey: null };
  }

  function syncRow(parts, event, lineup, lineupKey, writable) {
    parts.period.textContent = periodLabel(event.period);
    const text = eventLabel(event, lineup);
    parts.label.textContent = event.type === 'goal' ? t('goalPlain') : text;
    parts.remove.setAttribute('aria-label', t('evDeleteFor', { label: `${text} (${periodLabel(event.period)})` }));
    parts.remove.disabled = !writable;
    if (parts.select === null) return;
    const wanted = event.playerId ?? '';
    // Options are rebuilt only when the lineup changed, so a snapshot cannot close an open picker.
    if (parts.lineupKey !== lineupKey) {
      parts.select.replaceChildren(...scorerOptions(event, lineup));
      parts.lineupKey = lineupKey;
      parts.shown = null;
    }
    // What the list last showed, not what the picker says now: a pick that the server refuses
    // comes back as the old scorer and must put the picker back too.
    if (parts.shown !== wanted) {
      parts.select.value = wanted;
      parts.shown = wanted;
    }
    parts.select.setAttribute('aria-label', t('scorerFor', { label: `${text} (${periodLabel(event.period)})` }));
    parts.select.disabled = !writable;
  }

  function update(current, state) {
    game = current;
    const writable = state.active;
    const live = current.status === 'live';
    const lineup = current.lineup ?? [];
    const key = lineupSignature(lineup);

    addUnknown.disabled = !writable;
    addPeriod.hidden = live;
    addPeriod.disabled = !writable;
    periodPrev.hidden = !live;
    const previous = prevPeriod(current.period);
    periodPrev.textContent = previous === null ? t('periodPrevNone') : t('periodPrev', { label: periodLabel(previous) });
    periodPrev.disabled = !writable || previous === null || periodLocked;
    endGame.el.hidden = !live;
    endGame.el.disabled = !writable;
    if (!live) endGame.disarm();

    const events = newestFirst(current.events ?? []);
    empty.hidden = events.length > 0;
    const keep = new Set(events.map(event => event.id));
    for (const [id, parts] of rows) {
      if (!keep.has(id)) { parts.el.remove(); rows.delete(id); }
    }
    events.forEach((event, index) => {
      let parts = rows.get(event.id);
      if (!parts) {
        parts = buildRow(event);
        rows.set(event.id, parts);
      }
      syncRow(parts, event, lineup, key, writable);
      if (list.children[index] !== parts.el) list.insertBefore(parts.el, list.children[index] ?? null);
    });
    lineupSheet.update(current);
  }

  return {
    el,
    update,
    disarm: () => endGame.disarm(),
    destroy() {
      clearTimeout(periodTimer);
      endGame.destroy();
      lineupSheet.destroy();
    },
  };
}

/** The events panel in a dialog: the live screen's Events button opens it. */
export function createEventsSheet(ctx, host) {
  const panel = createEventsPanel(ctx, host, { onEnded });
  const overlay = createOverlay({
    title: t('eventsHeading'), testid: 'events-sheet', closeTestId: 'events-close', onClose: () => panel.disarm(),
  });
  overlay.body.append(panel.el);
  host.append(overlay.el);

  function onEnded() {
    overlay.close();
    ctx.navigate('/');
  }

  return {
    open(from) { overlay.open(from); },
    close() { overlay.close(); },
    isOpen: () => overlay.isOpen(),
    update(game, state) {
      if (game === null || game === undefined) { overlay.close(); return; }
      panel.update(game, state);
    },
    destroy() {
      panel.destroy();
      overlay.destroy();
    },
  };
}
