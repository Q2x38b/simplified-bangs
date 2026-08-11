/**
 * Resolver tests. Run with `npm test`.
 *
 * These pin the semantics that all three redirect layers share, including the
 * behaviours that differed from the original implementation.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { RedirectMap, SearchEntry, SearchPayload } from '../src/lib/types.ts';
import { expandTemplate, homeUrl, parseQuery, readDefaultTrigger, resolve } from '../src/lib/resolve.ts';
import { deriveTags } from '../src/lib/tags.ts';
import { buildIndex, search } from '../src/lib/search.ts';
import { partialBang, suggest } from '../src/lib/suggest.ts';
import { loadDataset } from './dataset.ts';

const { bangs, overridden } = await loadDataset();
const map: RedirectMap = Object.fromEntries(bangs.map((b) => [b.t, b.u]));
const lookup = (t: string): string | undefined => map[t];

const stripWww = (h: string): string => h.replace(/^www\./, '').toLowerCase();
const homeMap: Record<string, string> = {};
for (const b of bangs) {
  const domain = b.d.replace(/^https?:\/\//, '').split('/')[0] ?? '';
  if (!domain) continue;
  try { if (stripWww(new URL(b.u).host) === stripWww(domain)) continue; } catch { continue; }
  homeMap[b.t] = domain.replace(/\/+$/, '');
}
const lookupHome = (t: string): string | undefined => homeMap[t];
const go = (q: string, defaultTrigger?: string): string =>
  resolve(q, lookup, { lookupHome, ...(defaultTrigger ? { defaultTrigger } : {}) })!.url;

test('parses a leading bang', () => {
  assert.deepEqual(parseQuery('!yt cats'), { trigger: 'yt', terms: 'cats', raw: '!yt cats' });
});

test('parses a trailing bang', () => {
  assert.deepEqual(parseQuery('cats !yt'), { trigger: 'yt', terms: 'cats', raw: 'cats !yt' });
});

test('parses a bang between terms', () => {
  assert.equal(parseQuery('funny !yt cats').trigger, 'yt');
  assert.equal(parseQuery('funny !yt cats').terms, 'funny cats');
});

test('ignores a mid-word exclamation mark', () => {
  // The old /!(\S+)/ matched this as bang "bar".
  assert.equal(parseQuery('foo!bar').trigger, null);
  assert.equal(parseQuery('hello world!').trigger, null);
});

test('is case-insensitive on the trigger', () => {
  assert.equal(parseQuery('!YT cats').trigger, 'yt');
});

test('substitutes every placeholder, not just the first', () => {
  // 72 templates contain {{{s}}} twice; String.replace left the second intact.
  const url = expandTemplate('https://x.test/?a={{{s}}}&b={{{s}}}', 'hi there');
  assert.equal(url, 'https://x.test/?a=hi%20there&b=hi%20there');
  assert.ok(!url.includes('{{{s}}}'));
});

test('leaves slashes unescaped for path-style templates', () => {
  assert.equal(expandTemplate('https://reddit.com/r/{{{s}}}', 'a/b'), 'https://reddit.com/r/a/b');
});

test('keeps an unknown bang in the search terms', () => {
  // The old code stripped the token and searched for the remainder only.
  const url = go('!notarealbang quantum');
  assert.ok(url.includes('google.com'), url);
  assert.ok(url.includes('notarealbang'), 'unknown trigger must survive into the query');
});

test('falls back to the default bang when there is no bang', () => {
  assert.ok(go('quantum computing').includes('google.com'));
});

test('honours a custom default bang', () => {
  assert.ok(go('cats', 'ddg').includes('duckduckgo.com'));
});

test('falls back to google when the custom default is itself unknown', () => {
  assert.ok(go('cats', 'nope-not-real').includes('google.com'));
});

test('returns null for an empty query', () => {
  assert.equal(resolve('   ', lookup), null);
});

test('reads the default-bang cookie', () => {
  assert.equal(readDefaultTrigger('a=1; default-bang=ddg; b=2'), 'ddg');
  assert.equal(readDefaultTrigger('default-bang=YT'), 'yt');
  assert.equal(readDefaultTrigger('other=1'), undefined);
  assert.equal(readDefaultTrigger(null), undefined);
  assert.equal(readDefaultTrigger('default-bang='), undefined);
});

test('every template in the dataset expands to an absolute http(s) URL', () => {
  const bad: string[] = [];
  for (const bang of bangs) {
    const url = expandTemplate(bang.u, 'test query');
    if (!/^https?:\/\//.test(url) || url.includes('{{{s}}}')) bad.push(`!${bang.t} -> ${url}`);
  }
  assert.deepEqual(bad, []);
});

test('every trigger is unique and lowercase', () => {
  const seen = new Set<string>();
  for (const bang of bangs) {
    assert.equal(bang.t, bang.t.toLowerCase(), `!${bang.t} is not lowercase`);
    assert.ok(!seen.has(bang.t), `duplicate trigger !${bang.t}`);
    seen.add(bang.t);
  }
});

test('popular bangs resolve to the expected destinations', () => {
  assert.ok(go('!g test').startsWith('https://www.google.com/search?q=test'));
  assert.ok(go('!yt test').includes('youtube.com'));
  assert.ok(go('!w test').includes('wikipedia.org'));
  assert.ok(go('!gh test').includes('github.com'));
});

test('top bangs no longer use plaintext http', () => {
  const top = bangs.slice().sort((a, b) => b.r - a.r).slice(0, 50);
  const insecure = top.filter((b) => b.u.startsWith('http://')).map((b) => `!${b.t}`);
  assert.deepEqual(insecure, []);
});

// ---------------------------------------------------------------------------
// Dataset merge + tags
// ---------------------------------------------------------------------------

test('custom bangs are merged in and reachable', () => {
  const map: RedirectMap = Object.fromEntries(bangs.map((b) => [b.t, b.u]));
  assert.equal(map['npmx'], 'https://npmx.dev/search?q={{{s}}}');
  for (const trigger of ['claude', 'shadcn', 'supabase', 'tradingview', 'duckduckgo', 'wapo']) {
    assert.ok(map[trigger], `!${trigger} should exist`);
  }
});

test('custom bangs do not silently shadow upstream ones', () => {
  // If this ever fails, decide deliberately whether the override is wanted.
  assert.deepEqual(overridden, []);
});

test('tags are derived and normalised', () => {
  const claude = bangs.find((b) => b.t === 'claude')!;
  const tags = deriveTags(claude);
  assert.ok(tags.includes('ai'));
  assert.ok(tags.includes('llm'));
  assert.ok(tags.every((t) => t === t.toLowerCase() && !/[()]/.test(t)));
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function buildPayload(): SearchPayload {
  const tagCounts = new Map<string, number>();
  const perBang = bangs.map((b) => {
    const tags = deriveTags(b);
    for (const t of tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    return tags;
  });
  const ordered = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const ids = new Map(ordered.map(([t], i) => [t, i]));
  return {
    tags: ordered.map(([t]) => t),
    entries: bangs.map((b, i): SearchEntry => [b.t, b.s, b.d, b.r, perBang[i]!.map((t) => ids.get(t)!)]),
  };
}

const payload = buildPayload();
const index = buildIndex(payload);

test('an exact trigger ranks first', () => {
  assert.equal(search(index, 'npmx')[0]?.[0], 'npmx');
  assert.equal(search(index, 'claude')[0]?.[0], 'claude');
  assert.equal(search(index, 'gh')[0]?.[0], 'gh');
});

test('searching matches names and domains, not just triggers', () => {
  assert.ok(search(index, 'youtube').some((e) => e[0] === 'yt'));
  assert.ok(search(index, 'wikipedia').some((e) => e[0] === 'w'));
});

test('tags are searchable as text', () => {
  const hits = search(index, 'llm').map((e) => e[0]);
  assert.ok(hits.includes('claude'), 'expected !claude among llm results');
});

test('tag filtering narrows results', () => {
  const aiTag = payload.tags.indexOf('ai');
  assert.ok(aiTag >= 0);
  const filtered = search(index, '', { tagFilter: [aiTag] });
  assert.ok(filtered.length > 0);
  assert.ok(filtered.every((e) => e[4].includes(aiTag)));
});

test('an empty query with no tags returns nothing', () => {
  assert.deepEqual(search(index, ''), []);
});

test('search stays fast on the full dataset', () => {
  const start = performance.now();
  for (const q of ['a', 'go', 'you', 'git', 'wiki', 'ai', 'doc', 'red', 'ama', 'sta']) search(index, q);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 250, `10 queries took ${elapsed.toFixed(0)}ms`);
});

test('a weak trigger prefix does not outrank a semantic match', () => {
  // "ai" prefix-matches !aiden, !airframes, !airlinehyd... none of which are
  // what anyone means. Bangs tagged `ai` should come first after !ai itself.
  const hits = search(index, 'ai').map((e) => e[0]);
  assert.equal(hits[0], 'ai', 'exact trigger still wins');
  const claude = hits.indexOf('claude');
  const aiden = hits.indexOf('aiden');
  assert.ok(claude >= 0, '!claude should appear for "ai"');
  assert.ok(aiden === -1 || claude < aiden, `!claude (${claude}) should rank above !aiden (${aiden})`);
});

test('popular bangs win ties', () => {
  const hits = search(index, 'goog').map((e) => e[0]);
  assert.ok(hits.indexOf('google') < 5, `expected !google near the top, got ${hits.slice(0, 5).join(', ')}`);
});

test('multi-word queries still resolve', () => {
  assert.ok(search(index, 'hugging face').some((e) => e[0] === 'hf'));
  assert.ok(search(index, 'stack overflow').some((e) => e[0] === 'so'));
});

// ---------------------------------------------------------------------------
// Bare bang: a trigger with no terms goes to the site itself
// ---------------------------------------------------------------------------

test('a bare bang navigates to the site, not an empty search', () => {
  assert.equal(go('!gh'), 'https://github.com');
  assert.equal(go('!yt'), 'https://www.youtube.com');
  assert.equal(go('!npmx'), 'https://npmx.dev');
  assert.equal(go('!claude'), 'https://claude.ai');
  assert.equal(go('!so'), 'https://stackoverflow.com');
});

test('a bare bang whose template is a site-scoped search uses the real site', () => {
  // !bun's template searches DuckDuckGo with site:bun.sh — the origin would be
  // duckduckgo.com, which is not where the user wants to land.
  assert.equal(go('!bun'), 'https://bun.sh');
  assert.equal(go('!tailwind'), 'https://tailwindcss.com');
  assert.equal(go('!vercel'), 'https://vercel.com');
});

test('trailing whitespace still counts as bare', () => {
  assert.equal(go('!gh   '), 'https://github.com');
});

test('bare is flagged on the resolution', () => {
  assert.equal(resolve('!gh', lookup, { lookupHome })!.bare, true);
  assert.equal(resolve('!gh issues', lookup, { lookupHome })!.bare, false);
  assert.equal(resolve('hello', lookup, { lookupHome })!.bare, false);
});

test('a bang with terms is unaffected', () => {
  assert.ok(go('!gh esbuild').includes('github.com/search'));
  assert.ok(go('!yt cats').includes('search_query=cats'));
});

test('an unknown bare bang still falls back to search', () => {
  const url = go('!notarealbang');
  assert.ok(url.includes('google.com'));
  assert.ok(url.includes('notarealbang'));
});

test('homeUrl prefers an explicit override', () => {
  assert.equal(homeUrl('https://duckduckgo.com/?q={{{s}}}+site%3Abun.sh', 'bun.sh'), 'https://bun.sh');
  assert.equal(homeUrl('https://example.com/search?q={{{s}}}'), 'https://example.com');
  assert.equal(homeUrl('not a url'), null);
});

test('every bang produces a usable bare destination', () => {
  const bad: string[] = [];
  for (const b of bangs) {
    const r = resolve(`!${b.t}`, lookup, { lookupHome });
    if (!r || !/^https?:\/\//.test(r.url) || r.url.includes('{{{s}}}')) bad.push(`!${b.t} -> ${r?.url}`);
  }
  assert.deepEqual(bad.slice(0, 10), []);
});

test('a placeholder in the hostname is dropped, not navigated to', () => {
  assert.equal(go('!tor'), 'https://tor2web.org');
  assert.equal(go('!wpblog'), 'http://wordpress.com');
  assert.equal(homeUrl('https://{{{s}}}.example.com/'), 'https://example.com');
});

// ---------------------------------------------------------------------------
// OpenSearch address-bar suggestions
// ---------------------------------------------------------------------------

const suggestIndex = (() => {
  const sorted = bangs.slice().sort((a, b) => a.t.localeCompare(b.t));
  return {
    t: sorted.map((b) => b.t),
    s: sorted.map((b) => b.s),
    d: sorted.map((b) => b.d),
    r: sorted.map((b) => b.r),
  };
})();

const completions = (q: string): string[] => suggest(suggestIndex, q)[1];

test('partialBang only completes a bang at the end of the query', () => {
  assert.deepEqual(partialBang('!cl'), { prefix: 'cl', before: '' });
  assert.deepEqual(partialBang('foo !cl'), { prefix: 'cl', before: 'foo ' });
  assert.equal(partialBang('!cl '), null, 'trailing space means the token is done');
  assert.equal(partialBang('!yt cats'), null, 'bang already chosen');
  assert.equal(partialBang('hello'), null);
  assert.equal(partialBang(''), null);
  assert.deepEqual(partialBang('!'), { prefix: '', before: '' });
});

test('suggests bangs for a typed prefix, most popular first', () => {
  const hits = completions('!cl');
  assert.ok(hits.length > 0);
  assert.ok(hits.includes('!claude'), `expected !claude in ${hits.join(', ')}`);
  assert.ok(hits.every((h) => h.startsWith('!cl')));
});

test('an exact trigger floats to the top', () => {
  assert.equal(completions('!g')[0], '!g');
  assert.equal(completions('!yt')[0], '!yt');
  assert.equal(completions('!npmx')[0], '!npmx');
});

test('preserves text typed before the bang', () => {
  const hits = completions('cats !y');
  assert.ok(hits.length > 0);
  assert.ok(hits.every((h) => h.startsWith('cats !')), hits.join(', '));
});

test('returns nothing for a query that is not a bang', () => {
  // The browser sends every keystroke; anything that is not a bang gets no
  // response and is never acted on.
  assert.deepEqual(completions('hello world'), []);
  assert.deepEqual(completions('!yt cats'), []);
  assert.deepEqual(completions(''), []);
});

test('unknown prefixes yield nothing rather than noise', () => {
  assert.deepEqual(completions('!zzzzqqq'), []);
});

test('response is valid OpenSearch Suggestions shape', () => {
  const r = suggest(suggestIndex, '!cl');
  assert.equal(r.length, 4);
  assert.equal(r[0], '!cl');
  assert.ok(Array.isArray(r[1]) && Array.isArray(r[2]) && Array.isArray(r[3]));
  assert.equal(r[1].length, r[2].length, 'a description per completion');
  assert.ok(r[1].length <= 8, 'capped at 8');
  assert.ok(r[2][0]!.includes('—') || r[2][0]!.length > 0);
});

test('suggestions stay fast', () => {
  const start = performance.now();
  for (const q of ['!a', '!g', '!cl', '!you', '!wi', '!re', '!s', '!t', '!m', '!np']) completions(q);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 100, `10 suggest calls took ${elapsed.toFixed(0)}ms`);
});
