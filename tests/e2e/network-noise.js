import { EMULATOR } from '../../js/config.js';

const LOST_CONNECTION = 'Failed to load resource: The network connection was lost.';
const FIRESTORE_PREFIX = `http://${EMULATOR.host}:${EMULATOR.firestorePort}/google.firestore.v1.Firestore/`;
const CHANNEL = /^(Listen|Write)\/channel([?#]|$)/;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The aggregation request is the Home game count, cut off on reload or teardown.
const AGGREGATION = new RegExp(
  `^http://${escapeRegExp(EMULATOR.host)}:${EMULATOR.firestorePort}/v1/projects/demo-scoretracker(-\\d+)?/databases/\\(default\\)/documents:runAggregationQuery(\\?|$)`,
);

export function isPlaywrightServiceWorkerBlock(text) {
  return text === 'Service Worker registration blocked by Playwright';
}

export function isFirestoreChannelLoss(text, url) {
  if (text !== LOST_CONNECTION || typeof url !== 'string') return false;
  if (AGGREGATION.test(url)) return true;
  return url.startsWith(FIRESTORE_PREFIX) && CHANNEL.test(url.slice(FIRESTORE_PREFIX.length));
}
