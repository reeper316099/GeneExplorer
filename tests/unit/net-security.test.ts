// Allowlist, https-only, header allowlist, redirect re-validation, external-link and path-traversal checks.
import { describe, expect, it } from 'vitest';
import { API_HOSTS } from '../../electron/allowlist';
import { checkExternalUrl } from '../../electron/external';
import { resolveAppPath } from '../../electron/paths';
import { sanitizeHeaders, validateUrl } from '../../electron/net';
import { URL1, makeClient } from '../helpers/harness';
import path from 'node:path';

describe('request validation', () => {
  it.each([
    ['http://rest.uniprot.org/x', 'blocked_host'],
    ['https://evil.example.com/x', 'blocked_host'],
    ['https://rest.uniprot.org.evil.com/x', 'blocked_host'],
    ['https://user:pw@rest.uniprot.org/x', 'blocked_host'],
    ['https://rest.uniprot.org:8443/x', 'blocked_host'],
    ['file:///etc/passwd', 'blocked_host'],
    ['not a url', 'invalid_request'],
  ])('rejects %s', async (url, kind) => {
    const { client, calls } = makeClient(() => ({}));
    await expect(client.request('x', { url, kind: 'json' })).rejects.toMatchObject({ app: { kind } });
    expect(calls).toHaveLength(0);
  });

  it('rejects a GET with a body', async () => {
    const { client } = makeClient(() => ({}));
    await expect(client.request('x', { url: URL1, body: 'x', kind: 'json' })).rejects.toMatchObject({
      app: { kind: 'invalid_request' },
    });
  });

  it('validateUrl accepts allowlisted hosts', () => {
    expect(validateUrl('https://rest.ensembl.org/info/ping').hostname).toBe('rest.ensembl.org');
  });
});

describe('headers', () => {
  it('drops non-allowlisted headers and always sends our own User-Agent', async () => {
    const { client, calls } = makeClient(() => ({}));
    await client.request('x', {
      url: URL1,
      kind: 'json',
      headers: {
        'User-Agent': 'attacker',
        Cookie: 'secret=1',
        Authorization: 'Bearer x',
        'Content-Type': 'application/json',
        Accept: 'text/plain',
      },
    });
    expect(calls[0]?.headers).toEqual({
      accept: 'text/plain',
      'content-type': 'application/json',
      'user-agent': 'GeneExplorer/test',
    });
    expect(sanitizeHeaders({ Cookie: 'a' })).toEqual({});
  });
});

describe('redirects', () => {
  it('follows a redirect to another allowlisted host', async () => {
    const { client, calls } = makeClient((c) =>
      c.url === URL1
        ? { status: 302, headers: { location: 'https://alphafold.ebi.ac.uk/final' } }
        : { body: '{"ok":1}' },
    );
    const r = await client.request('x', { url: URL1, kind: 'json' });
    expect(r.text).toBe('{"ok":1}');
    expect(calls.map((c) => c.url)).toEqual([URL1, 'https://alphafold.ebi.ac.uk/final']);
  });

  it('refuses a redirect to a host that is not allowlisted', async () => {
    const { client } = makeClient(() => ({
      status: 302,
      headers: { location: 'https://evil.example.com/steal' },
    }));
    await expect(client.request('x', { url: URL1, kind: 'json' })).rejects.toMatchObject({
      app: { kind: 'blocked_host' },
    });
  });

  it('refuses a redirect downgrade to http', async () => {
    const { client } = makeClient(() => ({
      status: 301,
      headers: { location: 'http://rest.uniprot.org/x' },
    }));
    await expect(client.request('x', { url: URL1, kind: 'json' })).rejects.toMatchObject({
      app: { kind: 'blocked_host' },
    });
  });
});

describe('allowlist policy', () => {
  it('keeps each host below its published/observed limit', () => {
    expect(API_HOSTS['api.ncbi.nlm.nih.gov']?.ratePerSec).toBeLessThanOrEqual(3); // NCBI: 5/s without a key
    expect(API_HOSTS['rest.ensembl.org']?.ratePerSec).toBeLessThanOrEqual(10); // Ensembl: ~15/s published
  });
});

describe('openExternal check', () => {
  it('allows https links to allowlisted hosts only', () => {
    expect(checkExternalUrl('https://www.ncbi.nlm.nih.gov/gene/7157').hostname).toBe('www.ncbi.nlm.nih.gov');
    for (const bad of [
      'http://www.ncbi.nlm.nih.gov/',
      'https://evil.example.com/',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://www.ncbi.nlm.nih.gov.evil.com/',
      'https://u:p@github.com/',
      'nonsense',
    ]) {
      expect(() => checkExternalUrl(bad), bad).toThrow();
    }
  });
});

describe('app:// path traversal', () => {
  const root = path.resolve('/app/dist');
  it('resolves normal paths', () => {
    expect(resolveAppPath(root, '/')).toBe(path.join(root, 'index.html'));
    expect(resolveAppPath(root, '/assets/a.js')).toBe(path.join(root, 'assets', 'a.js'));
  });

  it('never returns a path outside the dist folder, whatever the encoding', () => {
    for (const evil of [
      '/../secret',
      '/%2e%2e/secret',
      '/..%2fsecret',
      '/assets/..%2f..%2f..%2fetc/passwd',
      '/a/../../../b',
    ]) {
      const out = resolveAppPath(root, evil);
      // ".." segments are collapsed at the root, so the result is either rejected or still inside root
      expect(out === null || out.startsWith(root + path.sep), evil).toBe(true);
    }
  });

  it('rejects malformed input outright', () => {
    for (const bad of ['/a/%00b', '/..\\secret', '/%E0%A4%A'])
      expect(resolveAppPath(root, bad), bad).toBeNull();
  });
});
