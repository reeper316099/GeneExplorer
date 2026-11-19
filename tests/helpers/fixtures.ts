// Loads recorded real API responses from tests/fixtures/api for parser and contract tests.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FetchMeta } from '../../src/shared/types';

const DIR = path.resolve('tests/fixtures/api');

/** Reads a recorded response as text. */
export function fixtureText(name: string): string {
  return readFileSync(path.join(DIR, name), 'utf8');
}

/** Reads a recorded JSON response (unknown shape on purpose: parsers must validate it). */
export function fixtureJson(name: string): unknown {
  return JSON.parse(fixtureText(`${name}.json`)) as unknown;
}

/** Fetch metadata with a fixed time so provenance assertions are deterministic. */
export function meta(url = 'https://example.test/fixture', fetchedAt = 1_700_000_000_000): FetchMeta {
  return { url, fetchedAt, fromCache: false, stale: false, bytes: 0 };
}

/** Returns the value or fails the test: for IDs that a test knows are valid (keeps branded-ID parsers out of the way). */
export function need<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('test setup: expected a value');
  return v;
}
