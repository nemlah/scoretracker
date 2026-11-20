import { goalieStats } from '../../goalies.js';
import {
  deriveScore, hasShootout, lastEvent, nextPeriod, playerLines,
} from '../../model.js';
import { isTracked, replaySituations, situationCounts, SITUATION_REMIND_MS } from '../../situations.js';
import {
  eventLabel, goalCountLabel, periodLabel, scoreText, situationShort, t,
} from '../../strings.js';
import { h } from '../../ui/dom.js';
import { createOverlay } from '../../ui/overlay.js';
import { createEventsSheet } from './events.js';

const PIPS = 3;
const UNDO_LOCK_MS = 1000;
const PERIOD_LOCK_MS = 1000;
const SITUATION_LOCK_MS = 1000;
const GOALIE_LOCK_MS = 1000;
const SITUATION_TICK_MS = 1000;
const SITUATION_BUTTON = { none: 'manUpButton', manUp: 'manUpEndButton', manDown: 'manDownEndButton' };
const SITUATION_TAP = { none: 'manUp', manUp: 'manUpEnd', manDown: 'manDownEnd' };

// One tile per lineup player. Tiles are updated in place, never rebuilt: a snapshot that lands
// between a finger going down and coming up must not swap the button out from under it.
// Every tile is a head row and one button row. A goalie's Goal / Exclusion / Pen sit behind ⋯.
function buildTile(player, ctx, onGoalieTap, host) {
  const isGoalie = player.goalie === true;
  const badge = h('span', { class: 'cap cap--tile' }, player.cap);
  const name = h('span', { class: 'tile-name' }, player.name);
  const out = h('span', { class: 'out-label', 'data-testid': 'tile-out', hidden: true }, t('out'));
  const pips = Array.from({ length: PIPS }, () => h('i', { class: 'pip' }));
  const exclCount = h('span', { class: 'pips', role: 'img', 'data-testid': 'tile-excl-count' },
    pips, h('span', { class: 'sr-only' }, '0'));
  const el = h('li', { class: 'tile', 'data-testid': 'tile', 'data-cap': player.cap, 'data-player-id': player.playerId });
  let field = null;
  let goalie = null;
  // The latest line this tile was updated with: the ⋯ sheet reads it when a button is tapped.
  let current = { cap: player.cap, name: player.name, out: false, writable: false };
  let more = null;

  function closeMore() { more?.close(); }

  function openMore(from) {
    if (more) return;
    const sheet = createOverlay({
      title: t('moreSheetTitle', { cap: current.cap, name: current.name }),
      testid: 'goalie-more-sheet',
      closeTestId: 'goalie-more-close',
      // Built on open and removed on close: at most one such sheet is ever in the page.
      onClose: () => { sheet.destroy(); if (more === sheet) more = null; },
    });
    // A snapshot may have put the goalie OUT, or taken control away, since the sheet opened:
    // the state is read at tap time, and the sheet closes either way.
    const choose = type => () => {
      if (!current.out && current.writable) ctx.tapper.tap(type, player.playerId);
      sheet.close();
    };
    sheet.body.append(
      h('button', { type: 'button', class: 'btn btn--goal', 'data-testid': 'more-goal', onclick: choose('goal') }, t('goalButton')),
      h('button', { type: 'button', class: 'btn btn--excl', 'data-testid': 'more-excl', onclick: choose('excl') }, t('exclButton')),
      h('button', { type: 'button', class: 'btn btn--pen', 'data-testid': 'more-pen', onclick: choose('pen') }, t('penButton')));
    host.append(sheet.el);
    more = sheet;
    sheet.open(from);
  }

  if (isGoalie) {
    // Head: cap, then the name over the saves, the in-goal slot (badge or button, same footprint), pips.
    // The text is one line each, so a changing count or a long name can never change the tile's height.
    const inGoalBadge = h('span', { class: 'in-goal-badge' }, t('inGoalBadge'));
    const saves = h('span', { class: 'tile-saves', 'data-testid': 'tile-saves' });
    const saveButton = h('button', {
      type: 'button', class: 'btn btn--save', 'data-testid': 'tile-save',
      'aria-label': t('saveFor', { name: player.name }),
      onclick: () => onGoalieTap('save', player.playerId),
    }, t('saveButton'));
    const penSaveButton = h('button', {
      type: 'button', class: 'btn btn--pen-save', 'data-testid': 'tile-pen-save',
      'aria-label': t('penSaveFor', { name: player.name }),
      onclick: () => onGoalieTap('penSave', player.playerId),
    }, t('penSaveButton'));
    const inGoalButton = h('button', {
      type: 'button', class: 'btn btn--in-goal', 'data-testid': 'tile-in-goal',
      'aria-label': t('inGoalFor', { name: player.name }),
      onclick: () => onGoalieTap('gkIn', player.playerId),
    }, t('inGoalButton'));
    const moreButton = h('button', {
      type: 'button', class: 'btn btn--more', 'data-testid': 'tile-more',
      'aria-label': t('moreFor', { name: player.name }),
      onclick: event => openMore(event.currentTarget),
    }, t('moreButton'));
    el.dataset.goalie = 'true';
    el.classList.add('tile--goalie');
    el.append(
      h('div', { class: 'tile-head' },
        badge,
        h('span', { class: 'tile-who' }, h('span', { class: 'tile-name-line' }, name, out), saves),
        h('span', { class: 'in-goal-slot' }, inGoalBadge, inGoalButton),
        exclCount),
      h('div', { class: 'tile-actions' }, saveButton, penSaveButton, moreButton));
    goalie = { inGoalBadge, saves, saveButton, penSaveButton, inGoalButton, moreButton };
  } else {
    const goals = h('span', { class: 'tile-goals', 'data-testid': 'tile-goals' }, '0');
    const goalsLabel = h('span', { class: 'tile-goals-label' }, goalCountLabel(0));
    const soGoals = h('span', { class: 'tile-so', 'data-testid': 'tile-so-goals', hidden: true });
    const goalButton = h('button', {
      type: 'button', class: 'btn btn--goal', 'data-testid': 'tile-goal',
      'aria-label': t('goalFor', { name: player.name }),
      onclick: () => ctx.tapper.tap('goal', player.playerId),
    }, t('goalButton'));
    const exclButton = h('button', {
      type: 'button', class: 'btn btn--excl', 'data-testid': 'tile-excl',
      'aria-label': t('exclFor', { name: player.name }),
      onclick: () => ctx.tapper.tap('excl', player.playerId),
    }, t('exclButton'));
    const penButton = h('button', {
      type: 'button', class: 'btn btn--pen', 'data-testid': 'tile-pen',
      'aria-label': t('penFor', { name: player.name }),
      onclick: () => ctx.tapper.tap('pen', player.playerId),
    }, t('penButton'));
    el.append(
      h('div', { class: 'tile-head' },
        badge, h('span', { class: 'tile-who' }, name, out),
        h('span', { class: 'tile-stats' }, h('span', { class: 'tile-count' }, goals, goalsLabel), soGoals, exclCount)),
      h('div', { class: 'tile-actions' }, goalButton, exclButton, penButton));
    field = { goals, goalsLabel, soGoals, goalButton, exclButton, penButton };
  }

  return {
    el,
    isGoalie,
    closeMore,
    destroy() {
      more?.destroy();
      more = null;
    },
    update(line, writable, goalieLine = null, inGoal = false, shootout = false, goalieLocked = false) {
      el.dataset.cap = line.cap;
      current = { cap: line.cap, name: line.name, out: line.out, writable };
      badge.textContent = line.cap;
      badge.classList.toggle('cap--out', line.out);
      name.textContent = line.name;
      exclCount.setAttribute('aria-label', t('tileFoulsAria', { excl: line.excl, pens: line.pens }));
      exclCount.lastChild.textContent = line.excl;
      pips.forEach((pip, i) => {
        const isExcl = i < line.excl;
        const isPen = !isExcl && i < line.excl + line.pens;
        pip.classList.toggle('is-on', isExcl || isPen);
        pip.classList.toggle('is-pen', isPen);
        pip.textContent = isPen ? t('penPip') : '';
      });
      out.hidden = !line.out;
      el.classList.toggle('is-out', line.out);
      if (field !== null) {
        field.goals.textContent = line.goals;
        field.goalsLabel.textContent = goalCountLabel(line.goals);
        field.goals.setAttribute('aria-label', t('tileGoalsAria', { n: line.goals }));
        field.soGoals.hidden = line.soGoals === 0;
        field.soGoals.textContent = line.soGoals === 0 ? '' : t('penaltyGoals', { n: line.soGoals });
        field.goalButton.disabled = !writable || line.out;
        field.exclButton.disabled = !writable || line.out;
        field.penButton.disabled = !writable || line.out;
        return;
      }
      const penSaves = (goalieLine?.penSaves ?? 0) + (goalieLine?.soSaves ?? 0);
      const saveCount = goalieLine?.saves ?? 0;
      const savesText = saveCount === 1 ? t('tileSavesOne') : t('tileSaves', { n: saveCount });
      goalie.saves.textContent = penSaves > 0
        ? t('tileSavesWithPen', { saves: savesText, pens: t('tilePenSaves', { n: penSaves }) })
        : savesText;
      el.classList.toggle('is-in-goal', inGoal);
      if (inGoal) el.dataset.inGoal = 'true'; else delete el.dataset.inGoal;
      // The badge and the button share one slot: whichever is not shown keeps its space.
      goalie.inGoalBadge.style.visibility = inGoal ? 'visible' : 'hidden';
      goalie.inGoalButton.style.visibility = inGoal ? 'hidden' : 'visible';
      // Right after a goalie change the goalie buttons are refused for a moment, so a second
      // finger on the old layout cannot hit a tile that has just moved.
      goalie.saveButton.disabled = !writable || line.out || goalieLocked;
      goalie.penSaveButton.disabled = !writable || line.out || goalieLocked;
      goalie.inGoalButton.disabled = !writable || line.out || goalieLocked;
      // ⋯ is Goal, Exclusion and Pen: disabled like Goal on a player tile. An open sheet closes.
      goalie.moreButton.disabled = !writable || line.out;
      if (!writable || line.out) closeMore();
      // Hidden, not removed: the button keeps its space, so nothing moves under a finger.
      goalie.saveButton.style.visibility = shootout ? 'hidden' : 'visible';
    },
  };
}

export function mount(root, ctx) {
  const tiles = new Map(); // playerId -> tile
  let unmounted = false;
  let wakeLock = null;
  let undoLocked = false;
  let undoTimer = null;
  let periodLocked = false;
  let periodTimer = null;
  let situationLocked = false;
  let situationTimer = null;
  let situationTick = null;
  let openSituation = null;
  let goalieLocked = false;
  let goalieTimer = null;
  let scrollFrame = null;
  let inGoalId = null;

  const scoreUs = h('span', { class: 'score-us', 'data-testid': 'score-us' }, '0');
  const scoreThem = h('span', { class: 'score-them', 'data-testid': 'score-them' }, '0');
  const shootout = h('p', { class: 'shootout', 'data-testid': 'shootout', hidden: true });
  const situations = h('p', { class: 'live-situations', 'data-testid': 'live-situations', hidden: true });
  const sync = h('p', { class: 'sync', role: 'status', 'data-testid': 'sync-status' }, t('syncConnecting'));
  const periodButton = h('button', {
    type: 'button', class: 'btn btn--primary btn--period', 'data-testid': 'period-next', onclick: advancePeriod,
  }, periodLabel(1));
  const head = h('div', { class: 'live-top' },
    h('div', { class: 'live-head' },
      h('div', { class: 'live-score-block' },
        h('div', { class: 'live-score' }, scoreUs, h('span', { class: 'score-dash', 'aria-hidden': 'true' }, '–'), scoreThem),
        h('div', { class: 'live-meta' }, shootout, situations, sync)),
      periodButton));

  const tileList = h('ul', { class: 'tiles', 'data-testid': 'tiles' });

  const oppGoal = h('button', {
    type: 'button', class: 'btn btn--opp', 'data-testid': 'opp-goal', onclick: () => ctx.tapper.tap('oppGoal', null),
  }, t('oppGoalButton'));
  const situationLabel = h('span', { class: 'situation-label' }, t('manUpButton'));
  const situationSeconds = h('span', { class: 'situation-seconds', 'data-testid': 'situation-seconds', hidden: true });
  const situationButton = h('button', {
    type: 'button', class: 'btn situation', 'data-testid': 'situation', 'data-state': 'none', hidden: true,
    onclick: onSituation,
  }, situationLabel, situationSeconds);
  const undo = h('button', {
    type: 'button', class: 'btn btn--undo', 'data-testid': 'undo', onclick: onUndo,
  }, t('undoNothing'));
  const eventsOpen = h('button', {
    type: 'button', class: 'btn btn--events', 'data-testid': 'events-open', onclick: event => sheet.open(event.currentTarget),
  }, t('eventsButton'));
  const dock = h('div', { class: 'dock' }, h('div', { class: 'dock-inner' }, h('div', { class: 'dock-top' }, situationButton, oppGoal), h('div', { class: 'dock-row' }, undo, eventsOpen)));

  const game = h('div', { class: 'live', hidden: true }, head, tileList, dock);
  const loading = h('p', { class: 'status-line live-status' }, t('liveLoading'));
  const none = h('div', { class: 'stack live-status', hidden: true },
    h('p', {}, t('noLiveGame')),
    h('button', { type: 'button', class: 'btn btn--wide', onclick: () => ctx.navigate('/') }, t('navHome')));
  root.append(game, loading, none);
  const sheet = createEventsSheet(ctx, root);
  document.body.classList.add('on-live');

  // After an Undo the button is disabled for a moment, so an accidental double tap is visibly
  // refused instead of removing a second event. A tap on an enabled button is always performed.
  function onUndo() {
    if (undoLocked || !ctx.tapper.undo()) return;
    undoLocked = true;
    undo.disabled = true;
    undoTimer = setTimeout(() => {
      undoLocked = false;
      undoTimer = null;
      update(ctx.getState());
    }, UNDO_LOCK_MS);
  }

  // A tap that puts another goalie in goal (In goal, or a Save / Pen save by the one who was not in
  // goal) moves the goalie tiles. The goalie buttons are then refused for a second and the screen
  // scrolls to the top, where the goalie in goal now is. Undo reorders too, but never pauses or scrolls.
  function goalieTap(type, playerId) {
    if (goalieLocked) return;
    const changes = inGoalId !== null && playerId !== inGoalId;
    if (!ctx.tapper.tap(type, playerId) || !changes) return;
    goalieLocked = true;
    update(ctx.getState());
    goalieTimer = setTimeout(() => {
      goalieLocked = false;
      goalieTimer = null;
      update(ctx.getState());
    }, GOALIE_LOCK_MS);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    // One frame later: WebKit drops a smooth scroll started in the same task as the re-render.
    // Cancelled on unmount, so it can never scroll the view navigated to.
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null;
      if (!unmounted) window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    });
  }

  // Same guard as Undo: a double tap would skip a quarter, so after a change the button is
  // refused for a second.
  function advancePeriod() {
    const current = ctx.getState().game;
    if (periodLocked || !ctx.getState().active || current?.status !== 'live') return;
    const next = nextPeriod(current.period);
    if (next === null) return;
    periodLocked = true;
    periodButton.disabled = true;
    periodTimer = setTimeout(() => {
      periodLocked = false;
      periodTimer = null;
      update(ctx.getState());
    }, PERIOD_LOCK_MS);
    try {
      Promise.resolve(ctx.repo.setPeriod(current.id, next)).catch(ctx.onWriteError);
    } catch (err) {
      ctx.onWriteError(err);
    }
  }

  // Same guard as Undo: after a tap the button is refused for a second, so a double tap can't
  // open and then close a situation.
  function onSituation() {
    if (situationLocked) return;
    const state = situationButton.dataset.state;
    if (!ctx.tapper.tap(SITUATION_TAP[state])) return;
    situationLocked = true;
    situationButton.disabled = true;
    situationTimer = setTimeout(() => {
      situationLocked = false;
      situationTimer = null;
      update(ctx.getState());
    }, SITUATION_LOCK_MS);
  }

  function renderSituationClock() {
    if (openSituation === null) return;
    const elapsed = Date.now() - openSituation.startTs;
    situationSeconds.textContent = t('situationSeconds', { s: Math.max(0, Math.floor(elapsed / 1000)) });
    situationButton.classList.toggle('is-late', elapsed >= SITUATION_REMIND_MS);
  }

  function renderSituation(current, writable) {
    const tracked = isTracked(current) && [1, 2, 3, 4].includes(current.period);
    openSituation = tracked ? replaySituations(current).open : null;
    const state = openSituation?.kind ?? 'none';
    situations.hidden = !isTracked(current);
    situations.textContent = isTracked(current) ? situationShort(situationCounts(current)) : '';
    situationButton.hidden = !tracked;
    situationButton.dataset.state = state;
    situationLabel.textContent = t(SITUATION_BUTTON[state]);
    situationSeconds.hidden = openSituation === null;
    situationButton.disabled = !writable || situationLocked;
    setTint(openSituation?.kind ?? null);
    if (openSituation === null) {
      situationButton.classList.remove('is-late');
      clearInterval(situationTick);
      situationTick = null;
    } else {
      renderSituationClock();
      situationTick ??= setInterval(renderSituationClock, SITUATION_TICK_MS);
    }
  }

  function setTint(kind) {
    document.body.classList.toggle('sit-up', kind === 'manUp');
    document.body.classList.toggle('sit-down', kind === 'manDown');
  }

  function renderGame(current, state) {
    const events = current.events ?? [];
    const writable = state.active;
    const score = deriveScore(events);
    scoreUs.textContent = score.us;
    scoreThem.textContent = score.them;
    const showShootout = hasShootout(current.period, events);
    shootout.hidden = !showShootout;
    shootout.textContent = showShootout ? scoreText(score, true).shootout : '';
    // "online" only after the server has answered; writes still waiting count as not synced yet.
    sync.textContent = !state.online || state.gameOffline || state.pendingWrites ? t('syncOffline')
      : state.synced ? t('syncOnline') : t('syncConnecting');

    const next = nextPeriod(current.period);
    periodButton.textContent = periodLabel(current.period);
    periodButton.setAttribute('aria-label', next === null
      ? t('periodLastAria', { label: periodLabel(current.period) })
      : t('periodAria', { label: periodLabel(current.period), next: periodLabel(next) }));
    periodButton.disabled = !writable || next === null || periodLocked;

    // The goalie in goal first, then the field players, then the other goalies; each group by cap.
    // The goalie tiles all have the same height, so a goalie change swaps them without moving any
    // field tile.
    const all = playerLines(current.lineup ?? [], events);
    const stats = goalieStats({ ...current, lineup: current.lineup ?? [], events });
    inGoalId = stats?.inGoal ?? null;
    const lines = [
      ...all.filter(line => line.goalie === true && line.playerId === inGoalId),
      ...all.filter(line => line.goalie !== true),
      ...all.filter(line => line.goalie === true && line.playerId !== inGoalId),
    ];
    const keep = new Set(lines.map(line => line.playerId));
    for (const [id, tile] of tiles) {
      // A tile whose goalie flag changed (lineup edit) has a different layout, so it is rebuilt.
      const flagChanged = tile.isGoalie !== (lines.find(line => line.playerId === id)?.goalie === true);
      if (!keep.has(id) || flagChanged) { tile.destroy(); tile.el.remove(); tiles.delete(id); }
    }
    lines.forEach((line, index) => {
      let tile = tiles.get(line.playerId);
      if (!tile) {
        tile = buildTile(line, ctx, goalieTap, root);
        tiles.set(line.playerId, tile);
      }
      tile.update(line, writable, stats?.goalies.find(entry => entry.playerId === line.playerId),
        stats?.inGoal === line.playerId, current.period === 'SO', goalieLocked);
      // Only move a tile that is out of place, so unchanged tiles keep their DOM identity.
      if (tileList.children[index] !== tile.el) tileList.insertBefore(tile.el, tileList.children[index] ?? null);
    });

    const last = lastEvent(events);
    undo.textContent = last === null ? t('undoNothing') : t('undo', {
      label: eventLabel(last, current.lineup ?? []),
      period: periodLabel(last.period),
    });
    undo.disabled = last === null || !writable || undoLocked;
    oppGoal.disabled = !writable;
    renderSituation(current, writable);
  }

  function clearSituation() {
    openSituation = null;
    clearInterval(situationTick);
    situationTick = null;
    setTint(null);
  }

  function update(state) {
    const current = state.game;
    const live = state.gameLoaded && current?.status === 'live';
    game.hidden = !live;
    loading.hidden = state.gameLoaded;
    none.hidden = !(state.gameLoaded && !live);
    if (live) renderGame(current, state);
    else {
      clearSituation();
      for (const tile of tiles.values()) tile.closeMore();
    }
    sheet.update(live ? current : null, state);
  }

  // Keep the screen awake while tracking; browsers drop the lock when the page is hidden.
  async function acquireWakeLock() {
    if (unmounted || wakeLock || document.visibilityState !== 'visible') return;
    try {
      const lock = await navigator.wakeLock?.request('screen');
      if (!lock) return;
      if (unmounted) { Promise.resolve(lock.release?.()).catch(() => {}); return; }
      wakeLock = lock;
      lock.addEventListener?.('release', () => { if (wakeLock === lock) wakeLock = null; });
    } catch {
      // Unsupported, or refused (for example low battery): tracking still works.
    }
  }
  function onVisibility() {
    if (document.visibilityState === 'visible') acquireWakeLock();
  }
  document.addEventListener('visibilitychange', onVisibility);
  acquireWakeLock();

  // The dock is fixed; reserve exactly its height so no tile ends up behind it.
  let observer = null;
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--dock-h', `${dock.offsetHeight}px`);
    });
    observer.observe(dock);
  }

  return {
    update,
    unmount() {
      unmounted = true;
      clearTimeout(undoTimer);
      clearTimeout(periodTimer);
      clearTimeout(situationTimer);
      clearTimeout(goalieTimer);
      cancelAnimationFrame(scrollFrame);
      clearSituation();
      sheet.destroy();
      for (const tile of tiles.values()) tile.destroy();
      document.removeEventListener('visibilitychange', onVisibility);
      observer?.disconnect();
      document.body.classList.remove('on-live');
      document.documentElement.style.removeProperty('--dock-h');
      const lock = wakeLock;
      wakeLock = null;
      try { Promise.resolve(lock?.release()).catch(() => {}); } catch { /* already released */ }
      root.replaceChildren();
    },
  };
}
