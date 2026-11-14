export const firebaseConfig = {
  apiKey: 'AIzaSyBgbAfq1RMFIG6F-6pYzefZTyZdURKrOnI',
  authDomain: 'score-tracker-1be7c.firebaseapp.com',
  projectId: 'score-tracker-1be7c',
  storageBucket: 'score-tracker-1be7c.firebasestorage.app',
  messagingSenderId: '966929796388',
  appId: '1:966929796388:web:f6b1409662c71cba9677b1',
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
