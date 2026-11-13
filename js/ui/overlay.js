import { t } from '../strings.js';
import { h } from './dom.js';

// Open overlays, topmost last. Only the topmost one answers Escape and Tab.
const stack = [];
let titleCounter = 0;
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

function focusables(panel) {
  return [...panel.querySelectorAll(FOCUSABLE)]
    .filter(el => !el.disabled && !el.hidden && el.getClientRects().length > 0);
}

function onKeydown(event) {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    top.close();
  } else if (event.key === 'Tab') {
    top.trapTab(event);
  }
}

/**
 * A modal dialog over the page: focus moves into it, Tab stays inside, Escape and the Close
 * button dismiss it, and focus returns to whatever opened it.
 */
export function createOverlay({ title, testid, closeTestId, raised = false, onClose = () => {} }) {
  titleCounter += 1;
  const titleId = `overlay-title-${titleCounter}`;
  const body = h('div', { class: 'sheet-body' });
  const closeButton = h('button', {
    type: 'button', class: 'btn btn--small btn--ghost', 'data-testid': closeTestId, onclick: () => api.close(),
  }, t('sheetClose'));
  const panel = h('div', {
    class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1', 'data-testid': testid,
  }, h('div', { class: 'sheet-head' }, h('h2', { id: titleId }, title), closeButton), body);
  const el = h('div', { class: raised ? 'sheet-backdrop sheet-backdrop--raised' : 'sheet-backdrop', hidden: true }, panel);
  // A press on the dimmed area (not on the panel) dismisses it.
  el.addEventListener('click', event => { if (event.target === el) api.close(); });
  let opener = null;

  const api = {
    el,
    body,
    isOpen: () => !el.hidden,
    // `from` is the control that asked for the dialog: Safari does not focus a button on tap,
    // so document.activeElement cannot be relied on to find the way back.
    open(from = document.activeElement) {
      if (!el.hidden) return;
      opener = from;
      el.hidden = false;
      stack.push(api);
      document.body.classList.add('sheet-open');
      document.addEventListener('keydown', onKeydown); // the same function twice is one listener
      panel.focus();
    },
    close() {
      if (el.hidden) return;
      el.hidden = true;
      const index = stack.indexOf(api);
      if (index >= 0) stack.splice(index, 1);
      if (stack.length === 0) {
        document.body.classList.remove('sheet-open');
        document.removeEventListener('keydown', onKeydown);
      }
      if (opener?.isConnected) opener.focus();
      opener = null;
      onClose();
    },
    trapTab(event) {
      const items = focusables(panel);
      if (items.length === 0) { event.preventDefault(); panel.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
      else if (!panel.contains(active)) { event.preventDefault(); first.focus(); }
    },
    // Removes the dialog without returning focus, for when its screen is going away.
    destroy() {
      const index = stack.indexOf(api);
      if (index >= 0) stack.splice(index, 1);
      if (stack.length === 0) {
        document.body.classList.remove('sheet-open');
        document.removeEventListener('keydown', onKeydown);
      }
      el.remove();
    },
  };
  return api;
}
