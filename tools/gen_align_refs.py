"""Generates tests/fixtures/reference/align-refs.json: Biopython PairwiseAligner results used as an independent
reference for src/bio/align.ts. Real sequences come from UniProt (fetched live, accession recorded in the file);
synthetic pairs use a fixed seed so the file is reproducible.
Run: scratch/venv/bin/python tools/gen_align_refs.py"""
import json
import random
import urllib.request

from Bio import Align
from Bio.Align import substitution_matrices

UA = {"User-Agent": "GeneExplorer-reference-generator"}


def fetch_fasta(acc):
    """Downloads one UniProt FASTA record and returns the bare sequence."""
    req = urllib.request.Request(f"https://rest.uniprot.org/uniprotkb/{acc}.fasta", headers=UA)
    text = urllib.request.urlopen(req, timeout=30).read().decode()
    return "".join(text.splitlines()[1:])


REAL_PAIRS = [
    ("P04637", "P02340"),  # TP53 human vs mouse
    ("P04637", "P79734"),  # TP53 human vs zebrafish
    ("P04637", "Q9H3D4"),  # TP53 vs TP63 (paralog)
    ("P01308", "P01325"),  # insulin human vs mouse
    ("P01308", "P01315"),  # insulin human vs pig
    ("P69905", "P68871"),  # hemoglobin alpha vs beta (distant)
    ("P69905", "P01942"),  # hemoglobin alpha human vs mouse
    ("P0CG48", "P62987"),  # ubiquitin precursors (repeats)
    ("P68871", "P02070"),  # hemoglobin beta human vs bovine
    ("P60709", "P68133"),  # beta-actin vs skeletal alpha-actin
    ("P0DP23", "P62158"),  # calmodulin 1 vs calmodulin (human, near identical)
    ("P00722", "P06864"),  # E. coli lacZ vs a distinct protein (low similarity)
    ("P01308", "P69905"),  # unrelated proteins
]


def aligner(open_, extend):
    """Builds a global aligner with Biopython's gap convention (k gaps cost open + (k-1)*extend)."""
    a = Align.PairwiseAligner()
    a.substitution_matrix = substitution_matrices.load("BLOSUM62")
    a.mode = "global"
    a.open_gap_score = open_
    a.extend_gap_score = extend
    return a


def record(name, a_seq, b_seq, open_=-11, extend=-1):
    """Aligns one pair and returns score, number of co-optimal alignments and the first optimal alignment."""
    al = aligner(open_, extend)
    alns = al.align(a_seq, b_seq)
    first = alns[0]
    n = len(alns)
    # format() gives 3 lines per block; use the aligned coordinate arrays to build gapped strings.
    ga, gb = [], []
    ca, cb = first.aligned
    ia = ib = 0
    for (sa, ea), (sb, eb) in zip(ca, cb):
        while ia < sa:
            ga.append(a_seq[ia]); gb.append("-"); ia += 1
        while ib < sb:
            ga.append("-"); gb.append(b_seq[ib]); ib += 1
        for k in range(ea - sa):
            ga.append(a_seq[sa + k]); gb.append(b_seq[sb + k])
        ia, ib = ea, eb
    while ia < len(a_seq):
        ga.append(a_seq[ia]); gb.append("-"); ia += 1
    while ib < len(b_seq):
        ga.append("-"); gb.append(b_seq[ib]); ib += 1
    return {
        "name": name, "a": a_seq, "b": b_seq, "gapOpen": open_, "gapExtend": extend,
        "score": int(first.score), "optimalCount": n, "alignedA": "".join(ga), "alignedB": "".join(gb),
    }


def mutate(rng, seq, sub, ins, dele):
    """Returns a mutated copy of seq with the given per-residue substitution, insertion and deletion rates."""
    aa = "ACDEFGHIKLMNPQRSTVWY"
    out = []
    for ch in seq:
        r = rng.random()
        if r < dele:
            continue
        if r < dele + sub:
            out.append(rng.choice(aa))
        else:
            out.append(ch)
        if rng.random() < ins:
            out.extend(rng.choice(aa) for _ in range(rng.randint(1, 4)))
    return "".join(out)


def main():
    rng = random.Random(20261119)
    cases, sources = [], {}
    for x, y in REAL_PAIRS:
        for acc in (x, y):
            if acc not in sources:
                try:
                    seq = fetch_fasta(acc)
                    if not seq:
                        raise ValueError("empty FASTA")
                    sources[acc] = seq
                except Exception as e:  # accession may have changed; skip rather than guess
                    print("skip", acc, e)
        if x in sources and y in sources:
            cases.append(record(f"real {x} vs {y}", sources[x], sources[y]))
    aa = "ACDEFGHIKLMNPQRSTVWY"
    for k in range(14):
        base = "".join(rng.choice(aa) for _ in range(rng.randint(30, 260)))
        cases.append(record(f"synthetic mutated #{k}", base, mutate(rng, base, 0.15, 0.04, 0.04)))
    for k in range(6):
        x = "".join(rng.choice(aa) for _ in range(rng.randint(5, 120)))
        y = "".join(rng.choice(aa) for _ in range(rng.randint(5, 120)))
        cases.append(record(f"synthetic unrelated #{k}", x, y))
    cases.append(record("identical", "MKTAYIAKQRQISFVKSHFSRQ", "MKTAYIAKQRQISFVKSHFSRQ"))
    cases.append(record("single residue", "W", "W"))
    cases.append(record("single mismatch", "W", "G"))
    cases.append(record("ambiguity codes", "MKXBZAYIAK", "MKAYIAKQRQ"))
    cases.append(record("custom gaps -8/-2", "MKTAYIAKQRQISFVKSHFSRQ", "MKTAYIQRQISFSHFSRQLL", -8, -2))
    cases.append(record("custom gaps -5/-5", "HEAGAWGHEE", "PAWHEAE", -5, -5))
    doc = {
        "tool": "tools/gen_align_refs.py", "biopython": __import__("Bio").__version__,
        "matrix": "BLOSUM62", "uniprotSequences": {k: len(v) for k, v in sources.items()}, "cases": cases,
    }
    with open("tests/fixtures/reference/align-refs.json", "w") as f:
        json.dump(doc, f)
    print(f"wrote {len(cases)} cases")


main()
