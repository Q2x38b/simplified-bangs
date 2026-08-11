/**
 * Search engine for the bang modal. Pure — no DOM, no React.
 *
 * Prefix queries binary-search two sorted arrays, so per-keystroke cost is
 * proportional to the number of *matches* rather than to the ~13.6k entries in
 * the dataset. Tag filtering is a bitset-free id intersection over the small
 * interned tag ids each entry carries.
 */
import type { SearchEntry, SearchPayload } from './types.js';

export const MAX_RESULTS = 50;

export interface SearchIndex {
  payload: SearchPayload;
  /** Sorted triggers with a parallel array of owning entry indices. */
  triggers: string[];
  triggerOwner: Int32Array;
  /** Sorted distinct words from names/domains/tags, and their owning entries. */
  words: string[];
  wordOwners: number[][];
}

/** Half-open range of indices in `sorted` whose elements start with `prefix`. */
function prefixRange(sorted: readonly string[], prefix: string): [number, number] {
  const lowerBound = (target: string): number => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return [lowerBound(prefix), lowerBound(prefix + '￿')];
}

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9+]+/i)
    .filter((word) => word.length > 1);
}

export function buildIndex(payload: SearchPayload): SearchIndex {
  const triggerPairs: Array<[string, number]> = [];
  const wordMap = new Map<string, number[]>();

  payload.entries.forEach((entry, idx) => {
    const [trigger, name, domain, , tagIds] = entry;
    if (trigger) triggerPairs.push([trigger.toLowerCase(), idx]);

    const words = new Set([...tokenize(name), ...tokenize(domain)]);
    // Tags are searchable text too, so "!ai chat" finds every LLM bang.
    for (const id of tagIds) for (const word of tokenize(payload.tags[id] ?? '')) words.add(word);

    for (const word of words) {
      let owners = wordMap.get(word);
      if (!owners) wordMap.set(word, (owners = []));
      owners.push(idx);
    }
  });

  triggerPairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const triggerOwner = new Int32Array(triggerPairs.length);
  triggerPairs.forEach(([, idx], i) => {
    triggerOwner[i] = idx;
  });

  const words = [...wordMap.keys()].sort();
  return {
    payload,
    triggers: triggerPairs.map(([trigger]) => trigger),
    triggerOwner,
    words,
    wordOwners: words.map((word) => wordMap.get(word)!),
  };
}

/**
 * Scoring.
 *
 * Prefix scores scale by how much of the target the term actually covers, so
 * "ai" scores far higher against `!ai` than against `!airlinehyd`. Without
 * that, every incidental trigger prefix outranked genuinely relevant matches —
 * searching "ai" surfaced `!aiden` and `!airframes` above `!claude`.
 *
 * An exact word match (name, domain or tag) therefore outranks a weak trigger
 * prefix, and popularity is folded in as a bounded additive boost rather than a
 * pure tiebreak so it can separate otherwise equal matches.
 */
const SCORE_EXACT_TRIGGER = 1_000_000;
const SCORE_WORD_EXACT = 5_000;
const SCORE_TRIGGER_PREFIX = 4_000;
const SCORE_WORD_PREFIX = 800;
/** A single short term can prefix-match thousands of words; cap the fan-out. */
const MAX_WORD_FANOUT = 400;

/** Bounded popularity boost: ~0 for unranked bangs, ~950 for `!g`. */
function relevanceBoost(relevance: number): number {
  return Math.log10(Math.max(relevance, 0) + 1) * 150;
}

export interface SearchOptions {
  /** Tag ids that a result must *all* carry. */
  tagFilter?: readonly number[];
  limit?: number;
}

export function search(index: SearchIndex, rawQuery: string, options: SearchOptions = {}): SearchEntry[] {
  const { tagFilter = [], limit = MAX_RESULTS } = options;
  const terms = tokenize(rawQuery.replace(/^!/, ''));

  const matchesTags = (entry: SearchEntry): boolean =>
    tagFilter.length === 0 || tagFilter.every((id) => entry[4].includes(id));

  // Tag-only browsing: no query text, just facets.
  if (terms.length === 0) {
    if (tagFilter.length === 0) return [];
    const out: SearchEntry[] = [];
    for (const entry of index.payload.entries) {
      if (matchesTags(entry)) {
        out.push(entry);
        if (out.length >= limit) break; // entries are already relevance-sorted
      }
    }
    return out;
  }

  const scores = new Map<number, number>();
  const bump = (idx: number, amount: number): void => {
    scores.set(idx, (scores.get(idx) ?? 0) + amount);
  };

  for (const term of terms) {
    const [tLo, tHi] = prefixRange(index.triggers, term);
    for (let i = tLo; i < tHi; i++) {
      const trigger = index.triggers[i]!;
      const score =
        trigger === term ? SCORE_EXACT_TRIGGER : SCORE_TRIGGER_PREFIX * (term.length / trigger.length);
      bump(index.triggerOwner[i]!, score);
    }

    const [wLo, wHi] = prefixRange(index.words, term);
    for (let i = wLo; i < Math.min(wHi, wLo + MAX_WORD_FANOUT); i++) {
      const word = index.words[i]!;
      const score = word === term ? SCORE_WORD_EXACT : SCORE_WORD_PREFIX * (term.length / word.length);
      for (const idx of index.wordOwners[i]!) bump(idx, score);
    }
  }

  const entries = index.payload.entries;
  return [...scores.entries()]
    .filter(([idx]) => matchesTags(entries[idx]!))
    .map(([idx, score]): [number, number] => [idx, score + relevanceBoost(entries[idx]![3])])
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([idx]) => entries[idx]!);
}

/** Tags present on the current result set, ordered by frequency — for facet chips. */
export function facets(payload: SearchPayload, entries: readonly SearchEntry[], limit = 12): number[] {
  const counts = new Map<number, number>();
  for (const entry of entries) for (const id of entry[4]) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, limit)
    .map(([id]) => id);
}
