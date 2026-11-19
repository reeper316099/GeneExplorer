// Decide whether a URL may be opened in the system browser: https only, hostname on the external allowlist.
import { isExternalHost } from './allowlist';
import { NetError } from './net';

/** Returns the parsed URL if allowed; throws a typed NetError otherwise. */
export function checkExternalUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NetError({ kind: 'invalid_request', message: 'Not a valid URL.' });
  }
  if (url.protocol !== 'https:' || url.username || url.password || !isExternalHost(url.hostname)) {
    throw new NetError({
      kind: 'blocked_host',
      message: `Not allowed to open ${url.hostname || raw}.`,
      host: url.hostname,
    });
  }
  return url;
}
