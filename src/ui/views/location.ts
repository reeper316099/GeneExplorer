// Location tab: text facts, chromosome map, and the exon/intron diagram with a transcript selector.
import { chooseTranscript } from '../../core/gene-view';
import type { GeneView } from '../../core/gene-view';
import type { Transcript } from '../../shared/domain';
import { fmt, h, setChildren } from '../dom';
import { na, provTitle, withSource } from '../ctx';
import type { AppCtx, Scope } from '../ctx';
import { svgToPngBase64 } from '../exports';
import { chromosomeMapSvg } from '../svg/chromosome-map';
import { geneStructureSvg, structureStats } from '../svg/gene-structure';
import { renderLoadable } from './panel';

/** Builds the Location tab; panels re-render themselves when the view model changes. */
export function locationTab(ctx: AppCtx, view: GeneView, scope: Scope): HTMLElement {
  const root = h('div');
  const g = view.gene;
  if (!g) {
    root.append(
      h(
        'div',
        { class: 'notice info' },
        'No NCBI gene record is linked to this entry, so no genomic location is available.',
      ),
    );
    return root;
  }
  const loc = g.value.locations[0];

  const facts = h('div', { class: 'card' }, h('h3', {}, 'Where this gene is'));
  if (!loc) {
    facts.append(na('NCBI lists no genomic location for this gene.'));
  } else {
    const dl = h('dl', { class: 'kv' });
    const row = (k: string, v: Node | string): void => {
      dl.append(h('dt', {}, k), h('dd', {}, v));
    };
    row(
      'Replicon / sequence',
      withSource(`${loc.sequenceName || 'not named'} · ${loc.sequenceAccession}`, g),
    );
    row(
      'Chromosome (NCBI)',
      g.value.chromosomes.length
        ? withSource(g.value.chromosomes.join(', '), g)
        : na('not listed (for example an organelle, plasmid or unplaced sequence)'),
    );
    const map = g.value.mapLocations.map((m) => `${m.value} (${m.type})`).join(', ');
    row('Map location', map ? withSource(map, g) : na());
    row(
      'Assembly',
      withSource(`${loc.assemblyName || 'not named'} (${loc.assemblyAccession || 'no accession'})`, g),
    );
    row(
      'Annotation release',
      g.value.annotationName
        ? withSource(
            `${g.value.annotationName}${g.value.annotationDate ? `, ${g.value.annotationDate}` : ''}`,
            g,
          )
        : na(),
    );
    row(
      'Coordinates',
      withSource(`${fmt(loc.begin)} – ${fmt(loc.end)}  (${fmt(loc.end - loc.begin + 1)} bp)`, g),
    );
    row(
      'Coordinate convention',
      'NCBI reports 1-based, inclusive positions (the first base of a sequence is 1; both end points belong to the gene).',
    );
    row('Strand', withSource(loc.strand === 'plus' ? 'plus (forward)' : 'minus (reverse)', g));
    facts.append(dl);
    const others = g.value.locations.length - 1;
    if (others > 0)
      facts.append(
        h(
          'p',
          { class: 'muted' },
          `NCBI also lists ${others} location(s) on other assemblies or alternate sequences; the first (primary) one is shown.`,
        ),
      );
  }
  root.append(facts);

  const mapCard = h('div', { class: 'card diagram' }, h('h3', {}, 'Chromosome map'));
  const mapBody = h('div');
  mapCard.append(mapBody);
  root.append(mapCard);

  const structCard = h('div', { class: 'card diagram' }, h('h3', {}, 'Gene structure'));
  const structBody = h('div');
  structCard.append(structBody);
  root.append(structCard);

  let selected: number | null = null;

  /** Redraws the chromosome map from the sequence panel state. */
  const drawMap = (): void => {
    setChildren(
      mapBody,
      renderLoadable(
        view.sequence,
        (info) => {
          if (!loc || !info) return na();
          const box = h('div');
          const svg = chromosomeMapSvg({
            name: info.name,
            length: info.length,
            begin: loc.begin,
            end: loc.end,
            moleculeType: info.moleculeType,
          });
          box.append(
            svg,
            h(
              'p',
              { class: 'muted', title: provTitle(g) },
              `Length from NCBI sequence report for ${info.accession}.`,
            ),
          );
          box.append(
            h(
              'button',
              {
                class: 'btn',
                type: 'button',
                onclick: () => void exportPng(svg, `${g.value.symbol}-chromosome-map.png`),
              },
              'Save map as PNG',
            ),
          );
          return box;
        },
        () => void view.load('sequence'),
        2,
      ),
    );
    if (view.sequence.status === 'empty')
      mapBody.append(h('p', { class: 'muted' }, 'Chromosome length: not available.'));
  };

  /** Saves a diagram as PNG through the native dialog. */
  const exportPng = async (svg: SVGElement, name: string): Promise<void> => {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff';
    const b64 = await svgToPngBase64(svg, bg);
    if (!b64) return ctx.toast('The diagram could not be turned into an image.');
    await ctx.save(name, b64, 'base64', { name: 'PNG image', ext: 'png' });
  };

  /** Redraws the structure diagram, transcript selector and text fallback. */
  const drawStructure = (): void => {
    setChildren(
      structBody,
      renderLoadable(
        view.transcripts,
        (set) => {
          const list = set.value.transcripts;
          const auto = chooseTranscript(set);
          const idx = selected ?? auto.index;
          const t = list[idx] as Transcript;
          const box = h('div');
          const sel = h('select', {
            'aria-label': 'Transcript',
            onchange: (e: Event) => {
              selected = Number((e.target as HTMLSelectElement).value);
              drawStructure();
            },
          });
          list.forEach((x, i) => {
            const st = structureStats(x);
            const o = h(
              'option',
              { value: String(i) },
              `${x.accession} · ${x.name || x.type}${x.proteinOnly ? ' · coding region (no transcript record)' : ''}${x.selectCategory ? ` · ${x.selectCategory.replace(/_/g, ' ')}` : ''}${x.length ? ` · ${fmt(x.length)} nt` : ''}${st ? ` · ${st.exonCount} exons` : ''}`,
            );
            if (i === idx) o.selected = true;
            sel.append(o);
          });
          box.append(
            h('label', {}, 'Transcript: ', sel),
            h(
              'p',
              { class: 'muted' },
              selected === null
                ? `Chosen by rule: ${auto.reason}.`
                : `Chosen by you. The default rule would pick ${list[auto.index]?.accession}: ${auto.reason}.`,
            ),
          );
          const svg = geneStructureSvg(t);
          if (!svg) {
            box.append(na('NCBI gives no exon coordinates for this transcript.'));
            return box;
          }
          const st = structureStats(t);
          if (t.proteinOnly) {
            box.append(
              h(
                'div',
                { class: 'notice info' },
                `NCBI has no transcript (mRNA) record for this gene, which is usual for bacteria and for organelle genomes. The diagram shows the coding region of protein ${t.protein?.accession ?? t.accession}${t.protein?.length ? ` (${fmt(t.protein.length)} aa)` : ''}.`,
              ),
            );
          }
          box.append(svg);
          if (st)
            box.append(
              h(
                'p',
                {},
                `${st.exonCount} exons · spliced length from exon coordinates ${fmt(st.splicedLength)} bp · genomic span ${fmt(st.span)} bp · ${t.strand} strand`,
              ),
            );
          box.append(
            h(
              'p',
              { class: 'muted', title: provTitle(set) },
              'Exons and transcripts from the NCBI product report; the diagram shows one transcript at a time and does not distinguish UTRs from coding sequence.',
            ),
          );
          box.append(
            h(
              'button',
              {
                class: 'btn',
                type: 'button',
                onclick: () => void exportPng(svg, `${g.value.symbol}-${t.accession}-structure.png`),
              },
              'Save diagram as PNG',
            ),
          );
          // Text fallback of the exon table (accessible alternative to the drawing).
          const table = h(
            'table',
            {},
            h(
              'thead',
              {},
              h(
                'tr',
                {},
                h('th', {}, 'Exon'),
                h('th', {}, 'Begin'),
                h('th', {}, 'End'),
                h('th', {}, 'Length (bp)'),
              ),
            ),
          );
          const tb = h('tbody');
          for (const e of t.exons)
            tb.append(
              h(
                'tr',
                {},
                h('td', {}, String(e.order)),
                h('td', { class: 'mono' }, fmt(e.begin)),
                h('td', { class: 'mono' }, fmt(e.end)),
                h('td', {}, fmt(e.end - e.begin + 1)),
              ),
            );
          table.append(tb);
          box.append(h('details', {}, h('summary', {}, 'Exon coordinates as a table'), table));
          return box;
        },
        () => void view.load('transcripts'),
        3,
      ),
    );
  };

  drawMap();
  drawStructure();
  scope.add(
    view.subscribe(() => {
      drawMap();
      drawStructure();
    }),
  );
  return root;
}
