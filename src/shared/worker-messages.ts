// Messages between the UI and the alignment worker, shared so both sides agree on the shape.
import type { AlignResult } from '../bio/align';

export interface AlignRequest {
  a: string;
  b: string;
}

export type AlignResponse = { type: 'progress'; fraction: number } | { type: 'done'; result: AlignResult };
