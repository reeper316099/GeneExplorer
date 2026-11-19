"""Independent cross-check of the app's alignment and superposition against Biopython, on FRESH data fetched now from
UniProt and AlphaFold DB (not the stored fixtures). Prepares inputs, runs the app's code (tools/crosscheck.ts), compares.
Run: python tools/crosscheck.py prepare; node scripts/run-tool.mjs tools/crosscheck.ts scratch/crosscheck-in.json scratch/crosscheck-out.json; python tools/crosscheck.py compare
(compare re-fetches and re-runs Biopython, so both halves use the same fresh data)."""
import json, subprocess, sys, urllib.request, datetime
import numpy as np
from Bio import Align, PDB
from Bio.Align import substitution_matrices
from Bio.SVDSuperimposer import SVDSuperimposer

UA = {"User-Agent": "GeneExplorer-crosscheck"}
PAIRS = [  # (name, accession A, accession B) - none of these pairs is in the stored fixtures
    ("KRAS vs HRAS (human paralogs)", "P01116", "P01112"),
    ("CDK1 human vs CDC28 yeast", "P06493", "P00546"),
    ("SOD1 human vs mouse", "P00441", "P08228"),
    ("Cytochrome c human vs yeast", "P99999", "P00044"),
    ("GAPDH human vs E. coli", "P04406", "P0A9B2"),
    ("Hemoglobin beta human vs zebrafish", "P68871", "Q90486"),
    ("Calmodulin human vs Arabidopsis CAM1", "P0DP23", "P0DH95"),
    ("Insulin human vs chicken", "P01308", "P67970"),
]
STRUCT = [0, 1, 2, 3]  # indices into PAIRS used for structure superposition (4 pairs)


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read().decode()


def fasta(acc):
    return "".join(get(f"https://rest.uniprot.org/uniprotkb/{acc}.fasta").splitlines()[1:])


def aligner():
    a = Align.PairwiseAligner()
    a.substitution_matrix = substitution_matrices.load("BLOSUM62")
    a.mode = "global"; a.open_gap_score = -11; a.extend_gap_score = -1
    return a


def ca_atoms(acc):
    pdb = get(f"https://alphafold.ebi.ac.uk/files/AF-{acc}-F1-model_v6.pdb")
    out = {}
    for line in pdb.splitlines():
        if line.startswith("ATOM") and line[12:16].strip() == "CA":
            out[int(line[22:26])] = (float(line[30:38]), float(line[38:46]), float(line[46:54]), float(line[60:66]))
    return out


def main(mode):
    when = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    seqs = {}
    for _, x, y in PAIRS:
        for acc in (x, y):
            seqs.setdefault(acc, fasta(acc))
    al = aligner()
    bio_scores, pairs_in = {}, []
    for name, x, y in PAIRS:
        a, b = seqs[x], seqs[y]
        bio_scores[name] = al.score(a, b)
        pairs_in.append({"name": name, "a": a, "b": b})
    structs_in, bio_rms = [], {}
    for k in STRUCT:
        name, x, y = PAIRS[k]
        aln = al.align(seqs[x], seqs[y])[0]
        ca, cb = aln.aligned
        atoms_a, atoms_b = ca_atoms(x), ca_atoms(y)
        mv, fx = [], []
        for (sa, ea), (sb, eb) in zip(ca, cb):
            for i in range(ea - sa):
                ra, rb = sa + i + 1, sb + i + 1
                if ra in atoms_a and rb in atoms_b and atoms_a[ra][3] >= 70 and atoms_b[rb][3] >= 70:
                    fx.append(atoms_a[ra][:3]); mv.append(atoms_b[rb][:3])
        sup = SVDSuperimposer(); sup.set(np.array(fx), np.array(mv)); sup.run()
        bio_rms[name] = (sup.get_rms(), len(fx))
        structs_in.append({"name": name, "moving": mv, "fixed": fx})
    open("scratch/crosscheck-in.json", "w").write(json.dumps({"pairs": pairs_in, "structures": structs_in}))
    open("scratch/crosscheck-bio.json", "w").write(json.dumps({"when": when, "scores": bio_scores, "rms": bio_rms}))
    if mode == "prepare":
        print("prepared scratch/crosscheck-in.json; now run: node scripts/run-tool.mjs tools/crosscheck.ts scratch/crosscheck-in.json scratch/crosscheck-out.json")
        return
    out = json.load(open("scratch/crosscheck-out.json"))
    print(f"Independent cross-check, run {when}, Biopython {__import__('Bio').__version__}")
    print("\nPROTEIN ALIGNMENT (global, BLOSUM62, gap open -11 / extend -1)")
    worst = 0
    for r in out["alignments"]:
        d = r["score"] - bio_scores[r["name"]]; worst = max(worst, abs(d))
        print(f"  {r['name']:42s} app {r['score']:7.0f}  biopython {bio_scores[r['name']]:7.0f}  diff {d:+.0f}")
    print(f"  max |score difference| = {worst:.0f}")
    print("\nSTRUCTURE SUPERPOSITION (confident aligned CA atoms, pLDDT >= 70 both)")
    worst = 0
    for r in out["structures"]:
        b, n = bio_rms[r["name"]]; d = r["rmsd"] - b; worst = max(worst, abs(d))
        print(f"  {r['name']:42s} n={n:4d}  app {r['rmsd']:.6f} A  biopython {b:.6f} A  diff {d:+.2e}")
    print(f"  max |RMSD difference| = {worst:.2e} Angstrom")
    print(f"\nApp timing: alignments {out['alignMs']:.0f} ms total, superpositions {out['superposeMs']:.1f} ms total")
    sys.exit(0 if worst < 1e-6 else 1)


main(sys.argv[1] if len(sys.argv) > 1 else 'prepare')
