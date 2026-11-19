// Tests for the DOM-free logic used by the UI: prefs storage, transcript choice, FASTA, scales, packing, time text.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseNcbiProducts } from '../../src/api/parse';
import { chooseTranscript, parseFasta } from '../../src/core/gene-view';
import { parseNcbiGeneId } from '../../src/shared/ids';
import type { TranscriptSet } from '../../src/shared/domain';
import { ago } from '../../src/ui/dom';
import { toFasta } from '../../src/ui/exports';
import { addRecent, DEFAULT_PREFS, entryKey, loadPrefs, savePrefs, toggleFavorite } from '../../src/ui/prefs';
import type { PrefEntry } from '../../src/ui/prefs';
import { structureStats } from '../../src/ui/svg/gene-structure';
import { fmtBp, niceLength, packRows } from '../../src/ui/svg/scale';
import { forced } from '../../src/ui/views/search';
import { fixtureJson, meta, need } from '../helpers/fixtures';

/** In-memory Storage stand-in. */
function memStorage(initial?: string): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set('geneexplorer.prefs.v1', initial);
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}
const entry = (id: string): PrefEntry => ({
  target: { kind: 'ncbi_gene', id },
  label: `G${id}`,
  sub: 'x',
  at: 1,
});

describe('prefs storage', () => {
  it('returns defaults when nothing is stored', () => {
    expect(loadPrefs(memStorage())).toEqual({ prefs: DEFAULT_PREFS, recovered: false });
  });
  it('round-trips valid prefs', () => {
    const s = memStorage();
    const p = { ...DEFAULT_PREFS, theme: 'dark' as const, recents: [entry('1')] };
    expect(savePrefs(p, s)).toBe(true);
    expect(loadPrefs(s)).toEqual({ prefs: p, recovered: false });
  });
  it('recovers from corrupt JSON, wrong shapes and hostile values, keeping a copy', () => {
    for (const bad of [
      '{not json',
      '[]',
      '{"version":2}',
      JSON.stringify({ ...DEFAULT_PREFS, theme: 'neon' }),
      JSON.stringify({
        ...DEFAULT_PREFS,
        recents: [{ target: { kind: 'ncbi_gene', id: 'x'.repeat(500) }, label: 'a', sub: 'b', at: 1 }],
      }),
    ]) {
      const s = memStorage(bad);
      const r = loadPrefs(s);
      expect(r.recovered).toBe(true);
      expect(r.prefs).toEqual(DEFAULT_PREFS);
      expect(s.data.get('geneexplorer.prefs.v1.corrupt')).toBe(bad);
    }
  });
  it('survives storage that throws', () => {
    const boom = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadPrefs(boom).prefs).toEqual(DEFAULT_PREFS);
    expect(savePrefs(DEFAULT_PREFS, boom)).toBe(false);
  });
  it('keeps recents unique, newest first and capped at 20', () => {
    let p = DEFAULT_PREFS;
    for (let i = 0; i < 30; i++) p = addRecent(p, entry(String(i)));
    expect(p.recents).toHaveLength(20);
    expect(p.recents[0]?.target.id).toBe('29');
    p = addRecent(p, entry('25'));
    expect(p.recents[0]?.target.id).toBe('25');
    expect(new Set(p.recents.map((r) => entryKey(r.target))).size).toBe(20);
  });
  it('toggles favorites on and off', () => {
    const on = toggleFavorite(DEFAULT_PREFS, entry('7'));
    expect(on.favorites).toHaveLength(1);
    expect(toggleFavorite(on, entry('7')).favorites).toHaveLength(0);
  });
});

describe('transcript choice and stats', () => {
  const id = need(parseNcbiGeneId('7157'));
  const set = (): TranscriptSet => {
    const r = parseNcbiProducts(fixtureJson('ncbi-product-tp53'), id, meta());
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };
  it('prefers MANE Select and says why', () => {
    const c = chooseTranscript(set());
    expect(set().value.transcripts[c.index]?.accession).toBe('NM_000546.6');
    expect(c.reason).toContain('MANE Select');
  });
  it('falls back to RefSeq Select, then longest with exons, then first', () => {
    const s = set();
    const noMane: TranscriptSet = {
      ...s,
      value: {
        ...s.value,
        transcripts: s.value.transcripts.map((t) => ({ ...t, selectCategory: undefined })),
      },
    };
    const c = chooseTranscript(noMane);
    expect(c.reason).toContain('Longest');
    const longest = Math.max(
      ...noMane.value.transcripts.filter((t) => t.exons.length).map((t) => t.length ?? 0),
    );
    expect(noMane.value.transcripts[c.index]?.length).toBe(longest);
    const none: TranscriptSet = {
      ...s,
      value: {
        ...s.value,
        transcripts: s.value.transcripts.map((t) => ({
          ...t,
          selectCategory: undefined,
          exons: [],
        })),
      },
    };
    expect(chooseTranscript(none)).toMatchObject({ index: 0 });
  });
  it('computes exon count, spliced length and span from coordinates', () => {
    const mane = set().value.transcripts.find((t) => t.selectCategory === 'MANE_SELECT');
    if (!mane) throw new Error('no mane');
    const st = structureStats(mane);
    expect(st?.exonCount).toBe(11);
    expect(st?.splicedLength).toBe(mane.exons.reduce((a, e) => a + e.end - e.begin + 1, 0));
    expect(st?.span).toBe(7687490 - 7668421 + 1);
    expect(structureStats({ ...mane, exons: [] })).toBeNull();
  });
});

describe('FASTA, scales, packing, time', () => {
  it('writes FASTA wrapped at 60 columns that parses back', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Z]{1,300}$/), (seq) => {
        const f = toFasta('hdr', seq);
        expect(
          f
            .split('\n')
            .slice(1)
            .filter(Boolean)
            .every((l) => l.length <= 60),
        ).toBe(true);
        expect(parseFasta(f)).toBe(seq);
      }),
    );
  });
  it('rejects bad FASTA', () => {
    expect(parseFasta('')).toBeNull();
    expect(parseFasta('no header\nMKV')).toBeNull();
    expect(parseFasta('>h\nMK1V')).toBeNull();
  });
  it('picks nice scale-bar lengths no longer than the maximum', () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 1e9, noNaN: true }), (m) => {
        const n = niceLength(m);
        expect(n).toBeLessThanOrEqual(m);
        expect(n).toBeGreaterThan(m / 5 - 1e-9);
        expect([1, 2, 5]).toContain(Number((n / 10 ** Math.floor(Math.log10(n))).toFixed(6)));
      }),
    );
    expect(fmtBp(500)).toBe('500 bp');
    expect(fmtBp(2500)).toBe('2.5 kb');
    expect(fmtBp(3_000_000)).toBe('3 Mb');
  });
  it('packs intervals into rows without overlaps within a row', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 1, max: 500 }), fc.integer({ min: 0, max: 100 })), {
          maxLength: 40,
        }),
        (raw) => {
          const items = raw.map(([a, len]) => ({ start: a, end: a + len }));
          const rows = packRows(items);
          for (let i = 0; i < items.length; i++)
            for (let j = i + 1; j < items.length; j++)
              if (rows[i] === rows[j]) {
                const a = items[i];
                const b = items[j];
                expect(a !== undefined && b !== undefined && (a.end < b.start || b.end < a.start)).toBe(true);
              }
        },
      ),
    );
  });
  it('words elapsed time plainly', () => {
    const now = 1_000_000_000_000;
    expect(ago(now - 5_000, now)).toBe('just now');
    expect(ago(now - 3 * 60_000, now)).toBe('3 minutes ago');
    expect(ago(now - 3_600_000, now)).toBe('1 hour ago');
    expect(ago(now - 3 * 86_400_000, now)).toBe('3 days ago');
  });
  it('forced identifier type rewrites only what is needed', () => {
    expect(forced('auto', ' TP53 ')).toBe('TP53');
    expect(forced('ncbi_gene', 'gene 7157')).toBe('GeneID:7157');
    expect(forced('ncbi_gene', '7157')).toBe('7157');
  });
});
