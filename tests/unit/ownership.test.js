import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWriteErrorHandler } from '../../js/tracker/ownership.js';

const denied = Object.assign(new Error('denied'), { code: 'permission-denied' });
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup({ active = true, control = { activeUid: 'me' }, readFails = false } = {}) {
  const log = [];
  const state = { active, uid: 'me' };
  let reads = 0;
  const handler = createWriteErrorHandler({
    getState: () => state,
    readControl: async () => {
      reads += 1;
      if (readFails) throw new Error('offline');
      return control;
    },
    onRevoked: () => log.push('revoked'),
    onFailure: () => log.push('failure'),
  });
  return { handler, log, state, reads: () => reads };
}

test('a denial while another device holds control is a takeover, not a revocation', async () => {
  // The rejection arrives before the control snapshot: state.active is still true locally.
  const { handler, log } = setup({ control: { activeUid: 'other-device' } });
  handler(denied);
  await tick();
  assert.deepEqual(log, []);
});

test('a denial while the server still names this device means the code was revoked', async () => {
  const { handler, log } = setup();
  handler(denied);
  await tick();
  assert.deepEqual(log, ['revoked']);
});

test('an unreachable server leaves the state alone', async () => {
  const { handler, log } = setup({ readFails: true });
  handler(denied);
  await tick();
  assert.deepEqual(log, []);
});

test('a denial on a device that is already read-only needs no check', async () => {
  const { handler, log, reads } = setup({ active: false });
  handler(denied);
  await tick();
  assert.deepEqual(log, []);
  assert.equal(reads(), 0);
});

test('a burst of denials checks the server once', async () => {
  const { handler, log, reads } = setup();
  handler(denied);
  handler(denied);
  handler(denied);
  await tick();
  assert.equal(reads(), 1);
  assert.deepEqual(log, ['revoked']);
});

test('other errors are reported as failed writes', () => {
  const { handler, log } = setup();
  handler(Object.assign(new Error('x'), { code: 'unavailable' }));
  handler(new Error('y'));
  assert.deepEqual(log, ['failure', 'failure']);
});
