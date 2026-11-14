import { t } from './strings.js';
import { h } from './ui/dom.js';

export const CELEBRATION_MS = 2500;

// Splash droplets: left edge (%), sideways drift (vw), height reached (vh), delay (ms), size (rem), colour.
const DROPS = [
  [6, -5, 38, 80, 0.7, 'water'], [13, 4, 56, 220, 0.55, 'light'], [21, -3, 44, 140, 0.85, 'accent'],
  [29, 6, 64, 300, 0.6, 'water'], [37, -6, 50, 60, 0.7, 'light'], [44, 3, 70, 380, 0.9, 'water'],
  [52, -4, 58, 180, 0.6, 'accent'], [59, 5, 46, 260, 0.75, 'light'], [66, -6, 66, 100, 0.65, 'water'],
  [73, 4, 52, 340, 0.85, 'accent'], [80, -3, 60, 20, 0.6, 'water'], [86, 6, 42, 240, 0.7, 'light'],
  [92, -5, 54, 160, 0.8, 'water'], [97, 3, 36, 420, 0.55, 'accent'],
];

// A wavy crest, four periods wide so that sliding it by half its width loops seamlessly.
const WAVE_CREST = '<svg class="wave-crest" viewBox="0 0 800 40" preserveAspectRatio="none" aria-hidden="true">'
  + '<path d="M0 20 Q50 0 100 20 T200 20 T300 20 T400 20 T500 20 T600 20 T700 20 T800 20 V40 H0 Z"/></svg>';

// A yellow ball with curved blue panel stripes and dark seams.
const BALL = '<svg viewBox="-26 -26 52 52" aria-hidden="true"><defs><clipPath id="celebration-ball-clip">'
  + '<circle r="24"/></clipPath></defs><circle r="24" fill="#F2C200"/>'
  + '<g clip-path="url(#celebration-ball-clip)" fill="none" stroke-linecap="round">'
  + '<g stroke="#0B4F9C" stroke-width="5"><path d="M-28 -13 Q0 4 28 -13"/><path d="M-28 3 Q0 20 28 3"/></g>'
  + '<g stroke="#0E2238" stroke-width="1.2" opacity="0.7"><path d="M-7 -26 Q-15 0 -7 26"/><path d="M11 -26 Q19 0 11 26"/></g></g>'
  + '<path d="M-15 -13 Q-8 -19 2 -20" fill="none" stroke="#FFF6C2" stroke-width="2.5" stroke-linecap="round" opacity="0.85"/>'
  + '<circle r="24" fill="none" stroke="#0E2238" stroke-width="1.5"/></svg>';

// A goal: outlined white frame with a net of sagging cords.
function netMarkup() {
  const verticals = Array.from({ length: 11 }, (_, i) => `<path d="M${20 + i * 20} 8 V${i % 2 ? 104 : 106}"/>`).join('');
  const horizontals = Array.from({ length: 6 }, (_, i) => `<path d="M10 ${22 + i * 16} Q120 ${30 + i * 16} 230 ${22 + i * 16}"/>`).join('');
  return '<svg viewBox="0 0 240 120" aria-hidden="true">'
    + `<g class="net-mesh">${verticals}${horizontals}</g>`
    + '<path class="net-frame-edge" d="M10 112 V8 H230 V112"/>'
    + '<path class="net-frame" d="M10 112 V8 H230 V112"/></svg>';
}

const markup = html => {
  const holder = document.createElement('div');
  holder.innerHTML = html; // static, trusted markup
  return holder.firstElementChild;
};

export function createCelebration(host) {
  let timer = null;

  const goal = h('p', { class: 'celebration-goal', 'data-testid': 'celebration-goal' }, t('celebrateGoal'));
  const scorer = h('p', { class: 'celebration-scorer', 'data-testid': 'celebration-scorer', hidden: true });
  const banner = h('div', { class: 'celebration-banner', 'data-testid': 'celebration-banner' }, goal, scorer);
  const wave = h('div', { class: 'celebration-wave' },
    ...['back', 'front'].map(layer => h('div', { class: `wave-layer wave-${layer}` },
      markup(WAVE_CREST), h('div', { class: 'wave-fill' }))));
  const drops = DROPS.map(([left, drift, rise, delay, size, tone]) => {
    const drop = h('span', { class: `celebration-drop drop-${tone}` });
    drop.style.cssText = `--x:${left}%;--dx:${drift}vw;--rise:-${rise}vh;--delay:${delay}ms;--size:${size}rem`;
    return drop;
  });
  const scene = h('div', { class: 'celebration-scene' },
    h('div', { class: 'celebration-ball' }, markup(BALL)),
    h('div', { class: 'celebration-net' }, markup(netMarkup())));
  const overlay = h('div', {
    class: 'celebration', 'data-testid': 'celebration', 'aria-hidden': 'true', hidden: true,
  }, wave, ...drops, scene, banner);
  overlay.style.setProperty('--celebration-ms', `${CELEBRATION_MS}ms`);
  host.append(overlay);

  function hide() {
    clearTimeout(timer);
    timer = null;
    overlay.hidden = true;
    overlay.classList.remove('is-playing');
  }
  banner.addEventListener('click', hide);

  return {
    show({ scorer: scorerText, manUp }) {
      scorer.hidden = scorerText == null;
      scorer.textContent = scorerText == null ? ''
        : manUp ? t('celebrateManUp', { scorer: scorerText }) : scorerText;
      overlay.hidden = false;
      overlay.classList.remove('is-playing');
      void overlay.offsetWidth; // restart the animations
      overlay.classList.add('is-playing');
      clearTimeout(timer);
      timer = setTimeout(hide, CELEBRATION_MS);
    },
    hide,
    destroy() {
      hide();
      overlay.remove();
    },
  };
}
