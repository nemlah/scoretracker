import { EMULATOR } from '../../js/config.js';

const LOST_CONNECTION = 'Failed to load resource: The network connection was lost.';
const FIRESTORE_PREFIX = `http://${EMULATOR.host}:${EMULATOR.firestorePort}/google.firestore.v1.Firestore/`;
const CHANNEL = /^(Listen|Write)\/channel([?#]|$)/;
// The count of the games (getCountFromServer) is a plain fetch that a page teardown or navigation can abort.
const AGGREGATION = `http://${EMULATOR.host}:${EMULATOR.firestorePort}/v1/projects/`;
const COUNT = /^[^/?#]+\/databases\/\(default\)\/documents:runAggregationQuery([?#]|$)/;

export function isPlaywrightServiceWorkerBlock(text) {
  return text === 'Service Worker registration blocked by Playwright';
}

export function isFirestoreChannelLoss(text, url) {
  if (text !== LOST_CONNECTION || typeof url !== 'string') return false;
  if (url.startsWith(FIRESTORE_PREFIX)) return CHANNEL.test(url.slice(FIRESTORE_PREFIX.length));
  return url.startsWith(AGGREGATION) && COUNT.test(url.slice(AGGREGATION.length));
}
