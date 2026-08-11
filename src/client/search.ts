/**
 * Bang search page.
 *
 * The previous implementation walked all ~13.5k entries of the trigger index on
 * every keystroke and de-duplicated with `Array.indexOf` inside a `filter`
 * (quadratic). This builds two sorted arrays once and answers prefix queries
 * with a binary search, so per-keystroke cost is proportional to the number of
 * *matches* rather than the size of the dataset.
 */
import type { SearchEntry } from '../lib/types.js';

declare const __SEARCH_INDEX_URL__: string;

const MAX_RESULTS = 30;
const DEBOUNCE_MS = 60;

interface Index {
  entries: readonly SearchEntry[];
  /** Sorted triggers, with a parallel array of the entry each one belongs to. */
  triggers: readonly string[];
  triggerOwner: Readonly<Int32Array>;
  /** Sorted distinct words from name/domain/category, and their owning entries. */
  words: readonly string[];
  wordOwners: readonly (readonly number[])[];
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
  // `￿` sorts after any character that can follow the prefix.
  return [lowerBound(prefix), lowerBound(prefix + '￿')];
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9+]+/i)
    .filter((word) => word.length > 1);
}

function buildIndex(entries: readonly SearchEntry[]): Index {
  const triggerPairs: Array<[string, number]> = [];
  const wordMap = new Map<string, number[]>();

  entries.forEach((entry, idx) => {
    const [trigger, name, domain, category] = entry;
    if (trigger) triggerPairs.push([trigger.toLowerCase(), idx]);
    for (const word of new Set([...tokenize(name), ...tokenize(domain), ...tokenize(category)])) {
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
    entries,
    triggers: triggerPairs.map(([trigger]) => trigger),
    triggerOwner,
    words,
    wordOwners: words.map((word) => wordMap.get(word)!),
  };
}

// Scores are additive; relevance only breaks ties within a match tier.
const SCORE_EXACT_TRIGGER = 1_000_000;
const SCORE_TRIGGER_PREFIX = 10_000;
const SCORE_WORD = 100;

function search(index: Index, rawQuery: string): SearchEntry[] {
  const terms = tokenize(rawQuery.replace(/^!/, ''));
  if (terms.length === 0) return [];

  const scores = new Map<number, number>();
  const bump = (idx: number, amount: number): void => {
    scores.set(idx, (scores.get(idx) ?? 0) + amount);
  };

  for (const term of terms) {
    const [tLo, tHi] = prefixRange(index.triggers, term);
    for (let i = tLo; i < tHi; i++) {
      const idx = index.triggerOwner[i]!;
      bump(idx, index.triggers[i] === term ? SCORE_EXACT_TRIGGER : SCORE_TRIGGER_PREFIX);
    }

    const [wLo, wHi] = prefixRange(index.words, term);
    // A very short term can match thousands of words; cap the fan-out so typing
    // a single letter stays cheap.
    for (let i = wLo; i < Math.min(wHi, wLo + 400); i++) {
      for (const idx of index.wordOwners[i]!) bump(idx, index.words[i] === term ? SCORE_WORD * 2 : SCORE_WORD);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || index.entries[b[0]]![4] - index.entries[a[0]]![4])
    .slice(0, MAX_RESULTS)
    .map(([idx]) => index.entries[idx]!);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const input = document.getElementById('search-input') as HTMLInputElement;
const results = document.getElementById('results-container') as HTMLElement;

function message(text: string): void {
  results.replaceChildren();
  if (!text) return;
  const el = document.createElement('div');
  el.className = 'no-results';
  el.textContent = text;
  results.append(el);
}

function chip(entry: SearchEntry): HTMLElement {
  const [trigger, name, domain, category] = entry;

  const code = document.createElement('span');
  code.className = 'bang-code';
  code.textContent = `!${trigger}`;

  const title = document.createElement('div');
  title.className = 'bang-name';
  title.textContent = name || 'Unnamed bang';

  const host = document.createElement('div');
  host.className = 'bang-domain';
  host.textContent = domain || 'No domain';

  const info = document.createElement('div');
  info.className = 'bang-info';
  info.append(title, host);

  // textContent throughout: the dataset is third-party and previously went
  // through innerHTML, which made every name and domain an injection vector.
  const el = document.createElement('button');
  el.className = 'bang-chip';
  el.type = 'button';
  el.append(code, info);
  if (category) el.title = `Category: ${category}`;
  el.addEventListener('click', () => {
    void navigator.clipboard?.writeText(`!${trigger}`);
    el.classList.add('copied');
    setTimeout(() => el.classList.remove('copied'), 1200);
  });
  return el;
}

function render(matches: readonly SearchEntry[], total: number): void {
  if (matches.length === 0) {
    message('No matching bangs found');
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const entry of matches) fragment.append(chip(entry));
  if (total > matches.length) {
    const note = document.createElement('div');
    note.className = 'no-results';
    note.textContent = `Showing ${matches.length} best matches. Keep typing to narrow it down.`;
    fragment.append(note);
  }
  results.replaceChildren(fragment);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

let index: Index | null = null;
let pending = '';
let timer: number | undefined;

function run(query: string): void {
  if (!index) return;
  const trimmed = query.trim();
  if (trimmed.length === 0) return message('');
  if (trimmed.length < 2) return message('Type at least 2 characters to search…');
  const matches = search(index, trimmed);
  render(matches, matches.length);
}

input.addEventListener('input', () => {
  const value = input.value;
  if (value === pending) return;
  pending = value;
  clearTimeout(timer);
  timer = setTimeout(() => run(value), DEBOUNCE_MS) as unknown as number;
});

input.focus();
message('Loading bangs…');

fetch(__SEARCH_INDEX_URL__)
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<SearchEntry[]>;
  })
  .then((entries) => {
    index = buildIndex(entries);
    message('');
    if (pending.trim()) run(pending);
  })
  .catch(() => message('Could not load the bang list. Check your connection and reload.'));
