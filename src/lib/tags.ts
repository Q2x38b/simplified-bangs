/**
 * Tag derivation.
 *
 * Tags come from three places, in order of trust: curated `tg` values on
 * `extra-bangs.json` entries, then the DuckDuckGo category and sub-category.
 * Upstream categories are inconsistently cased and occasionally parenthesised
 * ("Downloads (apps)"), so they get normalised and mapped onto a small
 * controlled vocabulary before being used as facets.
 */
import type { Bang } from './types.js';

/**
 * Collapses upstream category noise onto stable tag names. Anything not listed
 * passes through normalised, which keeps long-tail categories searchable
 * without having to enumerate all of them.
 */
const ALIASES: Record<string, string> = {
  'multimedia': 'media',
  'online': 'web',
  'tech': 'tech',
  'programming': 'developer',
  'computing': 'tech',
  'research': 'research',
  'entertainment': 'entertainment',
  'shopping': 'shopping',
  'things': 'shopping',
  'news': 'news',
  'man pages': 'docs',
  'documentation': 'docs',
  'reference': 'docs',
  'social': 'social',
  'social networks': 'social',
  'translation': 'language',
  'dictionaries': 'language',
  'languages': 'language',
  'sports': 'sports',
  'travel': 'travel',
  'maps': 'maps',
  'music': 'music',
  'video': 'video',
  'images': 'images',
  'pictures': 'images',
  'downloads apps': 'apps',
  'apps': 'apps',
  'games': 'games',
  'gaming': 'games',
  'finance': 'finance',
  'business': 'finance',
  'health': 'health',
  'science': 'science',
  'education': 'education',
  'universities': 'education',
  'food': 'food',
  'recipes': 'food',
  'design': 'design',
  'ai': 'ai',
};

function normalise(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/[^a-z0-9+ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return ALIASES[cleaned] ?? cleaned;
}

/** Distinct, normalised tags for one bang. Curated tags come first. */
export function deriveTags(bang: Bang): string[] {
  const tags = new Set<string>();
  for (const tag of bang.tg ?? []) {
    const normalised = normalise(tag);
    if (normalised) tags.add(normalised);
  }
  for (const source of [bang.c, bang.sc]) {
    if (!source) continue;
    const normalised = normalise(source);
    // Very long category strings are descriptions, not facets.
    if (normalised && normalised.length <= 24) tags.add(normalised);
  }
  return [...tags];
}
