"""Independent spot-check of the facts the app shows (scratch/spotcheck-app.json from tools/spotcheck.ts) against OTHER endpoints:
NCBI E-utilities (esummary/elink; the app uses the Datasets API), UniProt FASTA (length), and the AlphaFold PDB file's own B-factor
column (mean pLDDT computed independently). Prints a markdown table and PASS/FAIL per field. Run: python3 tools/spotcheck.py"""
import json, time, urllib.request, urllib.parse, sys

UA = {"User-Agent": "GeneExplorer-spotcheck"}


def get(url):
    time.sleep(0.4)
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90).read().decode()


def esummary(gid):
    d = json.loads(get(f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=gene&id={gid}&retmode=json"))
    return d["result"][gid]


def orthologs(gid):
    d = json.loads(get(f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi?dbfrom=gene&db=gene&id={gid}&linkname=gene_gene_orthologs&retmode=json"))
    ids = []
    for ls in d.get("linksets", []):
        for db in ls.get("linksetdbs", []):
            ids += [str(x) for x in db["links"]]
    return set(ids)


def uniprot_len(acc):
    return len("".join(get(f"https://rest.uniprot.org/uniprotkb/{acc}.fasta").splitlines()[1:]))


def mean_plddt(acc):
    vals = [float(l[60:66]) for l in get(f"https://alphafold.ebi.ac.uk/files/AF-{acc}-F1-model_v6.pdb").splitlines() if l.startswith("ATOM") and l[12:16].strip() == "CA"]
    return sum(vals) / len(vals)


app = json.load(open("scratch/spotcheck-app.json"))
rows, fails = [], 0
print(f"App facts collected {app['at']} (live); independent look at {time.strftime('%Y-%m-%dT%H:%M:%S%z')}\n")


def check(gene, field, mine, indep, ok, note=""):
    global fails
    rows.append((gene, field, mine, indep, "PASS" if ok else "FAIL", note))
    if not ok:
        fails += 1


for g in app["genes"]:
    name = f"{g['symbol']} ({g['organism']})"
    es = esummary(g["geneId"])
    gi = (es.get("genomicinfo") or [{}])[0]
    check(name, "symbol", g["symbol"], es["name"], g["symbol"] == es["name"])
    check(name, "name", g["name"], es["description"], g["name"].lower() == es["description"].lower())
    chrom = es.get("chromosome", "")
    check(name, "chromosome", g["chromosome"] or "(none listed)", chrom or "(none listed)", (g["chromosome"] or "") == chrom or (not g["chromosome"] and not chrom) or (g["chromosome"].startswith("Plastid") and not chrom), "E-utilities leaves organelle/bacterial chromosome blank" if not chrom else "")
    if gi:
        lo, hi = min(gi["chrstart"], gi["chrstop"]) + 1, max(gi["chrstart"], gi["chrstop"]) + 1  # E-utilities positions are 0-based
        check(name, "coordinates (1-based)", f"{g['begin']}-{g['end']}", f"{lo}-{hi}", (g["begin"], g["end"]) == (lo, hi), "E-utilities start/stop are 0-based; +1 applied")
        strand = "minus" if gi["chrstart"] > gi["chrstop"] else "plus"
        check(name, "strand", g["strand"], strand, g["strand"] == strand)
        pass
    # Exon count of the DISPLAYED transcript, checked on the transcript's own GenBank record (E-utilities' exoncount counts the
    # whole gene model, which is a different quantity).
    tr = g.get("transcript") or ""
    if tr[:3] in ("NM_", "XM_", "NR_", "XR_"):
        gb = get(f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id={tr}&rettype=gb&retmode=text")
        n = sum(1 for l in gb.splitlines() if l.startswith("     exon "))
        if n > 0:
            check(name, f"exon count of {tr}", g["exonsDisplayed"], n, g["exonsDisplayed"] == n, "exon features in the transcript's GenBank record")
        else:
            # Only some RefSeq records (e.g. MANE) carry exon features; fall back to a weaker, labelled consistency check.
            gm = gi.get("exoncount") if gi else None
            rows.append((name, f"exon count of {tr} (weaker check)", g["exonsDisplayed"], f"record has no exon features; gene model has {gm}", "PASS" if gm is not None and g["exonsDisplayed"] <= gm else "FAIL", "displayed transcript cannot have more exons than the whole gene model"))
            if not (gm is not None and g["exonsDisplayed"] <= gm):
                fails += 1
    elif g.get("proteinOnly") and g.get("sequence"):
        gb = get(f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id={g['sequence']}&seq_start={g['begin']}&seq_stop={g['end']}&rettype=gb&retmode=text")
        cds = [l for l in gb.splitlines() if l.startswith("     CDS ")]
        single = bool(cds) and all("join" not in l for l in cds)
        check(name, "exon count (coding region)", g["exonsDisplayed"], "1 (CDS has no join)" if single else "CDS has a join", g["exonsDisplayed"] == 1 and single, "CDS feature of the genomic record")
    if gi:
        gm = gi.get("exoncount")
        rows.append((name, "gene-model exon count (E-utilities, informational)", g["exonsDisplayed"], gm, "INFO", "E-utilities counts distinct exons over all transcripts; not the displayed transcript"))
    check(name, "protein length", g["proteinLength"], uniprot_len(g["accession"]), g["proteinLength"] == uniprot_len(g["accession"]), f"UniProt {g['accession']} FASTA")
    mp = mean_plddt(g["accession"])
    check(name, "mean pLDDT", g["meanPlddt"], round(mp, 2), abs(g["meanPlddt"] - mp) < 0.1, "mean of the PDB file's B-factor column; tolerance 0.1")
    # Ortholog: independent source = Alliance of Genome Resources (a different orthology resource, model organisms only).
    o = g.get("ortholog")
    nid = g.get("nomenclatureId")
    alli = None
    for pre, new in (("ZDB-", "ZFIN:"), ("FBgn", "FB:"), ("S0", "SGD:")):  # NCBI gives bare IDs for these authorities
        if nid and nid.startswith(pre):
            nid = new + nid
    if o and o.get("nomenclatureId"):
        oid = o["nomenclatureId"]
        for pre, new in (("ZDB-", "ZFIN:"), ("FBgn", "FB:"), ("S0", "SGD:")):
            if oid.startswith(pre):
                o["nomenclatureId"] = new + oid
    if nid:
        try:
            d = json.loads(get(f"https://www.alliancegenome.org/api/gene/{urllib.parse.quote(nid)}/orthologs?limit=500"))
            alli = {x["geneToGeneOrthologyGenerated"]["objectGene"]["primaryExternalId"] for x in d.get("results", [])}
        except Exception as e:  # network or schema trouble is reported, not hidden
            alli = None
            print("Alliance lookup failed for", nid, e, file=sys.stderr)
    if o:
        if alli is None or not o.get("nomenclatureId"):
            rows.append((name, "ortholog call", f"{o['symbol']} ({o.get('nomenclatureId')})", "Alliance lookup unavailable", "NOT RUN", ""))
        else:
            check(name, "ortholog call", f"{o['symbol']} ({o['nomenclatureId']})", f"Alliance lists {len(alli)} orthologs; contains it: {o['nomenclatureId'] in alli}", o["nomenclatureId"] in alli, "independent orthology resource (Alliance of Genome Resources)")
    elif g.get("orthologTaxon"):
        rows.append((name, "ortholog call (none in NCBI)", "none in NCBI Orthologs", f"Alliance lists {len(alli)} orthologs" if alli is not None else "no Alliance record for this organism/gene", "INFO", "absence in one source is not absence in the genome" + ("; the app's OrthoDB tab is the second source" if alli else "")))

print("| Gene | Field | App value | Independent value | Result | Note |\n|---|---|---|---|---|---|")
for r in rows:
    print("| " + " | ".join(str(x) for x in r) + " |")
npass = sum(1 for r in rows if r[4] == "PASS"); ninfo = sum(1 for r in rows if r[4] in ("INFO", "NOT RUN"))
print(f"\n{npass} PASS, {fails} FAIL, {ninfo} INFO/NOT RUN of {len(rows)} lines across {len(app['genes'])} genes")
sys.exit(1 if fails else 0)
