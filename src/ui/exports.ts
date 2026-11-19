// Builders for exported file contents (FASTA, unified record JSON, diagram PNG). Pure or DOM-only; saving is done by
// the main process through a native dialog.
import type { GeneView } from '../core/gene-view';
import type { ProteinRecord } from '../shared/domain';
import { inlineCssVars } from './svg/scale';

/** Wraps a sequence at 60 columns under a FASTA header. */
export function toFasta(header: string, sequence: string): string {
  const lines = sequence.match(/.{1,60}/g) ?? [];
  return `>${header}\n${lines.join('\n')}\n`;
}

/** FASTA header in UniProt style (accession|entry name, protein name, organism, gene). */
export function proteinHeader(p: ProteinRecord, isoform?: string): string {
  const v = p.value;
  const gene = v.geneNames.primary ? ` GN=${v.geneNames.primary}` : '';
  return `${isoform ?? v.accession}|${v.entryName} ${v.proteinName ?? 'name not available'} OS=${v.taxon.scientificName} OX=${v.taxon.id}${gene}`;
}

/** The unified record as pretty JSON: every record keeps its source, record ID, fetch time and URL. */
export function unifiedRecordJson(view: GeneView, appVersion: string): string {
  const s =
    view.structure.status === 'ready' ? view.structure.data.models[view.structure.data.selected] : null;
  return JSON.stringify(
    {
      exportedBy: `GeneExplorer ${appVersion}`,
      note: 'Each record lists its source database, record ID, fetch time and request URL. Records from different databases are linked by cross-references only and are never merged.',
      gene: view.gene,
      protein: view.protein,
      identityCheck: view.identity,
      transcripts: view.transcripts.status === 'ready' ? view.transcripts.data : null,
      structureModel: s ?? null,
    },
    null,
    2,
  );
}

/** Renders an SVG element to base64 PNG (resolving theme colours first); resolves null if rendering fails. */
export async function svgToPngBase64(svg: SVGElement, background: string): Promise<string | null> {
  const clone = inlineCssVars(svg);
  const vb = (clone.getAttribute('viewBox') ?? '0 0 1000 200').split(/\s+/).map(Number);
  const w = vb[2] ?? 1000;
  const hgt = vb[3] ?? 200;
  clone.setAttribute('width', String(w * 2));
  clone.setAttribute('height', String(hgt * 2));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  const loaded = new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
  });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  if (!(await loaded)) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w * 2;
  canvas.height = hgt * 2;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.fillStyle = background;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}
