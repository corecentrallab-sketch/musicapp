/**
 * historyWriteQueue.ts — ONE QUEUE FOR THE HISTORY BLOB (vc53, A5).
 *
 * ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
 *
 * All of History lives in ONE AsyncStorage value (`@notesnap/recognitionHistory`).
 * Five functions in `services/storage.ts` write it, and every one of them does the
 * same unguarded thing:
 *
 *     const history = await getRecognitionHistory();   // read the whole blob
 *     history[index] = …;                             // mutate the snapshot
 *     await AsyncStorage.setItem(KEY, JSON.stringify(history));  // write it back
 *
 * Between the read and the write there is an `await`, so the JS thread is free to
 * start another one of those five. When two overlap, the second write is made from
 * a snapshot taken BEFORE the first write: it puts the whole blob back and the first
 * write is gone. Nothing throws, nothing is logged, and the function that lost its
 * row has already returned success — which is exactly the pair of things the owner
 * saw on vc52: a take that is not in History, and no failure card (the save's own
 * read-back ran before the loss).
 *
 * A torn blob is the other face of the same race: two `setItem` calls interleaving
 * can leave a value that `JSON.parse` rejects, and `getRecognitionHistory` turns a
 * parse failure into `[]` — an empty History with no error anywhere.
 *
 * ── THE FIX ────────────────────────────────────────────────────────────────
 *
 * Every write to that key is appended to ONE module-level promise chain, so a
 * read→mutate→write can never interleave with another. The chain is not a lock the
 * caller has to remember to release: `enqueueHistoryWrite` returns the task's own
 * promise, and a task that throws still lets the next one run (a failed write must
 * never wedge History for the rest of the session).
 *
 * Pure module — no React Native imports, so the tier1 gate compiles and runs it.
 */

/** One read→mutate→write of the History blob. */
export type HistoryWriteTask<T> = () => Promise<T>;

/** The tail of the chain. Settles whether the last task resolved or rejected. */
let tail: Promise<unknown> = Promise.resolve();
/** How many tasks are queued or running (a test seam, and honest telemetry). */
let pending = 0;

function settle(): void {
  // Swallow the outcome: the chain's tail must never be a rejected promise, or
  // the next `then` would skip its task.
}

/**
 * Run `task` after every write already queued has finished. The returned promise
 * resolves/rejects with the task's own outcome, so a caller keeps its `try/catch`.
 */
export function enqueueHistoryWrite<T>(task: HistoryWriteTask<T>): Promise<T> {
  if (typeof task !== 'function') {
    return Promise.reject(new Error('enqueueHistoryWrite needs a function'));
  }
  pending += 1;
  // `tail.then(task, task)` runs the task after the previous one settles, and runs
  // it even when the previous one rejected.
  const run = tail.then(task, task);
  tail = run.then(settle, settle);
  return run.then(
    (value) => {
      pending -= 1;
      return value;
    },
    (error) => {
      pending -= 1;
      throw error;
    },
  );
}

/** How many History writes are queued or in flight right now. */
export function historyWritesPending(): number {
  return pending;
}

/** Resolves when the queue is empty (used by tests and by the save's own verify). */
export function historyWriteQueueIdle(): Promise<void> {
  return tail.then(settle, settle);
}
