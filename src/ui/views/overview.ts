// Overview tab: names and aliases, summary, function, gene type, identifiers, link-outs, annotation quality, linking evidence.
import type { GeneView } from '../../core/gene-view';
import { h } from '../dom';
import { copyChip, linkOut, na, provTitle, withSource } from '../ctx';
import type { AppCtx } from '../ctx';

/** Builds the Overview tab. */
export function overviewTab(ctx: AppCtx, view: GeneView): HTMLElement {
  const root = h('div');
  const g = view.gene;
  const p = view.protein;

  for (const n of view.notes) root.append(h('div', { class: 'notice info' }, n));

  // Annotation-quality note: shown whenever the evidence is automatic, never hidden.
  if (p && !p.value.reviewed) {
    root.append(
      h(
        'div',
        { class: 'notice warn' },
        `This protein record (UniProt ${p.value.accession}) is unreviewed (TrEMBL): its annotation was produced automatically and has not been checked by a curator.`,
      ),
    );
  }
  const goAuto = (p?.value.go ?? []).filter((x) => x.automatic).length;
  const goAll = (p?.value.go ?? []).length;
  if (p && goAll > 0 && goAuto / goAll > 0.5) {
    root.append(
      h(
        'div',
        { class: 'notice warn' },
        `${goAuto} of ${goAll} GO terms for this protein were assigned automatically (evidence IEA).`,
      ),
    );
  }

  const names = h('div', { class: 'card' }, h('h3', {}, 'Names and aliases'));
  const dl = h('dl', { class: 'kv' });
  const row = (k: string, v: Node | string): void => {
    dl.append(h('dt', {}, k), h('dd', {}, v));
  };
  row(
    'Official symbol',
    g
      ? withSource(g.value.symbol, g)
      : p?.value.geneNames.primary
        ? withSource(p.value.geneNames.primary, p)
        : na(),
  );
  row('Official name', g?.value.description ? withSource(g.value.description, g) : na());
  row('Aliases (NCBI)', g && g.value.synonyms.length ? withSource(g.value.synonyms.join(', '), g) : na());
  row(
    'Other names (NCBI)',
    g && g.value.alternateNames.length ? withSource(g.value.alternateNames.join('; '), g) : na(),
  );
  row('Protein name (UniProt)', p?.value.proteinName ? withSource(p.value.proteinName, p) : na());
  row(
    'Gene names (UniProt)',
    p
      ? withSource(
          [p.value.geneNames.primary, ...p.value.geneNames.synonyms].filter(Boolean).join(', ') ||
            'not available',
          p,
        )
      : na(),
  );
  row('Gene type', g ? withSource(g.value.type.replace(/_/g, ' ').toLowerCase(), g) : na());
  if (g?.value.nomenclature)
    row(
      'Naming authority',
      withSource(`${g.value.nomenclature.authority} ${g.value.nomenclature.identifier}`, g),
    );
  names.append(dl);
  root.append(names);

  const sum = h('div', { class: 'card' }, h('h3', {}, 'Summary'));
  if (g?.value.summary) {
    sum.append(
      h('p', {}, g.value.summary),
      h(
        'p',
        { class: 'muted', title: provTitle(g) },
        `Summary text from NCBI Gene (${g.recordId}); NCBI may take it from RefSeq or a curation group. Fetched ${new Date(g.fetchedAt).toLocaleDateString()}.`,
      ),
    );
  } else sum.append(na('No summary is available from NCBI for this gene.'));
  root.append(sum);

  const fn = h('div', { class: 'card' }, h('h3', {}, 'Function (UniProt)'));
  if (p?.value.functionText) {
    fn.append(
      h('p', {}, p.value.functionText),
      h(
        'p',
        { class: 'muted', title: provTitle(p) },
        `UniProt ${p.value.accession}, annotation updated ${p.value.lastAnnotationUpdate}${p.value.reviewed ? ' (reviewed entry)' : ' (unreviewed entry)'}.`,
      ),
    );
  } else fn.append(na('No function text is available from UniProt for this protein.'));
  root.append(fn);

  const ids = h('div', { class: 'card' }, h('h3', {}, 'Identifiers and link-outs'));
  if (g) ids.append(copyChip(ctx, 'NCBI Gene', g.value.geneId, g));
  if (p)
    ids.append(
      copyChip(ctx, 'UniProt', p.value.accession, p),
      copyChip(ctx, 'Entry name', p.value.entryName, p),
    );
  for (const e of g?.value.ensemblGeneIds ?? []) ids.append(copyChip(ctx, 'Ensembl', e, g));
  for (const x of p?.value.xrefs.filter((r) => r.database === 'RefSeq').slice(0, 3) ?? [])
    ids.append(copyChip(ctx, 'RefSeq', x.id, p));
  const links = h('div', {});
  if (g) links.append(linkOut(ctx, 'NCBI Gene', `https://www.ncbi.nlm.nih.gov/gene/${g.value.geneId}`));
  if (p)
    links.append(
      linkOut(ctx, 'UniProt', `https://www.uniprot.org/uniprotkb/${p.value.accession}`),
      linkOut(ctx, 'AlphaFold DB', `https://alphafold.ebi.ac.uk/entry/${p.value.accession}`),
    );
  const ens = g?.value.ensemblGeneIds[0];
  if (ens) links.append(linkOut(ctx, 'Ensembl', `https://www.ensembl.org/id/${ens}`));
  if (g && g.value.taxon.id === 9606) {
    // ClinVar and gnomAD describe human variation only, so they are offered for human genes only.
    links.append(
      linkOut(
        ctx,
        'ClinVar',
        `https://www.ncbi.nlm.nih.gov/clinvar/?term=${encodeURIComponent(`${g.value.symbol}[gene]`)}`,
      ),
    );
    if (ens) links.append(linkOut(ctx, 'gnomAD', `https://gnomad.broadinstitute.org/gene/${ens}`));
  }
  if (!g && !p) links.append(na());
  ids.append(h('div', { style: 'margin-top:8px' }, links));
  root.append(ids);

  if (view.identity) {
    const id = view.identity;
    const label = {
      confirmed: 'Confirmed by both databases',
      one_way: 'Linked by one database',
      unconfirmed: 'Not confirmed',
      conflict: 'Conflicting cross-references',
    }[id.status];
    const evidence = h('div', { class: 'card' }, h('h3', {}, 'How the gene and protein records are linked'));
    evidence.append(
      h('p', {}, h('span', { class: `badge ${id.status === 'confirmed' ? 'good' : 'warn'}` }, label)),
      h('ul', {}, ...id.evidence.map((e) => h('li', {}, e))),
      h(
        'p',
        { class: 'muted' },
        `Records are matched by database cross-references, never by gene symbol alone. Organism check: ${id.taxon === 'same' ? 'same taxon in both databases' : id.taxon === 'ancestor' ? 'UniProt uses a broader taxon than NCBI (for example a strain versus a sub-strain)' : 'the two databases name different organisms'}.`,
      ),
    );
    root.append(evidence);
  }
  return root;
}
