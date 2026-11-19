import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accentPair, contrastRatio } from '../../js/accent.js';

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
