// Minimal PDB-format reader: extracts one C-alpha atom per residue (coordinates and B-factor). AlphaFold stores
// pLDDT (0-100) in the B-factor column, so it is read from there.
import type { Residue } from '../shared/domain';

const THREE_TO_ONE: Readonly<Record<string, string>> = {
  ALA: 'A',
  ARG: 'R',
  ASN: 'N',
  ASP: 'D',
  CYS: 'C',
  GLN: 'Q',
  GLU: 'E',
  GLY: 'G',
  HIS: 'H',
  ILE: 'I',
  LEU: 'L',
  LYS: 'K',
  MET: 'M',
  PHE: 'F',
  PRO: 'P',
  SER: 'S',
  THR: 'T',
  TRP: 'W',
  TYR: 'Y',
  VAL: 'V',
  SEC: 'U',
  PYL: 'O',
  MSE: 'M',
};

export type PdbParse =
  { ok: true; residues: Residue[]; meanBfactor: number | null } | { ok: false; message: string };

/** Reads C-alpha residues from PDB text (fixed-column ATOM records). Lines that do not parse cleanly fail the whole file. */
export function parsePdbResidues(text: string): PdbParse {
  const residues: Residue[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('ATOM  ')) continue;
    if (line.slice(12, 16).trim() !== 'CA') continue;
    const alt = line.charAt(16);
    if (alt !== ' ' && alt !== 'A') continue;
    const x = Number(line.slice(30, 38));
    const y = Number(line.slice(38, 46));
    const z = Number(line.slice(46, 54));
    const number = Number.parseInt(line.slice(22, 26), 10);
    const bfactor = Number(line.slice(60, 66));
    if (![x, y, z, bfactor].every(Number.isFinite) || !Number.isFinite(number)) {
      return { ok: false, message: `Malformed ATOM record: "${line.slice(0, 54)}"` };
    }
    residues.push({
      chain: line.charAt(21).trim() || 'A',
      number,
      code: THREE_TO_ONE[line.slice(17, 20).trim().toUpperCase()] ?? 'X',
      ca: [x, y, z],
      bfactor,
    });
  }
  if (residues.length === 0) return { ok: false, message: 'No C-alpha atoms found in the structure file.' };
  const mean = residues.reduce((s, r) => s + r.bfactor, 0) / residues.length;
  return { ok: true, residues, meanBfactor: mean };
}

/** Confidence band for a pLDDT value, using AlphaFold's published cut-offs (90 / 70 / 50). */
export function plddtBand(plddt: number): 'very_high' | 'confident' | 'low' | 'very_low' {
  if (plddt > 90) return 'very_high';
  if (plddt > 70) return 'confident';
  if (plddt > 50) return 'low';
  return 'very_low';
}

/** Applies a rigid transform (row-major rotation + translation) to every ATOM/HETATM coordinate of PDB text, keeping all other columns. */
export function transformPdb(
  text: string,
  rotation: readonly number[],
  translation: readonly [number, number, number],
): string {
  const r = rotation;
  const fmt = (v: number): string => v.toFixed(3).padStart(8, ' ');
  return text
    .split('\n')
    .map((line) => {
      if (!(line.startsWith('ATOM  ') || line.startsWith('HETATM'))) return line;
      const x = Number(line.slice(30, 38));
      const y = Number(line.slice(38, 46));
      const z = Number(line.slice(46, 54));
      if (![x, y, z].every(Number.isFinite)) return line;
      const nx = (r[0] ?? 0) * x + (r[1] ?? 0) * y + (r[2] ?? 0) * z + translation[0];
      const ny = (r[3] ?? 0) * x + (r[4] ?? 0) * y + (r[5] ?? 0) * z + translation[1];
      const nz = (r[6] ?? 0) * x + (r[7] ?? 0) * y + (r[8] ?? 0) * z + translation[2];
      return `${line.slice(0, 30)}${fmt(nx)}${fmt(ny)}${fmt(nz)}${line.slice(54)}`;
    })
    .join('\n');
}
