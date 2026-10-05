/**
 * Node globals the reused `scripts/lib` code calls. Imported first by the Worker.
 *
 * `setImmediate` is what `scripts/lib/reconstruct.mjs` yields with while a probe
 * thread works. A `MessageChannel` post runs next without the 4 ms clamp a
 * nested `setTimeout(0)` gets, which a search yielding thousands of times feels.
 */

if (typeof globalThis.setImmediate !== 'function') {
  const channel = new MessageChannel();
  const queue = new Map();
  let next = 0;
  channel.port1.onmessage = (event) => {
    const task = queue.get(event.data);
    if (!task) return;
    queue.delete(event.data);
    task.fn(...task.args);
  };
  globalThis.setImmediate = (fn, ...args) => {
    const id = ++next;
    queue.set(id, { fn, args });
    channel.port2.postMessage(id);
    return id;
  };
  globalThis.clearImmediate = (id) => { queue.delete(id); };
}
