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
// Tabs of one app name share a cache, and its primary tab runs every tab's listeners with its
// own sign-in. A page that never signs in (the viewer) passes its own name, so it can't become
// the primary tab for the tracker and run the tracker's listeners signed out.
export function initFirebase({ emulator = useEmulator(), name } = {}) {
  const app = initializeApp(emulator
    ? { projectId: globalThis.__E2E_PROJECT_ID ?? EMULATOR.projectId, apiKey: 'demo' }
    : firebaseConfig, name);
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    // Safari can hold streamed replies until the 30 s keep-alive.
    // Long-polling replies arrive as complete HTTP responses.
    experimentalForceLongPolling: true,
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
