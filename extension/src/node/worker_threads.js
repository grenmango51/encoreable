/**
 * `worker_threads` over Web Workers, for the probe pool in
 * `scripts/lib/reconstruct.mjs`.
 *
 * A pool worker is another copy of the simulator Worker, started from the same
 * blob URL. Node hands a new thread its `workerData` before any module runs;
 * here it rides in the Worker's `name`, which a worker can read synchronously
 * at start-up, so `isMainThread` and `workerData` are right when
 * `reconstruct.mjs` checks them at load.
 */

const ROLE = 'encoreable-thread:';
const inWorker = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
const ownName = inWorker ? self.name || '' : '';

export const isMainThread = !ownName.startsWith(ROLE);
export const workerData = isMainThread ? null : JSON.parse(ownName.slice(ROLE.length));

export const parentPort = isMainThread ? null : {
  on(event, fn) {
    if (event === 'message') self.addEventListener('message', e => fn(e.data));
  },
  postMessage(data) { self.postMessage(data); },
};

/** The URL this Worker was started from: the one bundle every thread runs. */
const OWN_URL = inWorker ? self.location.href : null;

export class Worker {
  constructor(_url, { workerData: data = null } = {}) {
    if (!OWN_URL) throw new Error('worker_threads: a thread can only be started from inside the simulator Worker');
    this.listeners = { message: [], error: [], exit: [] };
    this.worker = new globalThis.Worker(OWN_URL, { name: ROLE + JSON.stringify(data) });
    this.worker.onmessage = (e) => { for (const fn of this.listeners.message) fn(e.data); };
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'thread failed');
      for (const fn of this.listeners.error) fn(err);
    };
  }
  on(event, fn) {
    (this.listeners[event] || (this.listeners[event] = [])).push(fn);
    return this;
  }
  postMessage(data) { this.worker.postMessage(data); }
  terminate() {
    this.worker.terminate();
    for (const fn of this.listeners.exit) fn(1);
    return Promise.resolve(1);
  }
  // A page has no event loop to keep alive, so these have nothing to hold.
  ref() {}
  unref() {}
}

export default { isMainThread, workerData, parentPort, Worker };
