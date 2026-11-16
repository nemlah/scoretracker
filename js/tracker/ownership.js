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

/**
 * Tracks a quiet takeover (the first touch on a device not in control, with no live game) while
 * its write is in flight. Control snapshots that were already on their way before the write was
 * issued carry the old holder; they must not undo the optimistic ownership the click that follows
 * depends on. The latest snapshot is remembered, so a refused takeover can show the real holder.
 */
export function createControlClaim() {
  let uid = null;
  let latest = null;
  return {
    get active() { return uid !== null; },
    /** Starts a claim; returns the control document to show at once. */
    begin(myUid, control) {
      uid = myUid;
      latest = control ?? null;
      return { ...(control ?? {}), activeUid: myUid };
    },
    /** The control document to show for an incoming snapshot. */
    receive(doc) {
      latest = doc;
      return uid !== null && doc?.activeUid !== uid ? { ...(doc ?? {}), activeUid: uid } : doc;
    },
    /** Ends the claim; returns the control document to show again after a refusal, else undefined. */
    end(succeeded) {
      uid = null;
      return succeeded ? undefined : latest;
    },
  };
}
