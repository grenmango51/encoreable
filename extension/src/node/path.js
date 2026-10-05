/**
 * POSIX `path`, enough of it for the simulator's `path.resolve(__dirname, ...)`
 * and for `scripts/lib`. Paths are virtual (`/ps/sim/...`); there is no cwd, so
 * a relative `resolve` is taken from `/`.
 */

function normalizeParts(parts) {
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out;
}

const slashes = p => String(p).replace(/\\/g, '/');

export const sep = '/';
export const delimiter = ':';

export function normalize(p) {
  const s = slashes(p);
  const lead = s.startsWith('/') ? '/' : '';
  return lead + normalizeParts(s.split('/')).join('/') || (lead || '.');
}

export function resolve(...segments) {
  let joined = '';
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = slashes(segments[i]);
    if (!s) continue;
    joined = joined ? `${s}/${joined}` : s;
    if (s.startsWith('/')) break;
  }
  return `/${normalizeParts(joined.split('/')).join('/')}`;
}

export function join(...segments) {
  const joined = segments.map(slashes).filter(Boolean).join('/');
  return joined ? normalize(joined) : '.';
}

export function dirname(p) {
  const s = slashes(p);
  const i = s.lastIndexOf('/');
  if (i < 0) return '.';
  return i === 0 ? '/' : s.slice(0, i);
}

export function basename(p, ext) {
  let base = slashes(p).split('/').pop();
  if (ext && base.endsWith(ext) && base !== ext) base = base.slice(0, -ext.length);
  return base;
}

export function extname(p) {
  const base = basename(p);
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i) : '';
}

export function isAbsolute(p) {
  return slashes(p).startsWith('/');
}

export function relative(from, to) {
  const a = resolve(from).split('/').filter(Boolean);
  const b = resolve(to).split('/').filter(Boolean);
  while (a.length && b.length && a[0] === b[0]) { a.shift(); b.shift(); }
  return a.map(() => '..').concat(b).join('/');
}

const api = { sep, delimiter, normalize, resolve, join, dirname, basename, extname, isAbsolute, relative };
export const posix = api;
export default { ...api, posix: api };
