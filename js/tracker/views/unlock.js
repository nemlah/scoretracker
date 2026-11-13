import { t } from '../../strings.js';
import { h } from '../../ui/dom.js';

const CODE_LENGTH = 6;
const cleanCode = value => value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, CODE_LENGTH);

export function mount(root, ctx) {
  let busy = false;
  let submitError = null;

  const input = h('input', {
    id: 'tracker-code',
    class: 'input input--code',
    type: 'text',
    inputmode: 'text',
    autocapitalize: 'characters',
    autocomplete: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    enterkeyhint: 'go',
    maxlength: CODE_LENGTH,
    'aria-describedby': 'tracker-code-help tracker-code-error',
    'data-testid': 'code-input',
    oninput: () => {
      input.value = cleanCode(input.value);
      submitError = null;
      sync();
    },
  });
  const button = h('button', { type: 'submit', class: 'btn btn--primary', 'data-testid': 'unlock-btn' }, t('unlockButton'));
  const notice = h('p', { class: 'notice', 'data-testid': 'unlock-notice' });
  const error = h('p', { id: 'tracker-code-error', class: 'form-error', role: 'alert', 'data-testid': 'unlock-error' });
  const form = h('form', { class: 'unlock-form', novalidate: true, onsubmit: submit },
    h('label', { for: 'tracker-code' }, t('unlockLabel')),
    input,
    h('p', { id: 'tracker-code-help', class: 'help' }, t('unlockHelp')),
    error,
    button,
  );
  root.append(h('section', { class: 'unlock' }, h('h2', {}, t('unlockHeading')), notice, form));

  function sync() {
    const offline = ctx.getState().online === false;
    const message = submitError ?? (offline ? t('unlockNeedsConnection') : null);
    error.textContent = message ?? '';
    error.hidden = message === null;
    const state = ctx.getState();
    notice.textContent = state.notice ?? '';
    notice.hidden = state.notice === null;
    button.disabled = busy || input.value.length !== CODE_LENGTH;
    button.textContent = busy ? t('unlockWorking') : t('unlockButton');
  }

  async function submit(event) {
    event.preventDefault();
    const code = input.value;
    if (busy || code.length !== CODE_LENGTH) return;
    // Offline, sync() already shows the connection message; never attempt the write.
    if (!ctx.getState().online) return;
    busy = true;
    submitError = null;
    sync();
    try {
      await ctx.repo.unlock(ctx.getState().uid, code);
    } catch (err) {
      submitError = err?.code === 'permission-denied' ? t('unlockWrongCode')
        : err?.code === 'unavailable' ? t('unlockNeedsConnection')
          : t('unlockFailed');
    }
    busy = false;
    sync();
  }

  sync();
  input.focus();
  // The input and form are never rebuilt, so typing is not disturbed by updates.
  return { update: sync, unmount() { root.replaceChildren(); } };
}
