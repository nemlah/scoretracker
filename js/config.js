export const firebaseConfig = {
  apiKey: 'REPLACE_ME',
  authDomain: 'REPLACE_ME',
  projectId: 'REPLACE_ME',
  storageBucket: 'REPLACE_ME',
  messagingSenderId: 'REPLACE_ME',
  appId: 'REPLACE_ME',
};

export const team = { name: 'Our Team', accent: '#0057b8' };

export const EMULATOR = {
  projectId: 'demo-scoretracker',
  host: '127.0.0.1',
  firestorePort: 8080,
  authPort: 9099,
};

export function useEmulator(loc = globalThis.location) {
  return (loc?.hostname === 'localhost' || loc?.hostname === '127.0.0.1')
    && new URLSearchParams(loc.search).get('emulator') === '1';
}
