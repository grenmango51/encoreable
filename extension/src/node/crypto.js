/** `crypto.randomBytes`, for `freshSeed` in `scripts/lib/truncate.mjs`, over Web Crypto. */

export function randomBytes(n) {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return {
    length: n,
    toString(encoding) {
      if (encoding !== 'hex') throw new Error('randomBytes: only hex output is available in the extension');
      return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    },
  };
}

export default { randomBytes };
