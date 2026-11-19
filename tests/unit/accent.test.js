import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accentPair, applyAccentPair, contrastRatio, openMarker } from '../../js/accent.js';

const board = '#0b1320';
const white = '#ffffff';
const clubColours = [
  ['#0057b8', white],
  ['#c8102e', white],
  ['#00843d', white],
  ['#f2b705', board],
];

test('contrastRatio gives 21 for black and white and 1 for identical colours', () => {
  assert.ok(Math.abs(contrastRatio('#ffffff', '#000000') - 21) <= 0.01);
  assert.equal(contrastRatio(board, board), 1);
});

test('hex colours are case-insensitive and accentPair returns lowercase hex', () => {
  assert.equal(contrastRatio('#F2B705', '#0B1320'), contrastRatio('#f2b705', board));
  assert.deepEqual(accentPair('#F2B705'), { onAccent: board, accentOnBoard: '#f2b705' });
});

for (const [accent, expectedText] of clubColours) {
  test(`onAccent picks the higher-contrast text colour for ${accent}`, () => {
    const { onAccent } = accentPair(accent);
    const otherText = expectedText === white ? board : white;
    assert.equal(onAccent, expectedText);
    assert.ok(contrastRatio(onAccent, accent) > contrastRatio(otherText, accent));
  });

  test(`accentOnBoard clears 3:1 for ${accent}`, () => {
    assert.ok(contrastRatio(accentPair(accent).accentOnBoard, board) >= 3);
  });
}

test('accentOnBoard leaves yellow unchanged', () => {
  assert.equal(accentPair('#f2b705').accentOnBoard, '#f2b705');
});

test('accentOnBoard uses the first 5% step that clears 3:1 for blue', () => {
  const blue = '#0057b8';
  const { accentOnBoard } = accentPair(blue);
  assert.equal(accentOnBoard, '#1a68bf'); // 10% white
  assert.ok(contrastRatio(accentOnBoard, board) > contrastRatio(blue, board));
  assert.ok(contrastRatio('#0d5fbc', board) < 3); // 5% white
});

test('accentPair preserves a non-hex CSS colour and uses white text', () => {
  assert.deepEqual(accentPair('blue'), { onAccent: '#ffffff', accentOnBoard: 'blue' });
});

const recorder = () => {
  const calls = [];
  return { calls, style: { setProperty: (name, value) => calls.push([name, value]) } };
};

test('applyAccentPair sets the CSS custom properties', () => {
  const { calls, style } = recorder();

  applyAccentPair(style, '#0057b8');

  assert.deepEqual(calls, [
    ['--on-accent', '#ffffff'],
    ['--accent-on-board', accentPair('#0057b8').accentOnBoard],
    ['--accent-open-light', openMarker('#0057b8', 'light')],
    ['--accent-open-dark', openMarker('#0057b8', 'dark')],
  ]);
});

test('applyAccentPair leaves a non-hex colour to the CSS fallbacks for the open-row marker', () => {
  const { calls, style } = recorder();
  applyAccentPair(style, 'blue');
  assert.deepEqual(calls.map(([name]) => name), ['--on-accent', '--accent-on-board']);
});

test('applyAccentPair writes nothing for a missing or non-string accent', () => {
  for (const accent of [undefined, null, 7, {}, '']) {
    const { calls, style } = recorder();
    applyAccentPair(style, accent);
    assert.deepEqual(calls, [], `accent ${JSON.stringify(accent)}`);
  }
});

// The selected result row is the page surface with 8% of the club colour in it (css/viewer.css, color-mix in sRGB).
// The surfaces are written out here, not read from accent.js, so a wrong constant there fails this test.
const surfaces = { light: '#ffffff', dark: '#131e2e' };
function rowFill(accent, scheme) {
  const channel = (hex, at) => parseInt(hex.slice(at, at + 2), 16);
  const mixed = [1, 3, 5].map(at => Math.round(channel(surfaces[scheme], at) * 0.92 + channel(accent, at) * 0.08));
  return `#${mixed.map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

for (const scheme of ['light', 'dark']) {
  for (const [accent] of clubColours) {
    test(`the open-row marker for ${accent} clears 3:1 on the selected row in ${scheme}`, () => {
      const marker = openMarker(accent, scheme);
      assert.match(marker, /^#[0-9a-f]{6}$/);
      assert.ok(contrastRatio(marker, rowFill(accent, scheme)) >= 3, `${marker} on ${rowFill(accent, scheme)}`);
    });
  }
}

test('the open-row marker keeps the club colour where it already clears 3:1', () => {
  assert.equal(openMarker('#0057b8', 'light'), '#0057b8');
  assert.equal(openMarker('#f2b705', 'dark'), '#f2b705');
  // And the raw colours that fail (the review's numbers) are changed.
  assert.notEqual(openMarker('#f2b705', 'light'), '#f2b705');
  assert.notEqual(openMarker('#0057b8', 'dark'), '#0057b8');
  assert.notEqual(openMarker('#c8102e', 'dark'), '#c8102e');
});
