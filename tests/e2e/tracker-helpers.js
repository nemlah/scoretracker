import { expect } from '@playwright/test';
import { get, update } from './helpers.js';
import { isFirestoreChannelLoss, isPlaywrightServiceWorkerBlock } from './network-noise.js';

export const TRACKER_URL = '/track.html?emulator=1';
// An explicit #/ is a deliberate visit to Home; a bare address resumes a live game.
export const HOME_URL = `${TRACKER_URL}#/`;
export const CODE = 'AB12CD';
export const SERVER_WAIT = 20000;

export function formatConsoleProblem(text, url) {
  return text.startsWith('Failed to load resource') && url ? `console: ${text} <${url}>` : `console: ${text}`;
}

// Collects page errors and console errors so specs can assert on a pristine run.
export function collectProblems(page, problems) {
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const error = message.text();
    if (isPlaywrightServiceWorkerBlock(error)) return;
    const { url } = message.location();
    if (!isFirestoreChannelLoss(error, url)) problems.push(formatConsoleProblem(error, url));
  });
}

export async function unlockTracker(page, code = CODE) {
  await page.getByTestId('code-input').fill(code);
  await page.getByTestId('unlock-btn').click();
  await expect(page.getByTestId('home-new')).toBeVisible({ timeout: SERVER_WAIT });
}

export async function waitForTrackerControl() {
  await expect.poll(async () => (await get('control/tracker'))?.activeUid).toBeTruthy();
}

// These tests start with an empty control document and one tracker. Let its claim reach Firestore first.
export async function otherDeviceTakesControl() {
  await waitForTrackerControl();
  await update('control/tracker', { activeUid: 'another-device' });
}

// Browsers report in-flight Firestore channel requests that they abort on navigation or
// when the network drops, and Firestore logs once that it cannot reach the backend after a
// page opens offline. That is expected noise around offline and reload steps, not an app error.
const NETWORK_NOISE = /ERR_INTERNET_DISCONNECTED|due to access control checks|WebKit encountered an internal error|Beacon API cannot load|Could not reach Cloud Firestore backend/;

export function dropNetworkNoise(problems) {
  for (let i = problems.length - 1; i >= 0; i -= 1) {
    if (NETWORK_NOISE.test(problems[i])) problems.splice(i, 1);
  }
}

export async function reloadTracker(page, problems) {
  await page.reload();
  dropNetworkNoise(problems);
}
