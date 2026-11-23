import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../../js/model.js';

const lists = {
  tournaments: { t1: { name: 'Splash - Volos' }, t2: { name: 'Aegean Cup' } },
  phases: { p1: { name: 'Regular season' } },
};

test('listOptions: entries, a removed choice, then Add new', () => {
  const entries = model.listEntries(lists.tournaments);
  assert.deepEqual(model.listOptions(entries, 't1'), [
    { value: 't2', kind: 'entry', name: 'Aegean Cup' },
    { value: 't1', kind: 'entry', name: 'Splash - Volos' },
    { value: model.LIST_NEW, kind: 'new' },
  ]);
  assert.deepEqual(model.listOptions(entries, 'gone'), [
    { value: 't2', kind: 'entry', name: 'Aegean Cup' },
    { value: 't1', kind: 'entry', name: 'Splash - Volos' },
    { value: 'gone', kind: 'removed' },
    { value: model.LIST_NEW, kind: 'new' },
  ]);
  assert.deepEqual(model.listOptions([], model.LIST_NEW), [{ value: model.LIST_NEW, kind: 'new' }]);
  assert.deepEqual(model.listOptions([], '', { withNone: true }), [
    { value: '', kind: 'none' }, { value: model.LIST_NEW, kind: 'new' },
  ]);
});

test('listChoice: an existing entry sends its id and name', () => {
  assert.deepEqual(model.listChoice({ competition: 'tournament', tournamentChoice: 't1', lists }), {
    error: null, payload: { competition: 'tournament', competitionName: 'Splash - Volos', tournamentId: 't1' },
  });
  assert.deepEqual(model.listChoice({ competition: 'league', phaseChoice: 'p1', lists }), {
    error: null, payload: { competition: 'league', phaseId: 'p1' },
  });
});

test('listChoice: a removed choice is refused', () => {
  assert.deepEqual(model.listChoice({ competition: 'tournament', tournamentChoice: 'gone', lists }), { error: 'listEntryRemoved' });
  assert.deepEqual(model.listChoice({ competition: 'league', phaseChoice: 'gone', lists }), { error: 'listEntryRemoved' });
  assert.deepEqual(model.listChoice({ competition: 'tournament', tournamentChoice: 't1', lists: {} }), { error: 'listEntryRemoved' });
});

test('listChoice: Add new needs a name that is not in the list in any case', () => {
  const base = { competition: 'tournament', tournamentChoice: model.LIST_NEW, lists };
  assert.equal(model.listChoice({ ...base, tournamentNew: '' }).error, 'listNameRequired');
  assert.equal(model.listChoice({ ...base, tournamentNew: '   ' }).error, 'listNameRequired');
  assert.equal(model.listChoice({ ...base, tournamentNew: 'x'.repeat(41) }).error, 'listNameRequired');
  assert.equal(model.listChoice({ ...base, tournamentNew: 'SPLASH - VOLOS' }).error, 'listNameDuplicate');
  assert.equal(model.listChoice({ ...base, tournamentNew: ' aegean cup ' }).error, 'listNameDuplicate');
  assert.equal(model.listChoice({
    competition: 'league', phaseChoice: model.LIST_NEW, phaseNew: 'REGULAR SEASON', lists,
  }).error, 'listNameDuplicate');
  // The same name in the other list is fine.
  assert.equal(model.listChoice({ competition: 'league', phaseChoice: model.LIST_NEW, phaseNew: 'Splash - Volos', lists }).error, null);
});

test('listChoice: Add new sends a newEntry with the trimmed name and no id', () => {
  assert.deepEqual(model.listChoice({
    competition: 'tournament', tournamentChoice: model.LIST_NEW, tournamentNew: ' Splash - Patras ', lists,
  }), {
    error: null,
    payload: { competition: 'tournament', competitionName: 'Splash - Patras', newEntry: { list: 'tournaments', name: 'Splash - Patras' } },
  });
  assert.deepEqual(model.listChoice({
    competition: 'league', phaseChoice: model.LIST_NEW, phaseNew: 'Play-offs', lists,
  }), {
    error: null, payload: { competition: 'league', newEntry: { list: 'phases', name: 'Play-offs' } },
  });
});

test('listChoice: No phase is omitted unless nullPhase asks for an explicit null', () => {
  assert.deepEqual(model.listChoice({ competition: 'league', phaseChoice: '', lists }), { error: null, payload: { competition: 'league' } });
  assert.deepEqual(model.listChoice({ competition: 'league', phaseChoice: '', lists, nullPhase: true }), {
    error: null, payload: { competition: 'league', phaseId: null },
  });
  // nullPhase only concerns league games; a chosen phase keeps its id.
  assert.deepEqual(model.listChoice({ competition: 'league', phaseChoice: 'p1', lists, nullPhase: true }).payload, { competition: 'league', phaseId: 'p1' });
  assert.deepEqual(model.listChoice({ competition: 'cup', lists, nullPhase: true }), { error: null, payload: { competition: 'cup' } });
  assert.deepEqual(model.listChoice({ competition: 'friendly', lists }), { error: null, payload: { competition: 'friendly' } });
});

test('listChoice: other fields are ignored for the competition that does not use them', () => {
  assert.deepEqual(model.listChoice({
    competition: 'cup', tournamentChoice: 'gone', phaseChoice: 'gone', lists,
  }), { error: null, payload: { competition: 'cup' } });
  assert.deepEqual(model.listChoice({
    competition: 'league', tournamentChoice: 'gone', phaseChoice: '', lists,
  }), { error: null, payload: { competition: 'league' } });
});
