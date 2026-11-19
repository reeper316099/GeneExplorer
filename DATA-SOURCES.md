# Data sources

All data is fetched live from public servers by the app's main process (the UI makes no network requests). **The data belongs to its providers and stays under their licences; the MIT licence of this repository covers the code only.** Each fact in the app carries its source, record ID and fetch time. "Accessed" means the endpoints were verified with real requests and the licence wording below was read on that date.

Rate limits below are the limits **this app sets for itself** (a token bucket per host), not limits the providers publish. Every request sends the generic User-Agent `GeneExplorer/<version>`.

## UniProt

- Base URL: `https://rest.uniprot.org`. Accessed 2026-11-18 and 2026-11-19.
- Endpoints used: `/uniprotkb/{accession}.json`, `/uniprotkb/search` (by gene, Ensembl, GeneID, text), `/uniprotkb/{accession}.fasta` (isoforms, on demand). Obsolete accessions return HTTP 200 with `entryType: "Inactive"`.
- Licence, quoted from `https://rest.uniprot.org/help/license` (last modified 2024-12-18): "We have chosen to apply the Creative Commons Attribution 4.0 International (CC BY 4.0) License to all copyrightable parts of our databases." The same page adds: "Any medical or genetic information is provided for research, educational and informational purposes only."
- Attribution: credit UniProt and cite The UniProt Consortium (current reference: `https://www.uniprot.org/help/publications`).
- App limit: 5 requests per second, cache 7 days.

## NCBI Datasets (NCBI Gene, RefSeq, Taxonomy)

- Base URL: `https://api.ncbi.nlm.nih.gov/datasets/v2`. Accessed 2026-11-18 and 2026-11-19.
- Endpoints used: `/gene/id/{id}`, `/gene/symbol/{symbol}/taxon/{taxon}`, `/gene/accession/{accession}`, `/gene/id/{id}/orthologs`, `/gene/id/{id}/product_report`, `/taxonomy/taxon/{ids}`, `/taxonomy/taxon_suggest/{text}`, sequence reports.
- Terms, quoted from `https://www.ncbi.nlm.nih.gov/home/about/policies/`: "Information that is created by or for the US government on this site is within the public domain." and "Public domain information on the National Library of Medicine (NLM) Web pages may be freely distributed and copied." Material from other sources linked through NCBI keeps its own terms; the NCBI page says users must check the licence of linked pages.
- Attribution: credit NCBI and the record's annotation release (shown in the app). See the policies page for how to cite NCBI resources.
- App limit: 3 requests per second without an API key, cache 7 days. NCBI also hosts E-utilities, which the app does **not** use except in the development spot-check tool.

## AlphaFold Protein Structure Database

- Base URL: `https://alphafold.ebi.ac.uk` (API under `/api`, model files under `/files`). Accessed 2026-11-18 and 2026-11-19.
- Endpoints used: `/api/prediction/{uniprot accession}` and the PDB model files it lists. pLDDT is read from the B-factor column.
- Licence and disclaimer: the web terms page could not be read as plain text (it needs JavaScript), so the wording below is quoted from the header of a downloaded model file (`REMARK 1 DISCLAIMERS`): "ALPHAFOLD DATA, COPYRIGHT (2021) DEEPMIND TECHNOLOGIES LIMITED. THE INFORMATION PROVIDED IS THEORETICAL MODELLING ONLY AND CAUTION SHOULD BE EXERCISED IN ITS USE." and "IT IS AVAILABLE FOR ACADEMIC AND COMMERCIAL PURPOSES, UNDER CC-BY 4.0 LICENCE." The same header says the information "IS NOT INTENDED TO BE A SUBSTITUTE FOR PROFESSIONAL MEDICAL ADVICE, DIAGNOSIS, OR TREATMENT".
- Please cite: Jumper, J. et al. Highly accurate protein structure prediction with AlphaFold. Nature 596, 583-589 (2021), doi:10.1038/s41586-021-03819-2; and Varadi, M. et al. AlphaFold Protein Structure Database in 2024: providing structure coverage for over 214 million protein sequences. Nucleic Acids Research 52, D368-D375 (2024).
- App limit: 5 requests per second, cache 30 days. The app always says structures are predictions.

## OrthoDB

- Base URL: `https://data.orthodb.org/v12`. Accessed 2026-11-18 and 2026-11-19.
- Endpoints used: `/search` (by UniProt accession), `/group`, `/orthologs`. A protein with no group returns `data: null`, which the app shows as "no group".
- Licence, from the machine-readable description on `https://www.orthodb.org/`: license "Creative Commons Attribution 4.0 (CC-BY-4.0)" (`https://creativecommons.org/licenses/by/4.0/`), with a citation record pointing to doi:10.1093/nar/gkac998 (Kuznetsov, D. et al., OrthoDB v11, Nucleic Acids Research 2023).
- App limit: 2 requests per second, cache 14 days.

## Ensembl: not used

Ensembl was planned but `rest.ensembl.org` never completed a TLS handshake from the development network (tested repeatedly on 2026-11-18/19), so no Ensembl data is shown or cached and no Ensembl citation is needed. The host is still in the allowlist code but is never called. Orthologs come from NCBI and OrthoDB only.

## Used only to check the app, never shown in it

- **NCBI E-utilities** and the **Alliance of Genome Resources** were queried by development tools (`tools/spotcheck.ts`) as independent checks. Their data is not bundled and not displayed.
- **BLOSUM62** matrix: generated from Biopython 1.86's copy and verified identical to the NCBI file (576 of 576 cells). It is a published substitution matrix (Henikoff and Henikoff 1992).

## Software

- 3Dmol.js (BSD-3-Clause): Rego and Koes, Bioinformatics 31, 1322 (2015). Electron, zod and other dependencies keep their own open-source licences, listed in `package-lock.json`.
- Biopython (BSD-3-Clause) is used only in development to cross-check the maths; it is not shipped.
