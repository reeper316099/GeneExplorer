// Optimal rigid-body superposition of two equal-length point sets (Horn 1987 quaternion method, equivalent to
// Kabsch). Written from scratch; verified against Biopython's SVDSuperimposer in tests.
export type Vec3 = readonly [number, number, number];

export interface Superposition {
  /** Row-major 3x3 rotation matrix R. A transformed point is R * p + translation. */
  rotation: readonly number[];
  translation: Vec3;
  /** Root-mean-square deviation in the same unit as the input (Angstrom for PDB coordinates). */
  rmsd: number;
  /** Number of point pairs used. */
  n: number;
}

export type SuperposeResult =
  | { ok: true; value: Superposition }
  | { ok: false; reason: 'too_few_points' | 'length_mismatch' | 'not_finite'; message: string };

/** Returns the mean of a list of points. */
function centroid(p: readonly Vec3[]): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const v of p) {
    x += v[0];
    y += v[1];
    z += v[2];
  }
  return [x / p.length, y / p.length, z / p.length];
}

/** Eigen-decomposition of a symmetric 4x4 matrix with cyclic Jacobi rotations; returns the eigenvector of the largest eigenvalue. */
function largestEigenvector4(m: number[][]): [number, number, number, number] {
  const a = m.map((r) => r.slice());
  const v = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
  const at = (r: number, c: number): number => a[r]?.[c] ?? 0;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 4; q++) off += at(p, q) ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 4; q++) {
        const apq = at(p, q);
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (at(q, q) - at(p, p)) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = at(k, p);
          const akq = at(k, q);
          (a[k] as number[])[p] = c * akp - s * akq;
          (a[k] as number[])[q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = at(p, k);
          const aqk = at(q, k);
          (a[p] as number[])[k] = c * apk - s * aqk;
          (a[q] as number[])[k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = v[k]?.[p] ?? 0;
          const vkq = v[k]?.[q] ?? 0;
          (v[k] as number[])[p] = c * vkp - s * vkq;
          (v[k] as number[])[q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (at(i, i) > at(best, best)) best = i;
  const col = (r: number): number => v[r]?.[best] ?? 0;
  return [col(0), col(1), col(2), col(3)];
}

/** Applies a rotation matrix (row-major) and translation to one point. */
export function applyTransform(
  rotation: readonly number[],
  translation: Vec3,
  p: Vec3,
): [number, number, number] {
  const r = rotation;
  return [
    (r[0] ?? 0) * p[0] + (r[1] ?? 0) * p[1] + (r[2] ?? 0) * p[2] + translation[0],
    (r[3] ?? 0) * p[0] + (r[4] ?? 0) * p[1] + (r[5] ?? 0) * p[2] + translation[1],
    (r[6] ?? 0) * p[0] + (r[7] ?? 0) * p[1] + (r[8] ?? 0) * p[2] + translation[2],
  ];
}

/** Computes RMSD between two equal-length point lists without moving them. */
export function rmsdOf(a: readonly Vec3[], b: readonly Vec3[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const p = a[i] as Vec3;
    const q = b[i] as Vec3;
    sum += (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  }
  return Math.sqrt(sum / a.length);
}

/** Finds the rotation + translation that moves `moving` onto `fixed` with minimum RMSD (always a proper rotation, never a mirror). */
export function superpose(moving: readonly Vec3[], fixed: readonly Vec3[]): SuperposeResult {
  if (moving.length !== fixed.length) {
    return { ok: false, reason: 'length_mismatch', message: 'Point lists must have the same length.' };
  }
  if (moving.length < 3) {
    return {
      ok: false,
      reason: 'too_few_points',
      message: 'At least 3 point pairs are needed to superpose.',
    };
  }
  for (const p of [...moving, ...fixed]) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) {
      return { ok: false, reason: 'not_finite', message: 'Coordinates must be finite numbers.' };
    }
  }
  const ca = centroid(moving);
  const cb = centroid(fixed);
  let sxx = 0,
    sxy = 0,
    sxz = 0,
    syx = 0,
    syy = 0,
    syz = 0,
    szx = 0,
    szy = 0,
    szz = 0;
  for (let i = 0; i < moving.length; i++) {
    const p = moving[i] as Vec3;
    const q = fixed[i] as Vec3;
    const ax = p[0] - ca[0],
      ay = p[1] - ca[1],
      az = p[2] - ca[2];
    const bx = q[0] - cb[0],
      by = q[1] - cb[1],
      bz = q[2] - cb[2];
    sxx += ax * bx;
    sxy += ax * by;
    sxz += ax * bz;
    syx += ay * bx;
    syy += ay * by;
    syz += ay * bz;
    szx += az * bx;
    szy += az * by;
    szz += az * bz;
  }
  const N = [
    [sxx + syy + szz, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ];
  const [q0, q1, q2, q3] = largestEigenvector4(N);
  const norm = Math.hypot(q0, q1, q2, q3) || 1;
  const w = q0 / norm,
    x = q1 / norm,
    y = q2 / norm,
    z = q3 / norm;
  const rotation = [
    w * w + x * x - y * y - z * z,
    2 * (x * y - w * z),
    2 * (x * z + w * y),
    2 * (x * y + w * z),
    w * w - x * x + y * y - z * z,
    2 * (y * z - w * x),
    2 * (x * z - w * y),
    2 * (y * z + w * x),
    w * w - x * x - y * y + z * z,
  ];
  const rc = applyTransform(rotation, [0, 0, 0], ca);
  const translation: Vec3 = [cb[0] - rc[0], cb[1] - rc[1], cb[2] - rc[2]];
  const moved = moving.map((p) => applyTransform(rotation, translation, p) as Vec3);
  return { ok: true, value: { rotation, translation, rmsd: rmsdOf(moved, fixed), n: moving.length } };
}
