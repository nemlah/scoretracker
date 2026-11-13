import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDocFromServer,
  serverTimestamp,
  setDoc,
  setLogLevel,
  updateDoc,
} from 'firebase/firestore';

// Expected permission denials otherwise produce Firebase SDK warnings.
setLogLevel('silent');

let testEnv;
const scorePaths = ['games/g1', 'team/main', 'stats/2026-27'];

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-scoretracker',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

async function seedDocuments(documents) {
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const [path, data] of Object.entries(documents)) {
      await setDoc(doc(db, path), data);
    }
  });
}

const seedEditor = uid => seedDocuments({ [`editors/${uid}`]: { code: 'AB12CD' } });
const seedTracker = uid => seedDocuments({ 'control/tracker': { activeUid: uid } });
const seedScores = () => seedDocuments(Object.fromEntries(scorePaths.map(path => [path, { score: 0 }])));

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedDocuments({ 'secrets/editCode': { code: 'AB12CD' } });
});

test('public can read team, games, stats, control', async () => {
  await seedScores();
  await seedTracker('u1');
  const db = testEnv.unauthenticatedContext().firestore();
  for (const path of ['team/main', 'games/g1', 'stats/2026-27', 'control/tracker']) {
    await assertSucceeds(getDocFromServer(doc(db, path)));
  }
});

test('public cannot write team/main, games/g1, stats/2026-27, control/tracker, editors/x', async () => {
  const writeCases = [
    { path: 'team/main', data: { score: 1 } },
    { path: 'games/g1', data: { score: 1 } },
    { path: 'stats/2026-27', data: { score: 1 } },
    { path: 'control/tracker', data: { activeUid: 'x' } },
    { path: 'editors/x', data: { code: 'AB12CD' } },
  ];
  await seedScores();
  await seedTracker('u1');
  await seedEditor('x');
  const db = testEnv.unauthenticatedContext().firestore();
  for (const { path, data } of writeCases) {
    const ref = doc(db, path);
    await assertFails(setDoc(ref, data));
    await assertFails(updateDoc(ref, data));
    await assertFails(deleteDoc(ref));
  }
  // Exercise creation separately from writes to existing documents.
  await testEnv.withSecurityRulesDisabled(async context => {
    for (const { path } of writeCases) {
      await deleteDoc(doc(context.firestore(), path));
    }
  });
  for (const { path, data } of writeCases) {
    await assertFails(setDoc(doc(db, path), data));
  }
});

test('secrets are unreadable, even by the active tracker', async () => {
  await seedEditor('u1');
  await seedTracker('u1');
  for (const context of [testEnv.unauthenticatedContext(), testEnv.authenticatedContext('u2'), testEnv.authenticatedContext('u1')]) {
    await assertFails(getDocFromServer(doc(context.firestore(), 'secrets/editCode')));
  }
});

test('editor claim', async () => {
  const ref = doc(testEnv.authenticatedContext('u1').firestore(), 'editors/u1');
  await assertFails(setDoc(ref, { code: 'ZZZZZZ' }));
  await assertFails(setDoc(ref, { code: 'ab12cd' }));
  await assertFails(setDoc(ref, { code: 'AB12CD', x: 1 }));
  await assertSucceeds(setDoc(ref, { code: 'AB12CD', claimedAt: serverTimestamp() }));
});

test('cannot create editors doc for another uid', async () => {
  const db = testEnv.authenticatedContext('u1').firestore();
  await assertFails(setDoc(doc(db, 'editors/u2'), { code: 'AB12CD', claimedAt: serverTimestamp() }));
});

test("cannot read another uid's editors doc", async () => {
  await seedEditor('u1');
  await seedEditor('u2');
  const db = testEnv.authenticatedContext('u1').firestore();
  await assertFails(getDocFromServer(doc(db, 'editors/u2')));
  await assertSucceeds(getDocFromServer(doc(db, 'editors/u1')));
});

test('takeover', async () => {
  await seedEditor('u1');
  await seedTracker('u2');
  const ref = doc(testEnv.authenticatedContext('u1').firestore(), 'control/tracker');
  await assertFails(setDoc(ref, { activeUid: 'u2' }));
  await assertFails(setDoc(doc(testEnv.authenticatedContext('u3').firestore(), 'control/tracker'), { activeUid: 'u3' }));
  await assertSucceeds(setDoc(ref, { activeUid: 'u1' }));
});

test('takeover rejects extra fields', async () => {
  await seedEditor('u1');
  await seedTracker('u2');
  const ref = doc(testEnv.authenticatedContext('u1').firestore(), 'control/tracker');
  await assertFails(setDoc(ref, { activeUid: 'u1', unexpected: 'value' }));
  await assertSucceeds(setDoc(ref, { activeUid: 'u1', claimedAt: serverTimestamp() }));
});

test('valid editor who is not active cannot write games, team, stats', async () => {
  await seedEditor('u1');
  await seedEditor('u2');
  await seedTracker('u2');
  const db = testEnv.authenticatedContext('u1').firestore();
  for (const path of scorePaths) {
    await assertFails(setDoc(doc(db, path), { score: 1 }));
  }
  await seedScores();
  for (const path of scorePaths) {
    await assertFails(updateDoc(doc(db, path), { score: 1 }));
    await assertFails(deleteDoc(doc(db, path)));
  }
});

test('active tracker can write games, team, stats', async () => {
  await seedEditor('u1');
  await seedTracker('u1');
  const db = testEnv.authenticatedContext('u1').firestore();
  for (const path of scorePaths) {
    const ref = doc(db, path);
    await assertSucceeds(setDoc(ref, { score: 0 }));
    await assertSucceeds(updateDoc(ref, { score: 1 }));
    await assertSucceeds(deleteDoc(ref));
  }
});

test('changing the secret revokes', async () => {
  await seedEditor('u1');
  await seedTracker('u1');
  const db = testEnv.authenticatedContext('u1').firestore();
  const gameRef = doc(db, 'games/g1');
  const trackerRef = doc(db, 'control/tracker');
  await assertSucceeds(setDoc(gameRef, { score: 0 }));
  await assertSucceeds(setDoc(trackerRef, { activeUid: 'u1' }));
  await seedDocuments({ 'secrets/editCode': { code: 'NEW999' } });
  await assertFails(setDoc(gameRef, { score: 1 }));
  await assertFails(updateDoc(gameRef, { score: 1 }));
  await assertFails(deleteDoc(gameRef));
  await assertFails(setDoc(trackerRef, { activeUid: 'u1' }));
});
