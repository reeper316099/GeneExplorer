// Printable gene report (PDF). The report is built as a normal page section (.report-sheet) that print CSS shows alone;
// the main process then calls printToPDF. It contains everything the user saw, with provenance, citations and the disclaimer.
import { compareFields, STATUS_LABEL } from '../../core/compare-table';
import type { CompareSubject } from '../../core/compare-table';
import { chooseTranscript } from '../../core/gene-view';
import type { GeneView } from '../../core/gene-view';
import type { OrthologState } from '../../core/ortholog-state';
import { coverageStatement, summarize } from '../../core/ortholog-table';
import { structureNote } from '../../core/compare';
import type { Transcript } from '../../shared/domain';
import { fmt, fmtTime, h } from '../dom';
import { chromosomeMapSvg } from '../svg/chromosome-map';
import { FEATURE_STYLES } from '../svg/feature-track';
import { geneStructureSvg, structureStats } from '../svg/gene-structure';
import { StructureViewer } from '../viewer3d';
import type { CompareHub } from './compare';

export interface ReportInput {
  view: GeneView;
  ortho: OrthologState;
  hub: CompareHub;
  appVersion: string;
}

/** Renders the structure off-screen and returns it as a PNG data URL, or null if 3D is unavailable. */
async function structureImage(pdb: string): Promise<string | null> {
  const host = h('div', { style: 'position:fixed;left:-10000px;top:0;width:640px;height:420px' });
  const inner = h('div', { style: 'position:absolute;inset:0' });
  host.append(inner);
  document.body.append(host);
  const v = new StructureViewer(inner, { onResidueClick: () => undefined });
  try {
    await v.load(pdb);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const b64 = v.png();
    return b64 ? `data:image/png;base64,${b64}` : null;
  } catch {
    return null;
  } finally {
    v.dispose();
    host.remove();
  }
}

/** Builds the report element (not yet attached to the page). */
export async function buildReport(inp: ReportInput): Promise<HTMLElement> {
  const { view, ortho, hub } = inp;
  const g = view.gene;
  const p = view.protein;
  const sheet = h('div', { class: 'report-sheet' });
  const symbol = g?.value.symbol ?? p?.value.geneNames.primary ?? p?.value.accession ?? 'Gene';
  const taxon = g?.value.taxon ?? p?.value.taxon;
  const sec = (title: string, ...kids: (Node | string | null)[]): HTMLElement =>
    h('section', { class: 'rep-sec' }, h('h2', {}, title), ...kids);
  const kv = (rows: [string, string | null][]): HTMLElement => {
    const dl = h('dl', { class: 'kv' });
    for (const [k, v] of rows) dl.append(h('dt', {}, k), h('dd', {}, v ?? 'not available'));
    return dl;
  };

  sheet.append(
    h(
      'header',
      {},
      h('h1', {}, `${symbol}: gene report`),
      h(
        'p',
        {},
        `${g?.value.description || p?.value.proteinName || ''} · ${taxon?.scientificName ?? ''}${taxon?.commonName ? ` (${taxon.commonName})` : ''}`,
      ),
      h(
        'p',
        { class: 'muted' },
        `Created ${new Date().toLocaleString()} by GeneExplorer ${inp.appVersion}. Educational use only; not medical advice.`,
      ),
    ),
    sec(
      'Overview',
      kv([
        ['Official symbol', g?.value.symbol ?? null],
        ['Official name', g?.value.description || null],
        ['Aliases', g?.value.synonyms.join(', ') || null],
        ['Gene type', g?.value.type ?? null],
        ['NCBI Gene ID', g?.value.geneId ?? null],
        [
          'UniProt',
          p
            ? `${p.value.accession} (${p.value.reviewed ? 'reviewed' : 'unreviewed, automatic annotation'})`
            : null,
        ],
      ]),
      g?.value.summary ? h('p', {}, h('strong', {}, 'Summary (NCBI Gene): '), g.value.summary) : null,
      p?.value.functionText
        ? h('p', {}, h('strong', {}, 'Function (UniProt): '), p.value.functionText)
        : null,
    ),
  );

  // Location
  const loc = g?.value.locations[0];
  const locKids: (Node | string | null)[] = [];
  if (loc && g) {
    locKids.push(
      kv([
        ['Sequence', `${loc.sequenceName || 'unnamed'} · ${loc.sequenceAccession}`],
        ['Map location', g.value.mapLocations.map((m) => m.value).join(', ') || null],
        ['Assembly', `${loc.assemblyName} (${loc.assemblyAccession})`],
        [
          'Coordinates (1-based, inclusive)',
          `${fmt(loc.begin)} - ${fmt(loc.end)} (${fmt(loc.end - loc.begin + 1)} bp)`,
        ],
        ['Strand', loc.strand],
      ]),
    );
    if (view.sequence.status === 'ready' && view.sequence.data) {
      locKids.push(
        chromosomeMapSvg({
          name: view.sequence.data.name,
          length: view.sequence.data.length,
          begin: loc.begin,
          end: loc.end,
          moleculeType: view.sequence.data.moleculeType,
        }),
      );
    }
    if (view.transcripts.status === 'ready') {
      const set = view.transcripts.data;
      const t: Transcript | undefined = set.value.transcripts[chooseTranscript(set).index];
      const svg = t ? geneStructureSvg(t) : null;
      const st = t ? structureStats(t) : null;
      if (svg && t)
        locKids.push(
          svg,
          h(
            'p',
            {},
            `Transcript ${t.accession}: ${st?.exonCount ?? 0} exons, spliced length ${fmt(st?.splicedLength ?? 0)} bp.`,
          ),
        );
    }
  } else locKids.push('Genomic location not available.');
  sheet.append(sec('Location', ...locKids));

  // Protein and structure
  const protKids: (Node | string | null)[] = [];
  if (p) {
    const doms = p.value.features.filter((f) => f.type === 'Domain');
    protKids.push(
      kv([
        ['Accession', p.value.accession],
        ['Length', `${fmt(p.value.sequenceLength)} amino acids`],
        ['Subcellular location', p.value.subcellularLocations.join(', ') || null],
        ['GO terms', `${p.value.go.length} (${p.value.go.filter((x) => x.automatic).length} automatic)`],
      ]),
    );
    if (doms.length)
      protKids.push(
        h(
          'p',
          {},
          h('strong', {}, 'Domains: '),
          doms
            .map((d) => `${d.description || FEATURE_STYLES['Domain']?.label} (${d.start}-${d.end})`)
            .join('; '),
        ),
      );
    if (view.structure.status === 'ready') {
      const m = view.structure.data.models[view.structure.data.selected];
      const img = await structureImage(view.structure.data.pdb);
      if (m)
        protKids.push(
          h(
            'p',
            {},
            structureNote(m.value.meanPlddt),
            ` Model ${m.recordId}, v${m.value.modelVersion}, created ${m.value.createdDate.slice(0, 10)}.`,
          ),
        );
      if (img)
        protKids.push(
          h('img', {
            src: img,
            alt: 'AlphaFold structure coloured by pLDDT',
            style: 'max-width:100%;height:auto;border:1px solid #ccc',
          }),
        );
      protKids.push(
        h(
          'p',
          {},
          'pLDDT colours: blue above 90 (very high), light blue 70-90 (confident), yellow 50-70 (low), orange below 50 (very low).',
        ),
      );
    } else protKids.push(h('p', {}, 'Structure: not available or not loaded.'));
  } else protKids.push('No UniProt protein linked.');
  sheet.append(sec('Protein and structure', ...protKids));

  // Orthologs
  const orthKids: (Node | string | null)[] = [];
  for (const [name, st] of [
    ['NCBI Orthologs', ortho.ncbi],
    ['OrthoDB', ortho.orthodb],
  ] as const) {
    if (st.status === 'ready') {
      const sum = summarize(st.data.rows);
      orthKids.push(
        h(
          'p',
          {},
          h('strong', {}, `${name}: `),
          `${fmt(sum.species)} species in ${sum.cladeCount} lineage groups. ${coverageStatement(st.data.rows)} Fetched ${fmtTime(st.data.fetchedAt)}.`,
        ),
      );
    } else
      orthKids.push(
        h(
          'p',
          {},
          h('strong', {}, `${name}: `),
          'not loaded when this report was made (open the Species tab first).',
        ),
      );
  }
  orthKids.push(
    h(
      'p',
      { class: 'muted' },
      'Orthology is inferred, sources can disagree, and no call in a source does not mean the species lacks the gene. Sources are never merged.',
    ),
  );
  sheet.append(sec('Orthologs (by source)', ...orthKids));

  // Comparison
  if (hub.b) {
    const bv = hub.b.view;
    const subj = (v: GeneView): CompareSubject => {
      const tr = v.transcripts.status === 'ready' ? v.transcripts.data : null;
      return {
        gene: v.gene,
        protein: v.protein,
        transcript: tr ? (tr.value.transcripts[chooseTranscript(tr).index] ?? null) : null,
        structure:
          v.structure.status === 'ready'
            ? (v.structure.data.models[v.structure.data.selected] ?? null)
            : null,
      };
    };
    const rows = compareFields(subj(view), subj(bv));
    const table = h(
      'table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', {}, 'Field'),
          h('th', {}, `A: ${symbol}`),
          h('th', {}, `B: ${hub.b.label}`),
          h('th', {}, 'Status'),
        ),
      ),
    );
    const tb = h('tbody');
    for (const r of rows)
      tb.append(
        h(
          'tr',
          {},
          h('td', {}, r.field),
          h('td', {}, r.a ?? 'not available'),
          h('td', {}, r.b ?? 'not available'),
          h('td', {}, STATUS_LABEL[r.status].text),
        ),
      );
    table.append(tb);
    const al = hub.alignment?.result.ok ? hub.alignment.result.alignment : null;
    sheet.append(
      sec(
        `Comparison with ${hub.b.label}`,
        table,
        al
          ? h(
              'p',
              {},
              `Protein alignment: identity ${al.identity.overAligned === null ? 'n/a' : (al.identity.overAligned * 100).toFixed(1)}% over ${fmt(al.stats.alignedColumns)} aligned positions (${fmt(al.stats.identities)} identical); computed by the app's own aligner. Orthology is inferred; differences may reflect real biology, annotation quality or isoform choice.`,
            )
          : null,
      ),
    );
  }

  // Provenance
  const prov = h(
    'table',
    {},
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', {}, 'Record'),
        h('th', {}, 'Database'),
        h('th', {}, 'ID'),
        h('th', {}, 'Fetched'),
        h('th', {}, 'Request'),
      ),
    ),
  );
  const pb = h('tbody');
  const rec = (
    what: string,
    r: { source: string; recordId: string; fetchedAt: number; url?: string } | null | undefined,
  ): void => {
    if (r)
      pb.append(
        h(
          'tr',
          {},
          h('td', {}, what),
          h('td', {}, r.source),
          h('td', {}, r.recordId),
          h('td', {}, fmtTime(r.fetchedAt)),
          h('td', { style: 'font-size:9px;overflow-wrap:anywhere' }, r.url ?? ''),
        ),
      );
  };
  rec('Gene', g);
  rec('Protein', p);
  if (view.transcripts.status === 'ready') rec('Transcripts', view.transcripts.data);
  if (view.structure.status === 'ready')
    rec('Structure model', view.structure.data.models[view.structure.data.selected]);
  if (hub.b) {
    rec('Gene B', hub.b.view.gene);
    rec('Protein B', hub.b.view.protein);
  }
  prov.append(pb);
  sheet.append(
    sec('Sources and provenance', prov),
    sec(
      'Citations, licences and limits',
      h(
        'ul',
        {},
        h(
          'li',
          {},
          'Jumper, J. et al. Highly accurate protein structure prediction with AlphaFold. Nature 596, 583-589 (2021).',
        ),
        h(
          'li',
          {},
          'Varadi, M. et al. AlphaFold Protein Structure Database in 2024. Nucleic Acids Research 52, D368-D375 (2024).',
        ),
        h(
          'li',
          {},
          "UniProt data: CC BY 4.0 (The UniProt Consortium). NCBI Gene/RefSeq: US government information is public domain; check linked material. OrthoDB: pages reference CC BY 4.0. AlphaFold DB: see the provider's terms (licence text not independently confirmed by this app).",
        ),
      ),
      h(
        'p',
        {},
        'AlphaFold models are computational predictions, not experiments, and are not validated for clinical use. Annotation quality varies by species; unreviewed entries are automatic. This report is for education and research exploration only and is not medical advice.',
      ),
    ),
  );
  return sheet;
}
