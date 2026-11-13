import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;

function shellEntries() {
  const source = readFileSync(join(root, 'sw.js'), 'utf8');
  const match = source.match(/\/\/ SHELL-START([\s\S]*?)\/\/ SHELL-END/);
  assert.ok(match, 'sw.js has SHELL-START and SHELL-END markers');
  return [...match[1].matchAll(/'([^']+)'/g)].map(entry => entry[1]);
}

const isUrl = entry => /^https?:\/\//.test(entry);
const toPath = entry => entry.replace(/^\.\//, '');

function filesUnder(dir) {
  return readdirSync(join(root, dir), { recursive: true })
    .filter(file => statSync(join(root, dir, file)).isFile())
    .map(file => `${dir}/${file}`);
}

test('every local shell entry exists on disk', () => {
  const local = shellEntries().filter(entry => !isUrl(entry));
  assert.ok(local.length > 0);
  for (const entry of local) {
    assert.ok(entry.startsWith('./'), `${entry} is relative`);
    assert.ok(existsSync(join(root, toPath(entry))), `${entry} exists`);
  }
});

test('every root page and every file under js/ and css/ is in the shell', () => {
  const listed = new Set(shellEntries().filter(entry => !isUrl(entry)).map(toPath));
  const pages = readdirSync(root).filter(file => file.endsWith('.html'));
  assert.ok(pages.length >= 2);
  for (const file of [...pages, ...filesUnder('js'), ...filesUnder('css')]) {
    assert.ok(listed.has(file), `${file} is listed in SHELL`);
  }
  assert.ok(listed.has(''), 'the site root "./" is listed');
});

test('the pinned Firebase SDK URLs are in the shell at 12.19.0', () => {
  const urls = shellEntries().filter(isUrl);
  assert.equal(urls.length, 3);
  for (const url of urls) {
    assert.ok(url.startsWith('https://www.gstatic.com/firebasejs/'), url);
    assert.ok(url.includes('12.19.0'), url);
  }
});

test('the shell matches the import map in both pages', () => {
  const urls = new Set(shellEntries().filter(isUrl));
  for (const page of ['index.html', 'track.html']) {
    const html = readFileSync(join(root, page), 'utf8');
    const mapped = [...html.matchAll(/"firebase\/[a-z]+":\s*"([^"]+)"/g)].map(entry => entry[1]);
    assert.equal(mapped.length, 3, page);
    for (const url of mapped) assert.ok(urls.has(url), `${page}: ${url} is in SHELL`);
  }
});

test('same-origin requests fall back to the cache after a 3000 ms timeout', () => {
  const source = readFileSync(join(root, 'sw.js'), 'utf8');
  assert.match(source, /const NETWORK_TIMEOUT_MS = 3000;/);
  assert.match(source, /Promise\.race\(\[network, timeout\]\)/);
});

test('after one timeout the rest of the page chain is served from the cache for a named window', () => {
  const source = readFileSync(join(root, 'sw.js'), 'utf8');
  assert.match(source, /const SLOW_NETWORK_MS = \d+;/);
});

test('the shell cache name carries the worker scope and activation only touches this scope', () => {
  const source = readFileSync(join(root, 'sw.js'), 'utf8');
  assert.match(source, /const CACHE = `wp-shell-v1::\$\{self\.registration\.scope\}`;/);
  assert.match(source, /startsWith\('wp-shell-'\)/);
  assert.match(source, /endsWith\(`::\$\{self\.registration\.scope\}`\)/);
});
