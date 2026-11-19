// Map an app:// URL path to a file inside the dist folder, rejecting anything that escapes it (path traversal).
import path from 'node:path';

/** Returns an absolute file path inside `root`, or null if the request is malformed or tries to leave `root`. */
export function resolveAppPath(root: string, urlPathname: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPathname); // decode first so %2e%2e and %2f cannot hide a ".."
  } catch {
    return null;
  }
  if (rel.includes('\0') || rel.includes('\\')) return null;
  const clean = path.posix.normalize('/' + (rel === '/' ? 'index.html' : rel));
  const file = path.resolve(root, '.' + clean);
  return file === root || file.startsWith(root + path.sep) ? file : null;
}
