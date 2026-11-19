"""Generates tests/fixtures/reference/superpose-refs.json using Biopython's SVDSuperimposer as an independent
reference for src/bio/superpose.ts. Fixed seed; includes noisy, planar (degenerate), and mirror-image cases.
Run: scratch/venv/bin/python tools/gen_superpose_refs.py"""
import json
import numpy as np
from Bio.SVDSuperimposer import SVDSuperimposer


def random_rotation(rng):
    """Returns a uniformly random proper rotation matrix (determinant +1)."""
    q, r = np.linalg.qr(rng.normal(size=(3, 3)))
    q = q * np.sign(np.diag(r))
    if np.linalg.det(q) < 0:
        q[:, 0] = -q[:, 0]
    return q


def case(name, moving, fixed):
    """Superposes `moving` onto `fixed` with Biopython and records rotation (column-vector form), translation, rms."""
    sup = SVDSuperimposer()
    sup.set(fixed, moving)  # Biopython: coords (second arg) are moved onto reference (first arg)
    sup.run()
    rot, tran = sup.get_rotran()  # moved = moving @ rot + tran  (row vectors)
    return {
        "name": name, "moving": moving.tolist(), "fixed": fixed.tolist(),
        "rotation": rot.T.flatten().tolist(),  # column-vector convention R = rot.T, row-major
        "translation": tran.tolist(), "rmsd": float(sup.get_rms()),
    }


def main():
    rng = np.random.default_rng(20261119)
    cases = []
    for k, (n, noise) in enumerate([(3, 0.0), (4, 0.0), (10, 0.0), (10, 0.5), (50, 1.0), (120, 0.3), (300, 2.0), (300, 5.0)]):
        a = rng.normal(scale=10, size=(n, 3))
        b = a @ random_rotation(rng).T + rng.normal(scale=20, size=3) + rng.normal(scale=noise, size=(n, 3))
        cases.append(case(f"random rigid n={n} noise={noise}", a, b))
    for k in range(6):
        n = int(rng.integers(5, 80))
        cases.append(case(f"unrelated clouds #{k}", rng.normal(scale=8, size=(n, 3)), rng.normal(scale=8, size=(n, 3))))
    planar = np.c_[rng.normal(scale=10, size=(30, 2)), np.zeros(30)]
    cases.append(case("planar points", planar, planar @ random_rotation(rng).T + 5.0))
    helix = np.array([[2.3 * np.cos(i * 1.745), 2.3 * np.sin(i * 1.745), 1.5 * i] for i in range(40)])
    cases.append(case("alpha-helix-like spiral", helix, helix @ random_rotation(rng).T - 3.0 + rng.normal(scale=0.4, size=helix.shape)))
    mirror = rng.normal(scale=10, size=(25, 3))
    cases.append(case("mirror image (must NOT flip handedness)", mirror, mirror * np.array([-1, 1, 1])))
    json.dump({"tool": "tools/gen_superpose_refs.py", "reference": "Bio.SVDSuperimposer", "cases": cases}, open("tests/fixtures/reference/superpose-refs.json", "w"))
    print(f"wrote {len(cases)} cases")


main()
