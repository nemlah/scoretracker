import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createControlClaim, createWriteErrorHandler } from '../../js/tracker/ownership.js';

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

test('pointerdown then a stale snapshot with the old uid: the click guard still reads this device as active', () => {
  const claim = createControlClaim();
  assert.equal(claim.active, false);
  assert.deepEqual(claim.receive({ activeUid: 'other' }), { activeUid: 'other' });

  // pointerdown: the claim starts and the device shows as in control at once.
  assert.deepEqual(claim.begin('me', { activeUid: 'other' }), { activeUid: 'me' });
  assert.equal(claim.active, true);
  // Before the click: a snapshot queued earlier still names the old holder. What the app stores
  // (and the click guard reads as activeUid) is still this device; other fields are kept.
  assert.equal(claim.receive({ activeUid: 'other', claimedAt: 1 }).activeUid, 'me');
  assert.deepEqual(claim.receive({ activeUid: 'other', claimedAt: 1 }), { activeUid: 'me', claimedAt: 1 });
  assert.deepEqual(claim.receive(null), { activeUid: 'me' });
  assert.deepEqual(claim.receive({ activeUid: 'me' }), { activeUid: 'me' });
});

test('once the takeover is accepted, the snapshot that names this device is what shows', () => {
  const claim = createControlClaim();
  claim.begin('me', { activeUid: 'other' });
  claim.receive({ activeUid: 'other' });
  claim.receive({ activeUid: 'me' });
  assert.deepEqual(claim.end(true), { activeUid: 'me' });
  assert.equal(claim.active, false);
  assert.deepEqual(claim.receive({ activeUid: 'third' }), { activeUid: 'third' });
});

test('another device taking control before the claim settles wins once it settles', () => {
  const claim = createControlClaim();
  claim.begin('me', { activeUid: 'other' });
  claim.receive({ activeUid: 'me' });
  // Masked while the claim is in flight...
  assert.equal(claim.receive({ activeUid: 'third' }).activeUid, 'me');
  // ...but the owner after settlement is the other device, not this one.
  assert.deepEqual(claim.end(true), { activeUid: 'third' });
});

test('a takeover accepted with no snapshot in between keeps what is shown', () => {
  const claim = createControlClaim();
  claim.begin('me', { activeUid: 'other' });
  assert.equal(claim.end(true), undefined);
});

test('a refused takeover shows the latest holder the server reported', () => {
  const claim = createControlClaim();
  claim.begin('me', { activeUid: 'other' });
  claim.receive({ activeUid: 'third' });
  assert.deepEqual(claim.end(false), { activeUid: 'third' });
  assert.equal(claim.active, false);

  const unseen = createControlClaim();
  unseen.begin('me', null);
  assert.equal(unseen.end(false), null);
});
