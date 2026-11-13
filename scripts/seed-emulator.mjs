import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

const env = await initializeTestEnvironment({
  projectId: 'demo-scoretracker',
  firestore: { host: '127.0.0.1', port: 8080 },
});

try {
  await env.withSecurityRulesDisabled(async context => {
    await context.firestore().doc('secrets/editCode').set({ code: 'TEST01' });
  });
} finally {
  await env.cleanup();
}

console.log('Viewer: http://127.0.0.1:4173/index.html?emulator=1');
console.log('Tracker: http://127.0.0.1:4173/track.html?emulator=1');
