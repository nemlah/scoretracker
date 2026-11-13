import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { EMULATOR, firebaseConfig, useEmulator } from './config.js';

// Browser only: the persistent Firestore cache requires IndexedDB.
export function initFirebase({ emulator = useEmulator() } = {}) {
  const app = initializeApp(emulator
    ? { projectId: EMULATOR.projectId, apiKey: 'demo' }
    : firebaseConfig);
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  if (emulator) connectFirestoreEmulator(db, EMULATOR.host, EMULATOR.firestorePort);
  const auth = getAuth(app);
  if (emulator) {
    connectAuthEmulator(auth, `http://${EMULATOR.host}:${EMULATOR.authPort}`, { disableWarnings: true });
  }
  return { app, db, auth };
}

export async function signIn(auth) {
  // The first notification follows restoration of the persisted auth session.
  const user = await new Promise(resolve => {
    const unsubscribe = onAuthStateChanged(auth, restoredUser => {
      unsubscribe();
      resolve(restoredUser);
    });
  });
  return user ? user.uid : (await signInAnonymously(auth)).user.uid;
}
