import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

const firebaseDir = new URL('../../node_modules/firebase/', import.meta.url);
const firebaseVersion = JSON.parse(readFileSync(new URL('package.json', firebaseDir), 'utf8')).version;
const fontsDir = new URL('../fixtures/fonts/', import.meta.url);
const preparedContexts = new WeakSet();

// Playwright runs one test at a time in each worker process.
let activeNetworkProblems;

export async function prepareContext(context) {
  if (preparedContexts.has(context)) return;
  preparedContexts.add(context);
  const problems = activeNetworkProblems;

  await context.route(url => url.hostname !== '127.0.0.1' && url.hostname !== 'localhost', async route => {
    const url = new URL(route.request().url());
    const reject = message => {
      problems.push(message);
      return route.abort();
    };

    if (url.origin === 'https://www.gstatic.com') {
      const sdk = url.pathname.match(/^\/firebasejs\/([^/]+)\/(firebase-(?:app|auth|firestore)\.js)$/);
      if (sdk) {
        const [, version, filename] = sdk;
        if (version !== firebaseVersion) {
          return reject(`Firebase SDK version mismatch: requested ${version}, installed ${firebaseVersion} (${url.href})`);
        }
        return route.fulfill({
          contentType: 'text/javascript',
          path: fileURLToPath(new URL(filename, firebaseDir)),
        });
      }
    }

    if (url.origin === 'https://fonts.googleapis.com' && url.pathname === '/css2' && url.search) {
      return route.fulfill({ contentType: 'text/css', path: fileURLToPath(new URL('sofia.css', fontsDir)) });
    }

    if (url.origin === 'https://fonts.gstatic.com') {
      const font = url.pathname.match(/^\/s\/(?:[^/]+\/)*([\w.-]+\.woff2)$/);
      if (font) {
        const [, filename] = font;
        let body;
        try {
          body = await readFile(new URL(filename, fontsDir));
        } catch (error) {
          if (error.code === 'ENOENT') return reject(`Missing font fixture: ${filename}`);
          throw error;
        }
        if (body.length === 0) return reject(`Empty font fixture: ${filename}`);
        return route.fulfill({ contentType: 'font/woff2', headers: { 'access-control-allow-origin': '*' }, body });
      }
    }

    if (url.origin === 'https://apis.google.com' && url.pathname === '/js/api.js') {
      const callback = url.searchParams.get('onload');
      if (callback) {
        // On mobile, Safari and iOS, getAuth() eagerly initializes the popup resolver.
        // Its gapi callback rejects when gapi.load is absent. Auth catches that rejection,
        // so initialization can finish and signInAnonymously() can proceed.
        return route.fulfill({
          status: 200,
          contentType: 'text/javascript',
          body: `globalThis.gapi = {}; globalThis[${JSON.stringify(callback)}]();`,
        });
      }
    }

    return reject(`Unexpected external request: ${url.href}`);
  });
}

export const test = base.extend({
  prepareBrowser: [async ({ browser }, use) => {
    const newContext = browser.newContext;
    // Playwright's default context fixture also calls this method when reuse is off.
    browser.newContext = async function (...args) {
      const context = await newContext.apply(this, args);
      await prepareContext(context);
      return context;
    };
    try {
      await use();
    } finally {
      browser.newContext = newContext;
    }
  }, { scope: 'worker', auto: true }],

  networkProblems: [async ({}, use) => {
    const problems = [];
    activeNetworkProblems = problems;
    try {
      await use();
    } finally {
      activeNetworkProblems = undefined;
      if (problems.length) throw new Error(`E2E network requests failed:\n${problems.join('\n')}`);
    }
  }, { auto: true }],
});
