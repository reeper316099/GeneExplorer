// Runs the app's own aligner and superposition on inputs prepared by tools/crosscheck.py (fresh data, Biopython results
// kept separate) and writes the app's answers as JSON. Usage: node scripts/run-tool.mjs tools/crosscheck.ts <in.json> <out.json>
import { promises as fs } from 'node:fs';
import { alignGlobal } from '../src/bio/align';
import { superpose } from '../src/bio/superpose';
import type { Vec3 } from '../src/bio/superpose';

interface In {
  pairs: { name: string; a: string; b: string }[];
  structures: { name: string; moving: Vec3[]; fixed: Vec3[] }[];
}

async function main(): Promise<void> {
  const [inPath, outPath] = process.argv.slice(2);
  if (!inPath || !outPath) throw new Error('usage: crosscheck.ts <in.json> <out.json>');
  const input = JSON.parse(await fs.readFile(inPath, 'utf8')) as In;
  const t0 = performance.now();
  const alignments = input.pairs.map((p) => {
    const r = alignGlobal(p.a, p.b);
    return r.ok
      ? { name: p.name, score: r.alignment.score, identities: r.alignment.stats.identities }
      : { name: p.name, error: r.message };
  });
  const t1 = performance.now();
  const structures = input.structures.map((s) => {
    const r = superpose(s.moving, s.fixed);
    return r.ok ? { name: s.name, rmsd: r.value.rmsd, n: r.value.n } : { name: s.name, error: r.message };
  });
  await fs.writeFile(
    outPath,
    JSON.stringify({ alignments, structures, alignMs: t1 - t0, superposeMs: performance.now() - t1 }),
  );
}
void main();
