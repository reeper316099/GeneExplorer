// The pLDDT colour scale must match AlphaFold's standard bands exactly (applied per residue in the 3D view).
import { describe, expect, it } from 'vitest';
import { plddtColor } from '../../src/ui/viewer3d';

describe('plddtColor', () => {
  it('uses AlphaFold standard colours at the band edges', () => {
    expect([95, 90.1, 90, 80, 70.1, 70, 60, 50.1, 50, 10, 0].map(plddtColor)).toEqual([
      '#0053D6',
      '#0053D6',
      '#65CBF3',
      '#65CBF3',
      '#65CBF3',
      '#FFDB13',
      '#FFDB13',
      '#FFDB13',
      '#FF7D45',
      '#FF7D45',
      '#FF7D45',
    ]);
  });
});
