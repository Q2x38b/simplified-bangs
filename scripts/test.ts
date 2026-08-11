/**
 * Resolver tests. Run with `npm test`.
 *
 * These pin the semantics that all three redirect layers share, including the
 * behaviours that differed from the original implementation.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Bang, RedirectMap } from '../src/lib/types.ts';
import { expandTemplate, parseQuery, readDefaultTrigger, resolve } from '../src/lib/resolve.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const bangs: Bang[] = JSON.parse(await readFile(`${ROOT}src/data/bangs.json`, 'utf8'));
const map: RedirectMap = Object.fromEntries(bangs.map((b) => [b.t, b.u]));
const lookup = (t: string): string | undefined => map[t];
const go = (q: string, defaultTrigger?: string): string =>
  resolve(q, lookup, defaultTrigger ? { defaultTrigger } : {})!.url;

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
