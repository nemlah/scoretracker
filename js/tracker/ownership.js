/**
 * Classifies refused writes. A permission-denied can mean the code was changed (this device is
 * no longer an editor) or that another device took over; the local state cannot tell them apart
 * because a rejection may arrive before the ownership snapshot. The server decides.
 * @param {Object} deps
 * @param {() => {active: boolean, uid: string|null}} deps.getState
 * @param {() => Promise<{activeUid?: string}|null>} deps.readControl control document from the server
 * @param {() => void} deps.onRevoked
 * @param {(err: unknown) => void} deps.onFailure
 */
export function createWriteErrorHandler({ getState, readControl, onRevoked, onFailure }) {
  let checking = false;

  async function confirmRevocation() {
    if (checking) return;
    checking = true;
    try {
      const control = await readControl();
      // Someone else holds control: the takeover banner explains the refusal.
      if (control?.activeUid !== getState().uid) return;
      onRevoked();
    } catch {
      // Offline: the next refused write checks again.
    } finally {
      checking = false;
    }
  }

  return function onWriteError(err) {
    if (err?.code === 'permission-denied') {
      // Not active: the takeover banner already explains why the write was refused.
      if (getState().active) confirmRevocation();
      return;
    }
    onFailure(err);
  };
}
