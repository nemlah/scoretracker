import { expect } from '@playwright/test';

export const TRACKER_URL = '/track.html?emulator=1';
export const CODE = 'AB12CD';

// Collects page errors and console errors so specs can assert on a pristine run.
export function collectProblems(page, problems) {
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
}

export async function unlockTracker(page, code = CODE) {
  await page.getByTestId('code-input').fill(code);
  await page.getByTestId('unlock-btn').click();
  await expect(page.getByTestId('home-new')).toBeVisible();
}

// Browsers report in-flight Firestore channel requests that they abort on navigation or
// when the network drops. That is browser noise, not an app error.
const NETWORK_NOISE = /ERR_INTERNET_DISCONNECTED|due to access control checks|WebKit encountered an internal error|Beacon API cannot load/;

export function dropNetworkNoise(problems) {
  for (let i = problems.length - 1; i >= 0; i -= 1) {
    if (NETWORK_NOISE.test(problems[i])) problems.splice(i, 1);
  }
}

export async function reloadTracker(page, problems) {
  await page.reload();
  dropNetworkNoise(problems);
}
