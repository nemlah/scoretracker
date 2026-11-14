import { latestNewGoal } from './model.js';

export function createGoalWatcher() {
  let lastId = null;
  let lastEvents = [];
  let confirmed = false;

  return {
    next(game, meta = {}) {
      if (game === null) {
        lastId = null;
        lastEvents = [];
        confirmed = false;
        return null;
      }
      if (game.id !== lastId) {
        lastId = game.id;
        lastEvents = game.events;
        confirmed = meta.fromCache === false;
        return null;
      }
      // The first server snapshot establishes the baseline; only later calls celebrate.
      const goal = game.status === 'live' && confirmed
        ? latestNewGoal(lastEvents, game.events) : null;
      lastEvents = game.events;
      confirmed ||= meta.fromCache === false;
      return goal;
    },
  };
}
