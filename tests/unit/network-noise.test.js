import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMULATOR } from '../../js/config.js';
import { isFirestoreChannelLoss, isPlaywrightServiceWorkerBlock } from '../e2e/network-noise.js';

const lostConnection = 'Failed to load resource: The network connection was lost.';
const firestore = `http://${EMULATOR.host}:${EMULATOR.firestorePort}/google.firestore.v1.Firestore`;
const listen = `${firestore}/Listen/channel?VER=8&RID=rpc`;

for (const [name, text, dropped] of [
  ['drops the exact Playwright service worker warning', 'Service Worker registration blocked by Playwright', true],
  ['keeps an extended Playwright warning', 'Service Worker registration blocked by Playwright for /sw.js', false],
  ['keeps a prefixed Playwright warning', 'Warning: Service Worker registration blocked by Playwright', false],
  ['keeps an app registration failure', 'Service worker registration failed', false],
]) {
  test(name, () => assert.equal(isPlaywrightServiceWorkerBlock(text), dropped));
}

for (const [name, text, url, dropped] of [
  ['drops a lost Firestore Listen channel', lostConnection, listen, true],
  ['drops a lost Firestore Write channel', lostConnection, `${firestore}/Write/channel?VER=8`, true],
  ['keeps a lost Auth emulator request', lostConnection, `http://${EMULATOR.host}:${EMULATOR.authPort}/identitytoolkit.googleapis.com/v1/accounts:signUp`, false],
  ['keeps a lost static server request', lostConnection, `http://${EMULATOR.host}:4173/track.html`, false],
  ['keeps a lost request with an empty URL', lostConnection, '', false],
  ['keeps a lost request with no URL', lostConnection, undefined, false],
  ['keeps a different error on the Listen channel', 'Failed to load resource: The request timed out.', listen, false],
  ['keeps a lost request to a different Firestore endpoint', lostConnection, `${firestore}/Listen/channelStatus`, false],
]) {
  test(name, () => assert.equal(isFirestoreChannelLoss(text, url), dropped));
}
