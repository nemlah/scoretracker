import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { contrastRatio } from '../../js/accent.js';

function readSource(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

function readCss(path) {
  return readSource(path).replace(/\/\*[\s\S]*?\*\//g, '');
}

function readProperties(block) {
  return Object.fromEntries(
    Array.from(block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g), ([, name, value]) => [name, value.trim()]),
  );
}

const baseCss = readCss('css/base.css');
const viewerCss = readCss('css/viewer.css');
const trackerCss = readCss('css/tracker.css');
const base = readProperties(baseCss.match(/:root\s*\{([^}]*)\}/)[1]);
const darkBlock = viewerCss.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/)[1];
const dark = readProperties(darkBlock);
const tracker = Array.from(trackerCss.matchAll(/:root\s*\{([^}]*)\}/g), ([, block]) => readProperties(block))
  .find(properties => Object.hasOwn(properties, 'pen'));

const lightTextPairs = [
  ['ink', 'paper'],
  ['ink', 'pool'],
  ['muted', 'paper'],
  ['muted', 'pool'],
  ['water-text', 'paper'],
  ['water-text', 'pool'],
  ['rope', 'paper'],
  ['out-text', 'paper'],
  ['led', 'board'],
  ['board-muted', 'board'],
  ['#ffffff', 'sit-up-strong'],
  ['ink', 'sit-down-strong'],
  ['#ffffff', 'pen'],
  ['ink', 'sit-up'],
  ['ink', 'sit-down'],
  ['ink', 'led'],
];
const lightLinePairs = [['line-strong', 'paper'], ['line-strong', 'pool']];
const darkTextPairs = [
  ...['ink', 'muted', 'water-text', 'rope', 'out-text'].flatMap(text => [
    [text, 'paper'],
    [text, 'pool'],
  ]),
  ['led', 'board'],
  ['board-muted', 'board'],
];
const darkLinePairs = [['line-strong', 'paper']];
const newProperties = [
  'muted', 'line-strong', 'board', 'board-line', 'board-muted', 'led', 'out-text',
  'accent-on-board', 'on-accent',
];
const sofiaUrl = 'https://fonts.googleapis.com/css2?family=Sofia+Sans:wght@400;600;700&family=Sofia+Sans+Extra+Condensed:wght@700;800&display=swap';
const hexColour = /^#[0-9a-f]{6}$/i;

function contrastFailures(properties, pairs, minimum) {
  const failures = [];
  for (const [foreground, background] of pairs) {
    const text = foreground.startsWith('#') ? foreground : properties[foreground];
    const surface = properties[background];
    const pair = `${foreground}/${background}`;
    if (!hexColour.test(text) || !hexColour.test(surface)) {
      failures.push(`${pair} requires two hex colours (${text}, ${surface})`);
      continue;
    }
    const ratio = contrastRatio(text, surface);
    if (ratio < minimum) {
      failures.push(`${pair} is ${ratio.toFixed(4)}:1, expected at least ${minimum}:1`);
    }
  }
  return failures;
}

test('light tokens meet contrast', () => {
  const light = { ...base, ...tracker };
  const failures = [
    ...contrastFailures(light, lightTextPairs, 4.5),
    ...contrastFailures(light, lightLinePairs, 3),
  ];
  assert.ok(failures.length === 0, failures.join('\n'));
});

test('viewer dark tokens meet contrast', () => {
  const failures = [
    ...contrastFailures(dark, darkTextPairs, 4.5),
    ...contrastFailures(dark, darkLinePairs, 3),
  ];
  assert.ok(failures.length === 0, failures.join('\n'));
});

test('values match the spec', () => {
  assert.deepEqual({
    board: base.board?.toUpperCase(),
    led: base.led?.toUpperCase(),
    pen: tracker.pen?.toUpperCase(),
    darkPaper: dark.paper?.toUpperCase(),
  }, {
    board: '#0B1320',
    led: '#FFC23D',
    pen: '#6B3FB5',
    darkPaper: '#131E2E',
  });
});

test('new properties are read with a fallback outside base.css', () => {
  for (const [path, css] of [['css/viewer.css', viewerCss], ['css/tracker.css', trackerCss]]) {
    const missingFallbacks = Array.from(css.matchAll(/\bvar\(\s*--([\w-]+)\s*\)/g), ([, name]) => name)
      .filter(name => newProperties.includes(name));
    assert.deepEqual(missingFallbacks, [], `${path} has new properties without fallbacks`);
  }
});

test('Sofia fonts are linked', () => {
  for (const path of ['index.html', 'track.html']) {
    const html = readSource(path);
    assert.ok(html.includes(`href="${sofiaUrl}"`), `${path} is missing the Sofia stylesheet URL`);
    assert.doesNotMatch(html, /Fira\+Sans/, path);
  }
});

test('viewer.css colours live in tokens', () => {
  const loose = viewerCss.split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /#[0-9a-f]{3,8}\b/i.test(line) && !/--[\w-]+\s*:/.test(line))
    .map(({ line, number }) => `${number}: ${line.trim()}`);
  assert.deepEqual(loose, [], 'hex colours outside a custom property declaration');
});
