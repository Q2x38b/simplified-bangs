/** Loads and merges the dataset. Shared by the build and the tests so they cannot disagree. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Bang } from '../src/lib/types.ts';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

export interface Dataset {
  bangs: Bang[];
  upstreamCount: number;
  extraCount: number;
  /** Custom triggers that shadow an upstream one. */
  overridden: string[];
}

export async function loadDataset(): Promise<Dataset> {
  const upstream: Bang[] = JSON.parse(await readFile(`${ROOT}src/data/bangs.json`, 'utf8'));
  const extras: Bang[] = JSON.parse(await readFile(`${ROOT}src/data/extra-bangs.json`, 'utf8'));

  // Extras win on a collision, so re-importing DuckDuckGo's list can never
  // silently drop a curated bang.
  const merged = new Map<string, Bang>();
  for (const bang of upstream) merged.set(bang.t.toLowerCase(), bang);
  const overridden: string[] = [];
  for (const bang of extras) {
    if (merged.has(bang.t.toLowerCase())) overridden.push(bang.t);
    merged.set(bang.t.toLowerCase(), bang);
  }

  const bangs = [...merged.values()];
  // Highest relevance first: the hot set and the search tie-breaker rely on it.
  bangs.sort((a, b) => b.r - a.r || a.t.localeCompare(b.t));

  return { bangs, upstreamCount: upstream.length, extraCount: extras.length, overridden };
}
