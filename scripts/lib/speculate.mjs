/**
 * Searches run ahead on threads nothing else is using.
 *
 * A search that gives up starts again, from other starts, one after another
 * (the end of `inferSpreads`). Each of those starts is a pure function of the
 * inference's own inputs, so it can begin as soon as the inference does, on a
 * thread to spare, before anyone knows it will be needed. The inference itself
 * is unchanged: it still asks for one start at a time, in the same order, and
 * takes only the starts the sequential code would have run; a start that ran
 * ahead and was never asked for is stopped and counts nothing. What an
 * inference finds, and the work and limits it reports, therefore never depend
 * on how many threads ran it - only how long it took. A start not begun when
 * it is asked for, or one whose thread failed, runs where it is asked for.
 *
 * Threads to spare come from `spareThreads`: a count of this thread's own, and
 * a count shared with the pool the thread belongs to (`npm run score` frees one
 * each time a worker finds no case left). A start run ahead gets some of them
 * for the starts it runs ahead in turn, and gives them all back when it ends or
 * is stopped. This file is the threads' entry too.
 */

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

import { inferSpreads } from './inference/infer.mjs';
import { containsSpread } from './inference/knowledge.mjs';

const ROLE = 'speculative-start';
// How often an inference looks for threads freed since it began.
const LOOK_AGAIN_MS = 1000;

/**
 * Threads to spare: `own`, this thread's to use, and with `shared` (an
 * Int32Array over a SharedArrayBuffer, its first element the count) whatever
 * the pool that owns it frees. Pass it as `parallel` to `inferSpreads`.
 */
export function spareThreads({ own = 0, shared = null } = {}) {
  const active = new Set();
  const pool = {
    take() {
      if (own > 0) { own--; return 'own'; }
      if (!shared) return null;
      for (;;) {
        const n = Atomics.load(shared, 0);
        if (n <= 0) return null;
        if (Atomics.compareExchange(shared, 0, n, n - 1) === n) return 'shared';
      }
    },
    give(kind) {
      if (kind === 'own') own++;
      else if (kind === 'shared') Atomics.add(shared, 0, 1);
    },
    /** Begin `list`'s starts ahead, as threads allow: `[{ key, options, need }]`, in the order they would run. */
    ahead(list) {
      const handle = ahead(pool, list, !!shared);
      active.add(handle);
      handle.done = () => active.delete(handle);
      return handle;
    },
    /** Stop everything still running ahead - after an inference that threw. */
    release() {
      for (const handle of [...active]) handle.cancel();
    },
  };
  return pool;
}

/** What crosses to a thread: the options without what cannot be copied. */
function portable(options) {
  const { onProgress, parallel, ...rest } = options;
  return rest;
}

/** An inference's result as it crosses back: its membership tests are rebuilt on this side. */
function strip(res) {
  return { ...res, pokemon: res.pokemon.map(({ contains, ...p }) => p) };
}
function revive(res) {
  for (const p of res.pokemon) {
    const kn = res.knowledge.get(p.id);
    p.contains = evs => containsSpread(kn, evs);
  }
  return res;
}

function ahead(pool, list, growing) {
  const runs = list.map(x => ({ ...x, state: 'waiting', held: [], progress: [], sink: null }));
  let timer = null;

  const release = (run) => {
    for (const kind of run.held.splice(0)) pool.give(kind);
  };
  const finish = (run, res) => {
    if (run.state !== 'running') return;
    run.state = 'finished';
    run.worker.terminate();
    release(run);
    run.resolve(res);
  };
  const launch = (run, held) => {
    run.state = 'running';
    run.held = held;
    run.result = new Promise((resolve) => { run.resolve = resolve; });
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { role: ROLE, options: portable(run.options), own: held.length - 1 },
    });
    run.worker = worker;
    worker.on('message', (msg) => {
      if (msg.progress !== undefined) {
        if (run.sink) run.sink(msg.progress); else run.progress.push(msg.progress);
        return;
      }
      finish(run, msg.result ? revive(msg.result) : null);
    });
    worker.on('error', () => finish(run, null));
    worker.on('exit', () => finish(run, null));
  };
  const fill = () => {
    for (const run of runs) {
      if (run.state !== 'waiting') continue;
      const first = pool.take();
      if (!first) return;
      const held = [first];
      while (held.length <= run.need) {
        const more = pool.take();
        if (!more) break;
        held.push(more);
      }
      launch(run, held);
    }
    if (timer && runs.every(r => r.state !== 'waiting')) { clearInterval(timer); timer = null; }
  };

  fill();
  if (growing && runs.some(r => r.state === 'waiting')) {
    timer = setInterval(fill, LOOK_AGAIN_MS);
    timer.unref();
  }

  const handle = {
    /**
     * The start `key`'s result, from its thread, or null when it was not begun:
     * then the caller runs it, and it is never begun here. Its progress
     * messages are passed on in the order they came.
     */
    take(key) {
      const run = runs.find(r => r.key === key);
      if (!run || run.state === 'waiting') {
        if (run) run.state = 'here';
        return null;
      }
      const say = run.options.onProgress || (() => {});
      for (const m of run.progress.splice(0)) say(m);
      run.sink = say;
      return run.result.then(res => res ?? inferSpreads(run.options));
    },
    /** Stop every start still running ahead and give its threads back. */
    cancel() {
      if (timer) { clearInterval(timer); timer = null; }
      for (const run of runs) {
        if (run.state === 'waiting') run.state = 'cancelled';
        if (run.state !== 'running') continue;
        run.state = 'cancelled';
        run.worker.terminate();
        release(run);
        run.resolve(null);
      }
      handle.done?.();
    },
  };
  return handle;
}

if (!isMainThread && workerData?.role === ROLE) {
  const res = await inferSpreads({
    ...workerData.options,
    onProgress: m => parentPort.postMessage({ progress: m }),
    parallel: spareThreads({ own: workerData.own }),
  });
  parentPort.postMessage({ result: strip(res) });
}
