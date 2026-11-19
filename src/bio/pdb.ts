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
