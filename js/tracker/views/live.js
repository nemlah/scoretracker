import {
  deriveScore, hasShootout, lastEvent, nextPeriod, playerLines,
} from '../../model.js';
import { eventLabel, periodLabel, scoreText, t } from '../../strings.js';
import { h } from '../../ui/dom.js';

const PIPS = 3;
const UNDO_LOCK_MS = 1000;

// One tile per lineup player. Tiles are updated in place, never rebuilt: a snapshot that lands
// between a finger going down and coming up must not swap the button out from under it.
function buildTile(player, ctx) {
  const badge = h('span', { class: 'cap cap--tile' }, player.cap);
  const name = h('span', { class: 'tile-name' }, player.name);
  const out = h('span', { class: 'out-label', 'data-testid': 'tile-out', hidden: true }, t('out'));
  const goals = h('span', { class: 'tile-goals', 'data-testid': 'tile-goals' }, '0');
  const goalsLabel = h('span', { class: 'tile-goals-label' }, t('tileGoalsLabel'));
  const soGoals = h('span', { class: 'tile-so', 'data-testid': 'tile-so-goals', hidden: true });
  const pips = Array.from({ length: PIPS }, () => h('i', { class: 'pip' }));
  const exclCount = h('span', { class: 'pips', role: 'img', 'data-testid': 'tile-excl-count' },
    pips, h('span', { class: 'sr-only' }, '0'));
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
  const el = h('li', { class: 'tile', 'data-testid': 'tile', 'data-cap': player.cap, 'data-player-id': player.playerId },
    h('div', { class: 'tile-head' },
      badge, h('span', { class: 'tile-who' }, name, out),
      h('span', { class: 'tile-stats' },
        h('span', { class: 'tile-count' }, goals, goalsLabel), soGoals, exclCount)),
    h('div', { class: 'tile-actions' }, goalButton, exclButton));

  return {
    el,
    update(line, writable) {
      el.dataset.cap = line.cap;
      badge.textContent = line.cap;
      badge.classList.toggle('cap--out', line.out);
      name.textContent = line.name;
      goals.textContent = line.goals;
      goals.setAttribute('aria-label', t('tileGoalsAria', { n: line.goals }));
      soGoals.hidden = line.soGoals === 0;
      soGoals.textContent = line.soGoals === 0 ? '' : t('penaltyGoals', { n: line.soGoals });
      exclCount.setAttribute('aria-label', t('tileExclAria', { n: line.excl }));
      exclCount.lastChild.textContent = line.excl;
      pips.forEach((pip, i) => pip.classList.toggle('is-on', i < line.excl));
      out.hidden = !line.out;
      el.classList.toggle('is-out', line.out);
      goalButton.disabled = !writable || line.out;
      exclButton.disabled = !writable || line.out;
    },
  };
}

export function mount(root, ctx) {
  const tiles = new Map(); // playerId -> tile
  let unmounted = false;
  let wakeLock = null;
  let undoLocked = false;
  let undoTimer = null;

  const scoreUs = h('span', { class: 'score-us', 'data-testid': 'score-us' }, '0');
  const scoreThem = h('span', { class: 'score-them', 'data-testid': 'score-them' }, '0');
  const shootout = h('p', { class: 'shootout', 'data-testid': 'shootout', hidden: true });
  const sync = h('p', { class: 'sync', role: 'status', 'data-testid': 'sync-status' }, t('syncOnline'));
  const periodButton = h('button', {
    type: 'button', class: 'btn btn--primary btn--period', 'data-testid': 'period-next', onclick: advancePeriod,
  }, periodLabel(1));
  const head = h('div', { class: 'live-top' },
    h('div', { class: 'live-head' },
      h('div', { class: 'live-score-block' },
        h('div', { class: 'live-score' }, scoreUs, h('span', { class: 'score-dash', 'aria-hidden': 'true' }, '–'), scoreThem),
        h('div', { class: 'live-meta' }, shootout, sync)),
      periodButton),
    h('div', { class: 'rope', 'aria-hidden': 'true' }));

  const tileList = h('ul', { class: 'tiles', 'data-testid': 'tiles' });

  const oppGoal = h('button', {
    type: 'button', class: 'btn btn--opp', 'data-testid': 'opp-goal', onclick: () => ctx.tapper.tap('oppGoal', null),
  }, t('oppGoalButton'));
  const undo = h('button', {
    type: 'button', class: 'btn btn--undo', 'data-testid': 'undo', onclick: onUndo,
  }, t('undoNothing'));
  // Task 9 supplies ctx.openEvents; until then the button is present and does nothing.
  const eventsOpen = h('button', {
    type: 'button', class: 'btn btn--events', 'data-testid': 'events-open', onclick: () => ctx.openEvents?.(),
  }, t('eventsButton'));
  const dock = h('div', { class: 'dock' }, h('div', { class: 'dock-inner' }, oppGoal, h('div', { class: 'dock-row' }, undo, eventsOpen)));

  const game = h('div', { class: 'live', hidden: true }, head, tileList, dock);
  const loading = h('p', { class: 'status-line live-status' }, t('liveLoading'));
  const none = h('div', { class: 'stack live-status', hidden: true },
    h('p', {}, t('noLiveGame')),
    h('button', { type: 'button', class: 'btn btn--wide', onclick: () => ctx.navigate('/') }, t('navHome')));
  root.append(game, loading, none);
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

  function advancePeriod() {
    const current = ctx.getState().game;
    if (!ctx.getState().active || current?.status !== 'live') return;
    const next = nextPeriod(current.period);
    if (next === null) return;
    try {
      Promise.resolve(ctx.repo.setPeriod(current.id, next)).catch(ctx.onWriteError);
    } catch (err) {
      ctx.onWriteError(err);
    }
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
    sync.textContent = state.online && !state.gameOffline ? t('syncOnline') : t('syncOffline');

    const next = nextPeriod(current.period);
    periodButton.textContent = periodLabel(current.period);
    periodButton.setAttribute('aria-label', next === null
      ? t('periodLastAria', { label: periodLabel(current.period) })
      : t('periodAria', { label: periodLabel(current.period), next: periodLabel(next) }));
    periodButton.disabled = !writable || next === null;

    const lines = playerLines(current.lineup ?? [], events);
    const keep = new Set(lines.map(line => line.playerId));
    for (const [id, tile] of tiles) {
      if (!keep.has(id)) { tile.el.remove(); tiles.delete(id); }
    }
    lines.forEach((line, index) => {
      let tile = tiles.get(line.playerId);
      if (!tile) {
        tile = buildTile(line, ctx);
        tiles.set(line.playerId, tile);
      }
      tile.update(line, writable);
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
  }

  function update(state) {
    const current = state.game;
    const live = state.gameLoaded && current?.status === 'live';
    game.hidden = !live;
    loading.hidden = state.gameLoaded;
    none.hidden = !(state.gameLoaded && !live);
    if (live) renderGame(current, state);
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
