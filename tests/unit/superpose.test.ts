// Tests for src/bio/superpose.ts: Biopython reference cases plus geometric properties.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { applyTransform, rmsdOf, superpose } from '../../src/bio/superpose';
import type { Superposition, Vec3 } from '../../src/bio/superpose';

interface RefCase {
  name: string;
  moving: Vec3[];
  fixed: Vec3[];
  rotation: number[];
  translation: number[];
  rmsd: number;
}
const refs = JSON.parse(readFileSync('tests/fixtures/reference/superpose-refs.json', 'utf8')) as {
  cases: RefCase[];
};

/** Superposes and fails the test if the function refuses. */
function must(a: readonly Vec3[], b: readonly Vec3[]): Superposition {
  const r = superpose(a, b);
  if (!r.ok) throw new Error(r.message);
  return r.value;
}

/** Determinant of a row-major 3x3 matrix. */
function det3(r: readonly number[]): number {
  const g = (i: number): number => r[i] ?? 0;
  return (
    g(0) * (g(4) * g(8) - g(5) * g(7)) -
    g(1) * (g(3) * g(8) - g(5) * g(6)) +
    g(2) * (g(3) * g(7) - g(4) * g(6))
  );
}

const vec = fc.tuple(
  fc.double({ min: -50, max: 50, noNaN: true }),
  fc.double({ min: -50, max: 50, noNaN: true }),
  fc.double({ min: -50, max: 50, noNaN: true }),
);
const cloud = fc.array(vec, { minLength: 4, maxLength: 40 });

describe('superpose vs Biopython SVDSuperimposer', () => {
  for (const c of refs.cases) {
    it(`matches RMSD and transformed coordinates: ${c.name}`, () => {
      const r = must(c.moving, c.fixed);
      expect(r.rmsd).toBeCloseTo(c.rmsd, 6);
      // Rotation can be non-unique for degenerate (planar / near-planar) sets, so compare the result of applying it.
      const mine = c.moving.map((p) => applyTransform(r.rotation, r.translation, p) as Vec3);
      expect(rmsdOf(mine, c.fixed)).toBeCloseTo(c.rmsd, 6);
      if (!c.name.startsWith('planar') && !c.name.startsWith('mirror') && c.moving.length > 3) {
        r.rotation.forEach((v, i) => expect(v).toBeCloseTo(c.rotation[i] ?? NaN, 5));
        r.translation.forEach((v, i) => expect(v).toBeCloseTo(c.translation[i] ?? NaN, 4));
      }
    });
  }
});

describe('superpose properties', () => {
  it('always returns a proper rotation (orthonormal, determinant +1), even for mirror images', () => {
    fc.assert(
      fc.property(cloud, cloud, (a, b) => {
        const n = Math.min(a.length, b.length);
        const r = must(a.slice(0, n), b.slice(0, n));
        expect(det3(r.rotation)).toBeCloseTo(1, 6);
        const R = r.rotation;
        for (let i = 0; i < 3; i++)
          for (let j = 0; j < 3; j++) {
            const dot =
              (R[i * 3] ?? 0) * (R[j * 3] ?? 0) +
              (R[i * 3 + 1] ?? 0) * (R[j * 3 + 1] ?? 0) +
              (R[i * 3 + 2] ?? 0) * (R[j * 3 + 2] ?? 0);
            expect(dot).toBeCloseTo(i === j ? 1 : 0, 6);
          }
      }),
      { numRuns: 100 },
    );
  });
  it('recovers a known rigid motion exactly (RMSD ~ 0)', () => {
    fc.assert(
      fc.property(
        cloud,
        fc.double({ min: -3, max: 3, noNaN: true }),
        fc.double({ min: -3, max: 3, noNaN: true }),
        vec,
        (pts, th, ph, t) => {
          const rot = [Math.cos(th), -Math.sin(th), 0, Math.sin(th), Math.cos(th), 0, 0, 0, 1];
          const rot2 = [1, 0, 0, 0, Math.cos(ph), -Math.sin(ph), 0, Math.sin(ph), Math.cos(ph)];
          const mul = (p: Vec3): Vec3 => applyTransform(rot2, [0, 0, 0], applyTransform(rot, [0, 0, 0], p));
          const moved = pts.map((p) => {
            const q = mul(p);
            return [q[0] + t[0], q[1] + t[1], q[2] + t[2]] as Vec3;
          });
          // Skip near-degenerate clouds (all points almost identical) where the rotation is undefined.
          const first = pts[0];
          fc.pre(first !== undefined);
          const spread = Math.max(
            ...pts.map((p) => Math.hypot(p[0] - first[0], p[1] - first[1], p[2] - first[2])),
          );
          fc.pre(spread > 1);
          expect(must(pts, moved).rmsd).toBeLessThan(1e-6);
        },
      ),
      { numRuns: 100 },
    );
  });
  it('never does worse than leaving the points where they are, and is symmetric', () => {
    fc.assert(
      fc.property(cloud, cloud, (a, b) => {
        const n = Math.min(a.length, b.length);
        const x = a.slice(0, n);
        const y = b.slice(0, n);
        const ab = must(x, y).rmsd;
        expect(ab).toBeLessThanOrEqual(rmsdOf(x, y) + 1e-9);
        expect(must(y, x).rmsd).toBeCloseTo(ab, 6);
      }),
      { numRuns: 100 },
    );
  });
});

describe('superpose input checks', () => {
  it('rejects mismatched lengths, too few points and non-finite coordinates', () => {
    expect(superpose([[0, 0, 0]], [])).toMatchObject({ ok: false, reason: 'length_mismatch' });
    expect(
      superpose(
        [
          [0, 0, 0],
          [1, 0, 0],
        ],
        [
          [0, 0, 0],
          [1, 0, 0],
        ],
      ),
    ).toMatchObject({ ok: false, reason: 'too_few_points' });
    expect(
      superpose(
        [
          [0, 0, 0],
          [1, 0, 0],
          [NaN, 0, 0],
        ],
        [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
      ),
    ).toMatchObject({ ok: false, reason: 'not_finite' });
  });
});
