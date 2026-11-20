// Stroke icons for the viewer's timeline, on the 24 grid: 2 px stroke, round caps and joins, currentColor.
// Built with createElementNS, never innerHTML. Loaded on demand by viewer.js, which falls back to the
// glyph strings when this file is missing.
const SVG_NS = 'http://www.w3.org/2000/svg';

// Paths from the Tokens board. `goal` is the ball; `save` is the open hand, `excl` the stopwatch and `pen`
// the goal frame with the ball on the penalty spot.
const PATHS = {
  goal: 'M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0M3.6 9.4c5.2 1.3 11.6 1.3 16.8 0M3.6 14.6c5.2-1.3 11.6-1.3 16.8 0M12 3c-3.2 4.5-3.2 13.5 0 18',
  save: 'M7 12V6.5a1.5 1.5 0 0 1 3 0V11M10 11V4.5a1.5 1.5 0 0 1 3 0V11M13 11V5.5a1.5 1.5 0 0 1 3 0V12M16 12V8.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5.2-3L4 14.2a1.5 1.5 0 0 1 2.6-1.5L7 13.5',
  excl: 'M20 13a8 8 0 1 1-16 0a8 8 0 1 1 16 0M12 13V9M10 2h4',
  pen: 'M3 19V6h18v13M14 15a2 2 0 1 1-4 0a2 2 0 1 1 4 0',
};

export function icon(name, doc = document) {
  if (!Object.hasOwn(PATHS, name)) throw new Error(`Unknown icon: ${name}`);
  const svg = doc.createElementNS(SVG_NS, 'svg');
  for (const [attribute, value] of [['viewBox', '0 0 24 24'], ['width', '18'], ['height', '18'], ['fill', 'none'],
    ['stroke', 'currentColor'], ['stroke-width', '2'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'],
    ['aria-hidden', 'true']]) svg.setAttribute(attribute, value);
  const shape = doc.createElementNS(SVG_NS, 'path');
  shape.setAttribute('d', PATHS[name]);
  svg.append(shape);
  return svg;
}
