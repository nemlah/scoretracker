import { EMULATOR } from '../../js/config.js';

const LOST_CONNECTION = 'Failed to load resource: The network connection was lost.';
const FIRESTORE_PREFIX = `http://${EMULATOR.host}:${EMULATOR.firestorePort}/google.firestore.v1.Firestore/`;
const CHANNEL = /^(Listen|Write)\/channel([?#]|$)/;

export function isPlaywrightServiceWorkerBlock(text) {
  return text === 'Service Worker registration blocked by Playwright';
}

export function isFirestoreChannelLoss(text, url) {
  return text === LOST_CONNECTION && url?.startsWith(FIRESTORE_PREFIX) === true
    && CHANNEL.test(url.slice(FIRESTORE_PREFIX.length));
}
