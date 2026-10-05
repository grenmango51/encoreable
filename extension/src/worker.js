/**
 * Worker entry. The page starts this file as a blob Worker (play.pokemonshowdown.com
 * sends no Content-Security-Policy - `docs/extension.md` P2) and talks to it with
 * `{ id, method, args }` requests.
 *
 * Replies are `{ id, result }` or `{ id, error }`. Pushes the worker makes on its
 * own carry no `id` and a `push` name instead.
 *
 * The same file is also every reconstruction probe thread
 * (`node/worker_threads.js`). A thread is served by `scripts/lib/reconstruct.mjs`
 * itself, so it takes no requests here.
 */

import './node/globals.js';
import { isMainThread } from './node/worker_threads.js';
import { methods } from './engine.js';

if (isMainThread) {
  self.onmessage = async (event) => {
    const { id, method, args = [] } = event.data || {};
    const fn = methods[method];
    if (!fn) {
      self.postMessage({ id, error: `unknown method "${method}"` });
      return;
    }
    try {
      self.postMessage({ id, result: await fn(...args) });
    } catch (err) {
      self.postMessage({ id, error: String((err && err.stack) || err) });
    }
  };
  self.postMessage({ push: 'ready' });
}
