import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { EMULATOR } from '../../js/config.js';

// Runs in the Playwright (Node) process; seeds Firestore with rules disabled.
let envPromise = null;

function env() {
  envPromise ??= initializeTestEnvironment({
    projectId: EMULATOR.projectId,
    firestore: {
      host: EMULATOR.host,
      port: EMULATOR.firestorePort,
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });
  return envPromise;
}

async function admin(fn) {
  const testEnv = await env();
  let result;
  await testEnv.withSecurityRulesDisabled(async context => { result = await fn(context.firestore()); });
  return result;
}

export const seed = (path, data) => admin(db => db.doc(path).set(data));
export const update = (path, data) => admin(db => db.doc(path).update(data));
export const get = path => admin(async db => (await db.doc(path).get()).data());
export const remove = path => admin(db => db.doc(path).delete());

export async function resetAll() {
  const testEnv = await env();
  await testEnv.clearFirestore();
  const response = await fetch(
    `http://${EMULATOR.host}:${EMULATOR.authPort}/emulator/v1/projects/${EMULATOR.projectId}/accounts`,
    { method: 'DELETE' },
  );
  if (!response.ok) throw new Error(`Auth reset failed: ${response.status}`);
}

export async function closeAll() {
  if (!envPromise) return;
  const pending = envPromise;
  envPromise = null;
  await (await pending).cleanup();
}
