import { readFile } from 'node:fs/promises';
import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

const firebaseDir = new URL('../../node_modules/firebase/', import.meta.url);
const fontsDir = new URL('../fixtures/fonts/', import.meta.url);
const clearDot = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
const preparedContexts = new WeakSet();

// Playwright runs one test at a time in each worker process.
let activeNetworkTest;

export async function prepareContext(context, owner, offline = false) {
  if (preparedContexts.has(context)) return;
  preparedContexts.add(context);

  // Offline emulation leaves request-stage interception active in Playwright 1.64.1.
  // node_modules/playwright-core/lib/coreBundle.js:37432–37474 (Chromium), :48802–48812 (WebKit).
  const setOffline = context.setOffline;
  context.setOffline = async function (value) {
    const previous = offline;
    offline = value;
    try {
      await setOffline.call(this, value);
    } catch (error) {
      offline = previous;
      throw error;
    }
  };

  await context.route(url => url.hostname !== '127.0.0.1' && url.hostname !== 'localhost', async route => {
    const handling = handleRoute(route, owner.problems, offline);
    owner.routeHandlers.add(handling);
    try {
      await handling;
    } finally {
      owner.routeHandlers.delete(handling);
    }
  });
}

async function handleRoute(route, problems, offline) {
  const url = new URL(route.request().url());
  const reject = message => {
    problems.push(message);
    return route.abort();
  };

  // Firestore's WebChannel uses this image to check connectivity after a channel error.
  if (url.origin === 'https://www.google.com' && url.pathname === '/images/cleardot.gif') {
    if (offline) return route.abort('internetdisconnected');
    return route.fulfill({ status: 200, contentType: 'image/gif', body: clearDot });
  }

  try {
    if (url.origin === 'https://www.gstatic.com') {
      const sdk = url.pathname.match(/^\/firebasejs\/([^/]+)\/(firebase-(?:app|auth|firestore)\.js)$/);
      if (sdk) {
        const [, version, filename] = sdk;
        const { version: firebaseVersion } = JSON.parse(await readFile(new URL('package.json', firebaseDir), 'utf8'));
        if (version !== firebaseVersion) {
          return reject(`Firebase SDK version mismatch: requested ${version}, installed ${firebaseVersion} (${url.href})`);
        }
        return route.fulfill({
          contentType: 'text/javascript',
          body: await readFile(new URL(filename, firebaseDir)),
        });
      }
    }

    if (url.origin === 'https://fonts.googleapis.com' && url.pathname === '/css2' && url.search) {
      return route.fulfill({ contentType: 'text/css', body: await readFile(new URL('sofia.css', fontsDir)) });
    }

    if (url.origin === 'https://fonts.gstatic.com') {
      const font = url.pathname.match(/^\/s\/(?:[^/]+\/)*([\w.-]+\.woff2)$/);
      if (font) {
        const [, filename] = font;
        const body = await readFile(new URL(filename, fontsDir));
        if (body.length === 0) return reject(`Empty font fixture: ${filename}`);
        return route.fulfill({ contentType: 'font/woff2', headers: { 'access-control-allow-origin': '*' }, body });
      }
    }
  } catch (error) {
    return reject(`Failed to read fixture for ${url.href}: ${error.message}`);
  }

  if (url.origin === 'https://apis.google.com' && url.pathname === '/js/api.js') {
    const callbacks = url.searchParams.getAll('onload');
    if (callbacks.length !== 1 || !/^__iframefcb\d{1,6}$/.test(callbacks[0])) {
      return reject(`Invalid gapi onload callback: ${url.href}`);
    }
    // On mobile, Safari and iOS, getAuth() eagerly initializes the popup resolver.
    // Its gapi callback rejects when gapi.load is absent. Auth catches that rejection,
    // so initialization can finish and signInAnonymously() can proceed.
    return route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: `globalThis.gapi = {}; {
        const callback = globalThis[${JSON.stringify(callbacks[0])}];
        if (typeof callback === 'function') callback();
      }`,
    });
  }

  return reject(`Unexpected external request: ${url.href}`);
}

export const test = base.extend({
  prepareBrowser: [async ({ browser }, use) => {
    const newContext = browser.newContext;
    // Playwright's default context fixture also calls this method when reuse is off.
    browser.newContext = async function (...args) {
      const owner = activeNetworkTest;
      if (!owner) throw new Error('browser.newContext() requires an active e2e test to own its network diagnostics');
      const creating = newContext.apply(this, args).then(async context => {
        const closed = new Promise(resolve => context.once('close', resolve));
        owner.contexts.push({ context, closed });
        await prepareContext(context, owner, args[0]?.offline);
        return context;
      });
      owner.contextCreations.push(creating);
      return creating;
    };
    try {
      await use();
    } finally {
      browser.newContext = newContext;
    }
  }, { scope: 'worker', auto: true }],

  networkProblems: [async ({}, use) => {
    const owner = { problems: [], contextCreations: [], contexts: [], routeHandlers: new Set() };
    activeNetworkTest = owner;
    try {
      await use();
    } finally {
      activeNetworkTest = undefined;
      await Promise.allSettled(owner.contextCreations);
      // Playwright closes the default context first. Close any remaining manual contexts
      // and wait for the close event even if a close call is already in progress.
      const closed = await Promise.allSettled(owner.contexts.map(async ({ context, closed }) => {
        await context.close();
        await closed;
      }));
      // No new context routes start after close. In-flight asset reads can still report problems.
      await Promise.allSettled(owner.routeHandlers);
      for (const result of closed) {
        if (result.status === 'rejected') owner.problems.push(`Could not close browser context: ${result.reason}`);
      }
      if (owner.problems.length) throw new Error(`E2E network requests failed:\n${owner.problems.join('\n')}`);
    }
  }, { auto: true }],
});
