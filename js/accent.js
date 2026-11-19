const BOARD = '#0b1320';
const WHITE = '#ffffff';

function channels(hex) {
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
}

function luminance(hex) {
  const [red, green, blue] = channels(hex).map(channel => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(a, b) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function mix(a, b, t) {
  const end = channels(b);
  const mixed = channels(a).map((channel, i) => Math.round(channel * (1 - t) + end[i] * t));
  return `#${mixed.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function accentPair(accent) {
  if (typeof accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(accent)) {
    return { onAccent: WHITE, accentOnBoard: accent };
  }

  const onAccent = contrastRatio(accent, WHITE) >= contrastRatio(accent, BOARD) ? WHITE : BOARD;
  let accentOnBoard = accent.toLowerCase();
  // Step 20 is white, which always clears 3:1 on the board.
  for (let step = 1; contrastRatio(accentOnBoard, BOARD) < 3; step++) {
    accentOnBoard = mix(accent, WHITE, step / 20);
  }
  return { onAccent, accentOnBoard };
}

export function applyAccentPair(style, accent) {
  const { onAccent, accentOnBoard } = accentPair(accent);
  style.setProperty('--on-accent', onAccent);
  style.setProperty('--accent-on-board', accentOnBoard);
}
