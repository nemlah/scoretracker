import { EVENT_TYPES, PERIODS, foulOutIds, makeEvent, prevPeriod, timelineRows, withPlayer } from '../../model.js';
import { inGoalAt, inGoalSwitch } from '../../goalies.js';
import { SITUATION_TYPES, isTracked, manUpGoalIds, manUpSwitch } from '../../situations.js';
import { eventLabel, periodLabel, situationShort, t } from '../../strings.js';
import { createConfirmButton } from '../../ui/confirm.js';
import { h } from '../../ui/dom.js';
import { createOverlay } from '../../ui/overlay.js';
import { recountAfter } from '../recount.js';
import { createLineupSheet } from './lineup.js';

const PERIOD_LOCK_MS = 1000;
const DEFAULT_ADD_PERIOD = '4';
const EVENT_ICONS = new Map([
  ['goal', 'goal'], ['oppGoal', 'goal'], ['save', 'save'], ['penSave', 'save'],
  ['gkIn', 'save'], ['excl', 'excl'], ['pen', 'pen'],
]);
const ICON_GLYPH = { goal: 'tlGoalIcon', save: 'tlSaveIcon', excl: 'tlExclIcon', pen: 'tlPenIcon' };
const icons = import('../../icons.js').catch(() => null);
let editorCounter = 0;

// Reverse the array first so a timestamp tie puts the later entry first.
function groupEvents(events) {
  const ordered = [...events].reverse().sort((a, b) =>
    PERIODS.indexOf(b.period) - PERIODS.indexOf(a.period) || b.ts - a.ts);
  const groups = new Map();
  for (const event of ordered) {
    if (!groups.has(event.period)) groups.set(event.period, []);
    groups.get(event.period).push(event);
  }
  return groups;
}

function deleteIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [name, value] of [
    ['viewBox', '0 0 24 24'], ['width', '20'], ['height', '20'], ['fill', 'none'],
    ['stroke', 'currentColor'], ['stroke-width', '2'], ['stroke-linecap', 'round'],
    ['stroke-linejoin', 'round'], ['aria-hidden', 'true'],
  ]) svg.setAttribute(name, value);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3');
  svg.append(path);
  return svg;
}

function lineupSignature(lineup) {
  return JSON.stringify(lineup.map(({ playerId, name, cap, goalie }) => [playerId, name, cap, goalie === true]));
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

// The lineup's goalies by cap; a goalie no longer marked in the lineup keeps showing as "unknown".
function goalieOptions(event, lineup, current) {
  const goalies = lineup.filter(player => player.goalie === true).sort((a, b) => a.cap - b.cap);
  const options = goalies.map(player => h('option', { value: player.playerId }, t('scorerOption', { cap: player.cap, name: player.name })));
  if (current != null && !goalies.some(player => player.playerId === current)) {
    options.push(h('option', { value: current }, t('unknownPlayer')));
  }
  return options;
}

function hasOption(select, value) {
  return Array.from(select.options).some(option => option.value === value);
}

/**
 * The corrections list for one game: every event (newest first) with delete and scorer
 * assignment, plus period, lineup and end-game actions. Shared by the live screen's dialog and
 * the past-game detail, where it sits inline. `host` receives the lineup dialog.
 */
export function createEventsPanel(ctx, host, { onEnded = () => {}, rowToggles = false } = {}) {
  const rows = new Map();
  const groups = new Map();
  let game = null;
  let periodLocked = false;
  let periodTimer = null;
  let drawIcon;

  icons.then(module => {
    drawIcon = module?.icon;
    if (!drawIcon) return;
    for (const { iconBox } of rows.values()) {
      const name = EVENT_ICONS.get(iconBox.dataset.kind);
      if (name) iconBox.replaceChildren(drawIcon(name));
    }
  });

  const lineupSheet = createLineupSheet(ctx, host);

  const addUnknown = h('button', {
    type: 'button', class: 'btn', 'data-testid': 'add-unknown-goal', onclick: onAddUnknown,
  }, t('addUnknownGoal'));
  // A goal added to a game that is no longer live has no "current" period: ask, defaulting to Q4.
  const addPeriod = h('select', {
    class: 'input ev-addperiod', 'aria-label': t('addGoalPeriodLabel'), 'data-testid': 'add-goal-period', hidden: true,
  }, PERIODS.map(period => h('option', { value: String(period) }, periodLabel(period))));
  addPeriod.value = DEFAULT_ADD_PERIOD;
  const periodPrev = h('button', {
    type: 'button', class: 'btn', 'data-testid': 'period-prev', onclick: onPeriodPrev,
  }, t('periodPrevNone'));
  const openLineup = h('button', {
    type: 'button', class: 'btn', 'data-testid': 'open-lineup', onclick: event => game && lineupSheet.open(game, event.currentTarget),
  }, t(rowToggles ? 'evAdjustLineup' : 'openLineup'));
  const endGame = createConfirmButton({
    label: t('endGame'), testid: 'end-game', className: 'btn--end',
    onConfirm: () => onEnd(),
  });
  const list = h('div', { 'data-testid': 'ev-list' });
  const empty = h('p', { class: 'help', 'data-testid': 'ev-empty' }, t('eventsEmpty'));
  const el = h('div', { class: 'events events--board' },
    h('div', { class: 'ev-actions ev-actions--game' }, openLineup, endGame.el),
    h('div', { class: 'ev-history' }, empty, list,
      h('div', { class: 'ev-actions ev-actions--correction' }, h('span', { class: 'ev-add' }, addUnknown, addPeriod), periodPrev)));

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

  // Fixes a forgotten MAN-UP tap: manUpSwitch decides which event to add or remove.
  function onManUp(eventId, checked) {
    const target = game;
    const parts = rows.get(eventId);
    if (!target || !parts?.manUpBox) return;
    const result = ctx.getState().active ? manUpSwitch(target, eventId, checked) : null;
    if (!result) {
      parts.manUpBox.checked = parts.manUpShown;
      return;
    }
    ctx.journal.record(target.id, result.op, result.event);
    send(target, () => (result.op === 'add'
      ? ctx.repo.addEvent(target.id, result.event)
      : ctx.repo.removeEvent(target.id, result.event)));
  }

  function onGoalie(eventId, goalieId) {
    const target = game;
    const parts = rows.get(eventId);
    const event = target?.events?.find(entry => entry.id === eventId);
    if (!event || !parts) return;
    // An older cached model.js would not accept a goalie event type (see taps.js).
    if (!ctx.getState().active || event.playerId === goalieId || !EVENT_TYPES.includes(event.type)) {
      parts.goalie.value = parts.goalieShown ?? '';
      return;
    }
    const changed = withPlayer(event, goalieId);
    ctx.journal.record(target.id, 'replace', changed);
    send(target, () => ctx.repo.replaceEvent(target.id, event, changed));
  }

  // Fixes a goalie swap that was never tapped: inGoalSwitch decides which gkIn to add, remove or move.
  function onInGoal(eventId, goalieId) {
    const target = game;
    const parts = rows.get(eventId);
    if (!target || !parts?.inGoal) return;
    const result = ctx.getState().active && EVENT_TYPES.includes('gkIn') ? inGoalSwitch(target, eventId, goalieId) : null;
    if (!result) {
      parts.inGoal.value = parts.inGoalShown ?? '';
      return;
    }
    ctx.journal.record(target.id, result.op, result.op === 'replace' ? result.newEvent : result.event);
    send(target, () => {
      if (result.op === 'add') return ctx.repo.addEvent(target.id, result.event);
      if (result.op === 'remove') return ctx.repo.removeEvent(target.id, result.event);
      return ctx.repo.replaceEvent(target.id, result.event, result.newEvent);
    });
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
      recountAfter(ctx, target.season, ctx.repo.endGame(target.id, target.date)).catch(ctx.onWriteError);
    } catch (err) {
      ctx.onWriteError(err);
      return;
    }
    onEnded(target);
  }

  function buildRow(event) {
    const period = h('span', { class: 'ev-period' }, periodLabel(event.period));
    const label = h('span', { class: 'ev-label' });
    const meta = h('span', { class: 'ev-meta', 'data-testid': 'ev-meta' });
    const iconName = EVENT_ICONS.get(event.type);
    const iconBox = h('span', {
      class: 'ev-icon', 'data-testid': 'ev-icon', 'data-kind': event.type, 'aria-hidden': 'true',
    }, iconName ? drawIcon?.(iconName) ?? t(ICON_GLYPH[iconName])
      : SITUATION_TYPES.includes(event.type) ? situationShort(null, event.type) : null);
    const remove = h('button', {
      type: 'button', class: 'btn btn--small ev-delete', 'data-testid': 'ev-delete', onclick: () => onDelete(event.id),
    }, deleteIcon());
    const select = event.type === 'goal' ? h('select', {
      class: 'input ev-scorer', 'data-testid': 'ev-scorer', onchange: () => onScorer(event.id, select.value),
    }) : null;
    const manUpBox = event.type === 'goal' ? h('input', {
      type: 'checkbox', class: 'ev-manup-box', 'data-testid': 'ev-manup', onchange: () => onManUp(event.id, manUpBox.checked),
    }) : null;
    const saveType = event.type === 'save' || event.type === 'penSave';
    const goalie = saveType ? h('select', {
      class: 'input ev-goalie', 'data-testid': 'ev-goalie', hidden: true, onchange: () => onGoalie(event.id, goalie.value),
    }) : null;
    const inGoal = event.type === 'oppGoal' ? h('select', {
      class: 'input ev-in-goal', 'data-testid': 'ev-in-goal', hidden: true, onchange: () => onInGoal(event.id, inGoal.value),
    }) : null;
    const manUp = manUpBox ? h('label', { class: 'ev-manup', hidden: true }, manUpBox, t('evManUpGoal')) : null;
    const editor = select || goalie || inGoal
      ? h('div', { class: 'ev-controls', hidden: rowToggles }, select, goalie, inGoal, manUp)
      : null;
    const parts = {
      label, meta, period, iconBox, editor, editing: !rowToggles,
      select, manUp, manUpBox, manUpShown: false, remove, shown: null, lineupKey: null,
      goalie, goalieShown: null, goalieKey: null, inGoal, inGoalShown: null, inGoalKey: null,
    };
    if (rowToggles && editor) {
      editor.id = `event-editor-${++editorCounter}`;
      parts.toggle = h('button', {
        type: 'button', class: 'btn btn--small ev-edit', 'data-testid': 'ev-edit',
        'aria-controls': editor.id, 'aria-expanded': 'false', onclick: () => {
          parts.editing = !parts.editing;
          syncEditor(parts);
        },
      }, t(select ? 'evChangeScorer' : 'evEdit'));
    }
    parts.el = h('li', { class: 'ev-row', 'data-testid': 'ev-row', 'data-event-id': event.id },
      h('div', { class: 'ev-line' }, period, iconBox, h('span', { class: 'ev-summary' }, label, meta), remove),
      editor);
    return parts;
  }

  function syncEditor(parts) {
    if (!parts.editor) return;
    const available = parts.select !== null || parts.goalie?.hidden === false || parts.inGoal?.hidden === false;
    parts.editor.hidden = !available || !parts.editing;
    if (parts.toggle) {
      if (!available) parts.toggle.remove();
      else if (!parts.toggle.parentNode) parts.remove.before(parts.toggle);
      parts.toggle.setAttribute('aria-expanded', String(!parts.editor.hidden));
    }
  }

  // The box always follows the figures, so a refused or no-op write puts it back.
  function syncManUp(parts, event, text, writable, manUpIds) {
    const available = manUpIds !== null && event.period !== 'SO';
    parts.manUp.hidden = !available;
    if (!available) return;
    const wanted = manUpIds.has(event.id);
    // A checkbox has no open picker to protect, so it always follows the figures.
    parts.manUpBox.checked = wanted;
    parts.manUpShown = wanted;
    parts.manUpBox.setAttribute('aria-label', t('evManUpGoalFor', { label: `${text} (${periodLabel(event.period)})` }));
    parts.manUpBox.disabled = !writable;
  }

  // Like the scorer picker: options only change with the lineup, and the value follows what the
  // list last showed, so a refused write puts the picker back.
  function syncGoalie(parts, event, lineup, lineupKey, writable, text) {
    if (!parts.goalie) return;
    const hasGoalies = lineup.some(player => player.goalie === true);
    parts.goalie.hidden = !hasGoalies;
    if (!hasGoalies) return;
    if (parts.goalieKey !== lineupKey) {
      parts.goalie.replaceChildren(...goalieOptions(event, lineup, event.playerId));
      parts.goalieKey = lineupKey;
      parts.goalieShown = null;
    }
    const wanted = event.playerId ?? '';
    if (parts.goalieShown !== wanted) {
      // A goalie who left the lineup's goalies keeps showing, rather than a blank picker.
      if (wanted !== '' && !hasOption(parts.goalie, wanted)) parts.goalie.replaceChildren(...goalieOptions(event, lineup, wanted));
      parts.goalie.value = wanted;
      parts.goalieShown = wanted;
    }
    parts.goalie.setAttribute('aria-label', t('evGoalieFor', { label: `${text} (${periodLabel(event.period)})` }));
    parts.goalie.disabled = !writable;
  }

  function syncInGoal(parts, event, lineup, lineupKey, writable, text) {
    if (!parts.inGoal) return;
    const wanted = game ? inGoalAt(game, event.id) : null;
    parts.inGoal.hidden = wanted === null;
    if (wanted === null) return;
    if (parts.inGoalKey !== lineupKey) {
      parts.inGoal.replaceChildren(...goalieOptions(event, lineup, wanted));
      parts.inGoalKey = lineupKey;
      parts.inGoalShown = null;
    }
    if (parts.inGoalShown !== wanted) {
      if (!hasOption(parts.inGoal, wanted)) parts.inGoal.replaceChildren(...goalieOptions(event, lineup, wanted));
      parts.inGoal.value = wanted;
      parts.inGoalShown = wanted;
    }
    parts.inGoal.setAttribute('aria-label', t('evInGoalFor', { label: `${text} (${periodLabel(event.period)})` }));
    parts.inGoal.disabled = !writable;
  }

  function syncScorer(parts, event, lineup, lineupKey, writable, text) {
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
      if (!hasOption(parts.select, wanted)) parts.select.replaceChildren(...scorerOptions(event, lineup));
      parts.select.value = wanted;
      parts.shown = wanted;
    }
    parts.select.setAttribute('aria-label', t('scorerFor', { label: `${text} (${periodLabel(event.period)})` }));
    parts.select.disabled = !writable;
  }

  function syncRow(parts, event, lineup, lineupKey, writable, manUpIds, score, out) {
    parts.period.textContent = periodLabel(event.period);
    const text = eventLabel(event, lineup);
    parts.label.textContent = text;
    const running = score ? t('evRunningScore', score) : '';
    parts.meta.textContent = out ? t('evThirdOut')
      : manUpIds?.has(event.id) ? t('evManUpScore', { score: running }) : running;
    parts.remove.setAttribute('aria-label', t('evDeleteFor', { label: text }));
    parts.remove.disabled = !writable;
    syncGoalie(parts, event, lineup, lineupKey, writable, text);
    syncInGoal(parts, event, lineup, lineupKey, writable, text);
    if (parts.select) {
      syncManUp(parts, event, text, writable, manUpIds);
      syncScorer(parts, event, lineup, lineupKey, writable, text);
    }
    syncEditor(parts);
  }

  function update(current, state) {
    game = current;
    // state.writable is newer than state.active: a cached app.js from the previous release lacks it.
    const writable = state.writable ?? state.active;
    const live = current.status === 'live';
    const lineup = current.lineup ?? [];
    const key = lineupSignature(lineup);
    const manUpIds = isTracked(current) ? manUpGoalIds(current) : null;

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

    const events = current.events ?? [];
    const byPeriod = groupEvents(events);
    const scores = new Map();
    for (const group of timelineRows(events)) {
      for (const event of group.events) {
        if (event.score) scores.set(event.id, event.score);
      }
    }
    const foulOuts = foulOutIds(events);
    empty.hidden = events.length > 0;
    const keep = new Set(events.map(event => event.id));
    for (const [id, parts] of rows) {
      if (!keep.has(id)) { parts.el.remove(); rows.delete(id); }
    }
    for (const [period, group] of groups) {
      if (!byPeriod.has(period)) { group.el.remove(); groups.delete(period); }
    }
    let groupIndex = 0;
    for (const [period, entries] of byPeriod) {
      let group = groups.get(period);
      if (!group) {
        const heading = h('h3', { class: 'ev-heading' });
        const items = h('ul', { class: 'ev-list' });
        group = { el: h('section', {}, heading, items), heading, items };
        groups.set(period, group);
      }
      const label = periodLabel(period);
      group.heading.textContent = groupIndex === 0 ? t('evNewestPeriod', { label }) : label;
      // Insert new groups around existing ones so their focused editors stay attached.
      const nextGroup = list.children[groupIndex++];
      if (nextGroup !== group.el) list.insertBefore(group.el, nextGroup ?? null);
      for (const [index, event] of entries.entries()) {
        let parts = rows.get(event.id);
        if (!parts) {
          parts = buildRow(event);
          rows.set(event.id, parts);
        }
        syncRow(parts, event, lineup, key, writable, manUpIds, scores.get(event.id), foulOuts.has(event.id));
        const nextRow = group.items.children[index];
        if (nextRow !== parts.el) group.items.insertBefore(parts.el, nextRow ?? null);
      }
    }
    lineupSheet.update(current);
  }

  return {
    el,
    update,
    disarm: () => endGame.disarm(),
    destroy() {
      clearTimeout(periodTimer);
      rows.clear();
      endGame.destroy();
      lineupSheet.destroy();
    },
  };
}

/** The events panel in a dialog: the live screen's Events button opens it. */
export function createEventsSheet(ctx, host) {
  const panel = createEventsPanel(ctx, host, { onEnded, rowToggles: true });
  const overlay = createOverlay({
    title: t('eventsHeading'), testid: 'events-sheet', closeTestId: 'events-close', onClose: () => panel.disarm(),
  });
  overlay.body.closest('.sheet').classList.add('sheet--events');
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
