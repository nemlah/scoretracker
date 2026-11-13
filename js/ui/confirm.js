import { t } from '../strings.js';
import { h } from './dom.js';

export const CONFIRM_MS = 4000;

/**
 * An in-page confirm (the viewer blocks window.confirm): the first tap arms the button for a few
 * seconds and changes its label; a second tap while armed performs the action.
 */
export function createConfirmButton({ label, testid, className = '', onConfirm, ms = CONFIRM_MS }) {
  let armed = false;
  let timer = null;
  let baseLabel = label;
  const el = h('button', {
    type: 'button', class: `btn ${className}`.trim(), 'data-testid': testid, onclick: onClick,
  }, label);

  function disarm() {
    clearTimeout(timer);
    timer = null;
    armed = false;
    el.classList.remove('is-armed');
    el.textContent = baseLabel;
  }

  function onClick() {
    if (!armed) {
      armed = true;
      el.classList.add('is-armed');
      el.textContent = t('tapAgainToConfirm');
      timer = setTimeout(disarm, ms);
      return;
    }
    disarm();
    onConfirm();
  }

  return {
    el,
    disarm,
    setLabel(text) { baseLabel = text; if (!armed) el.textContent = text; },
    destroy() { clearTimeout(timer); timer = null; },
  };
}
