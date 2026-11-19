// CONTRACT TESTS: re-request every recorded URL from the live services and check the same parser still accepts the live
// answer and that its top-level keys have not drifted. These touch the network, so they are skipped unless
// GENEEXPLORER_LIVE=1 (run: npm run test:contract). They are polite: the real NetClient limits rates per host.
// Also prints a fixture age report so stale recordings are visible.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NetClient } from '../../electron/net';
import {
  parseAlphaFold,
  parseNcbiGenes,
  parseNcbiOrthologs,
  parseNcbiTaxon,
  parseNcbiTaxonSuggest,
  parseOrthoDbGroup,
  parseOrthoDbOrthologs,
  parseOrthoDbSearch,
  parseUniProtEntry,
  parseUniProtSearch,
  parseUniProtTaxonomy,
} from '../../src/api/parse';
import { parseOrthoDbGroupId, parseUniProtAccession } from '../../src/shared/ids';
import type { FetchMeta, IpcResult } from '../../src/shared/types';

interface Entry {
  name: string;
  url: string;
  file: string;
  recordedAt: string;
}
const DIR = path.resolve('tests/fixtures/api');
const entries = (JSON.parse(readFileSync(path.join(DIR, 'index.json'), 'utf8')) as { entries: Entry[] })
  .entries;
const LIVE = process.env['GENEEXPLORER_LIVE'] === '1';
const MAX_AGE_DAYS = 30;

const group = parseOrthoDbGroupId('742841at7742');
const p53 = parseUniProtAccession('P04637');
const lacz = parseUniProtAccession('P00722');
if (!group || !p53 || !lacz) throw new Error('ids');

/** Maps a fixture name to the parser that must accept both the recording and the live answer. */
const PARSERS: Record<string, (raw: unknown, m: FetchMeta) => IpcResult<unknown>> = {
  'uniprot-lacz-search': parseUniProtSearch,
  'uniprot-tp53-search': parseUniProtSearch,
  'uniprot-search-tp53-human': parseUniProtSearch,
  'uniprot-obsolete-deleted': parseUniProtEntry,
  'uniprot-obsolete-demerged': parseUniProtEntry,
  'uniprot-tp53-entry': parseUniProtEntry,
  'uniprot-taxonomy-zebrafish': parseUniProtTaxonomy,
  'ncbi-taxon-suggest-zebrafish': parseNcbiTaxonSuggest,
  'ncbi-taxon-human': (raw) => parseNcbiTaxon(raw),
  'ncbi-gene-ecoli-lacz': parseNcbiGenes,
  'ncbi-gene-arabidopsis-rbcl': parseNcbiGenes,
  'ncbi-gene-ecoli-strain-warning': parseNcbiGenes,
  'ncbi-gene-human-tp53': parseNcbiGenes,
  'ncbi-gene-symbol-tp53': parseNcbiGenes,
  'ncbi-gene-symbol-cox1-alias': parseNcbiGenes,
  'ncbi-orthologs-tp53': parseNcbiOrthologs,
  'alphafold-lacz': (raw, m) => parseAlphaFold(raw, lacz, m),
  'alphafold-tp53': (raw, m) => parseAlphaFold(raw, p53, m),
  'alphafold-insulin': (raw, m) => parseAlphaFold(raw, parseUniProtAccession('P01308') ?? p53, m),
  'orthodb-group-bacterial': parseOrthoDbGroup,
  'orthodb-search-tp53': parseOrthoDbSearch,
  'orthodb-orthologs-tp53': (raw, m) => parseOrthoDbOrthologs(raw, group, m),
};

describe('fixture age report', () => {
  it('prints every fixture with its age and flags old ones', () => {
    const now = Date.now();
    const lines = entries.map((e) => {
      const days = Math.floor((now - Date.parse(e.recordedAt)) / 86_400_000);
      return `${days > MAX_AGE_DAYS ? 'STALE' : 'ok   '} ${String(days).padStart(4)} d  ${e.name}`;
    });
    console.log(`Fixture age report (flag > ${MAX_AGE_DAYS} days):\n${lines.join('\n')}`);
    expect(entries.length).toBeGreaterThan(0);
  });
  it('has a parser registered for every JSON fixture (so none goes untested)', () => {
    const missing = entries
      .filter((e) => e.file.endsWith('.json') && !(e.name in PARSERS))
      .map((e) => e.name);
    expect(missing).toEqual([]);
  });
});

/** Top-level key set of a JSON value (arrays use their first element) for coarse drift detection. */
function topKeys(v: unknown): string[] {
  const o: unknown = Array.isArray(v) ? (v[0] as unknown) : v;
  return typeof o === 'object' && o !== null ? Object.keys(o).sort() : [];
}

describe.skipIf(!LIVE)('live contract (GENEEXPLORER_LIVE=1)', () => {
  const client = new NetClient({ fetchImpl: fetch, cache: null, userAgent: 'GeneExplorer-contract-tests' });
  for (const e of entries.filter((x) => x.file.endsWith('.json'))) {
    it(`live ${e.name} still matches the parser and key layout`, async () => {
      const live = await client.request(`contract-${e.name}`, { url: e.url, kind: 'json' });
      const meta: FetchMeta = {
        url: e.url,
        fetchedAt: Date.now(),
        fromCache: false,
        stale: false,
        bytes: live.meta.bytes,
      };
      const parser = PARSERS[e.name];
      if (!parser) throw new Error(`no parser for ${e.name}`);
      const liveJson = JSON.parse(live.text) as unknown;
      expect(parser(liveJson, meta).ok, `live ${e.name} failed the parser`).toBe(true);
      const recorded = JSON.parse(readFileSync(path.join(DIR, e.file), 'utf8')) as unknown;
      expect(topKeys(liveJson), `top-level keys drifted for ${e.name}`).toEqual(topKeys(recorded));
    }, 60_000);
  }
});
