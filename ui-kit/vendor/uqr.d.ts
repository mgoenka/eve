/* generated from app-platform/ui-kit — edit there and re-sync. */
/** Types for the vendored uqr encoder (MIT, see uqr.js header). */
export interface QrEncodeOptions {
  ecc?: 'L' | 'M' | 'Q' | 'H';
  maskPattern?: number;
  boostEcc?: boolean;
  minVersion?: number;
  maxVersion?: number;
  border?: number;
  invert?: boolean;
}
export interface QrEncodeResult {
  version: number;
  size: number;
  maskPattern: number;
  /** true = dark module */
  data: boolean[][];
  types: number[][];
}
export declare function encode(data: string | ReadonlyArray<number>, options?: QrEncodeOptions): QrEncodeResult;
