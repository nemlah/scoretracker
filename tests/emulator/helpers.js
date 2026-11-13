import { readFileSync } from 'node:fs';
import { after, before } from 'node:test';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, setLogLevel, terminate } from 'firebase/firestore';
import { createRepo } from '../../js/repo.js';

// Expected permission denials must not add SDK warnings to test output.
setLogLevel('silent');

export let testEnv;
const clients = new Set();

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-scoretracker',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });
});

after(async () => {
  try {
    await Promise.all([...clients].map(client => client.close()));
  } finally {
    if (testEnv) await testEnv.cleanup();
  }
});

export async function makeClient(name) {
  const app = initializeApp({ projectId: 'demo-scoretracker', apiKey: 'demo' }, name);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const client = {
    db,
    repo: createRepo(db),
    async close() {
      try {
        await terminate(db);
      } finally {
        await deleteApp(app);
        clients.delete(client);
      }
    },
  };
  clients.add(client);
  const { user } = await signInAnonymously(auth);
  client.uid = user.uid;
  return client;
}
