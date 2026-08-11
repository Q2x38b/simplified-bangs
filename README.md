# simplified-bangs

Fast DuckDuckGo-style `!bang` redirects, resolved at the edge. Add `https://bang.e108.dev/?q=%s` as a
custom search engine and every DuckDuckGo bang works, resolved at the edge.

## How a redirect is served

Three layers answer the same query with the same logic. Each one is a fallback
for the one above it, so a failure anywhere degrades speed, never correctness.

| Layer | When it runs | Cost |
| --- | --- | --- |
| **Service worker** (`src/client/sw.ts`) | Repeat visitors | No network at all, ~1–3 ms |
| **Edge middleware** (`middleware.ts`) | Every other request | One round trip to the nearest PoP; lookup is ~1.7 µs |
| **Inline `<head>` script** (`src/client/boot.ts`) | Only if middleware is unavailable | Synchronous, before any CSS or `DOMContentLoaded` |

All three import [`src/lib/resolve.ts`](src/lib/resolve.ts), so bang parsing,
placeholder substitution and default-bang handling can't drift apart.

The browser never downloads the bang database to follow a redirect. The
middleware compiles the whole trigger → URL map into its own bundle (249 KB
gzipped, in-memory hash lookup), and the search page loads a separate index that
omits the URLs it doesn't need.

## Layout

```
middleware.ts              Edge redirect — the primary path
src/lib/resolve.ts         Shared resolution logic (the only copy)
src/lib/search.ts          Search engine for the modal (pure, no DOM)
src/lib/tags.ts            Tag derivation and normalisation
src/lib/analytics.ts       Optional anonymous edge counters
src/lib/types.ts           Bang, SearchEntry, SearchPayload, RedirectMap
src/data/bangs.json        Upstream DuckDuckGo list (13,569)
src/data/extra-bangs.json  Curated additions (62) — edit this, not the above
src/data/https-hosts.json  Hosts verified to answer over HTTPS
src/client/                boot / sw / landing / search-modal entry points
src/components/ui/         shadcn/ui components (Dialog, Command)
src/pages/                 HTML templates
src/generated/             Built artifact, committed so deploys are deterministic
scripts/build.ts           Builds dist/ and src/generated/
scripts/test.ts            Resolver, dataset and search tests
scripts/probe-https.ts     Re-probes hosts for HTTPS support
```

## Bare bangs

A bang used on its own goes to the site rather than searching it for nothing:
`!gh` → github.com, `!claude` → claude.ai. The template's own origin is right
for all but 32 bangs — the ones whose template is a site-scoped search, where
the origin would be duckduckgo.com — and those carry an explicit domain
override (0.3 KB gzipped). Six bangs put the placeholder in the hostname
(`{{{s}}}.tor2web.org`); that label is dropped rather than navigated to.

## Search

Press <kbd>⌘K</kbd> (or <kbd>/</kbd>, or the "bang search" link in the footer)
anywhere on the landing page. It's a shadcn/ui command palette — React, Radix and cmdk — that is
**lazily loaded**: ~88 KB gzipped fetched only when you actually open it, and
never on the redirect path, which is answered at the edge with no client code at
all. `/search` redirects to `/#search`, which deep-links straight into the modal.

Results are ranked by match quality with a bounded popularity boost, so an exact
trigger wins, then exact name/tag matches, then partial prefixes weighted by how
much of the target they cover. Tag chips below the input filter the results
(AND across selected tags) and follow whatever is currently matching.

## Development

```bash
npm install
npm run build      # -> dist/ and src/generated/redirect-map.ts
npm test           # resolver + dataset invariants
npm run typecheck
```

`src/generated/redirect-map.ts` is committed because the edge middleware imports
it. **Re-run `npm run build` and commit the result after editing
`src/data/bangs.json`** — `npm test` will fail if the two disagree.

## Deploying

Vercel, with `vercel.json` supplying the build command and cache headers.
Content-hashed data and assets are served `immutable` for a year; HTML is served
from the CDN with `stale-while-revalidate`.

## Adding or editing a bang

Add it to **`src/data/extra-bangs.json`**, then `npm run build && npm test`.

Fields: `t` trigger, `s` name, `d` domain, `c`/`sc` category, `r` relevance,
`u` URL template with `{{{s}}}` placeholders, and optional `tg` tags. Entries
here win over an upstream bang with the same trigger, so re-importing
DuckDuckGo's list never clobbers a custom one — and a test fails if a custom
bang starts shadowing an upstream one without you deciding to.

Where a site has no reliable search URL, the template uses a site-scoped
DuckDuckGo query (`?q={{{s}}}+site%3Aexample.com`) rather than dropping the
user's query on the floor.

## Analytics

Off by default and entirely optional. Because a bang is a 302 from the edge, no
HTML is ever rendered, so no client-side analytics script can observe a redirect
— counting has to happen in the middleware.

Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in the Vercel project
to enable it. Each redirect then increments two integers via `waitUntil`, off the
critical path:

    HINCRBY bangs:<YYYY-MM-DD> <trigger> 1
    INCR    total:<YYYY-MM-DD>

Recorded: the bang trigger and the UTC date. Not recorded: search terms, IP,
user agent, referrer, cookies, or any identifier. There are no per-user records
at all — only aggregate counters — so there is nothing to anonymise later and no
consent banner to show. Unknown triggers are bucketed as `(unknown)` rather than
written verbatim, since they are attacker-controlled text.

## Dataset notes

The list originates from [DuckDuckGo's bang.js](https://duckduckgo.com/bang.js).
Fixes applied on import, each covered by a test:

- **Duplicate triggers removed.** `!pi` and `!ddg` each appeared twice; the
  higher-relevance entry wins.
- **3,086 templates upgraded to HTTPS**, including `!wikipedia`, `!imdb`, `!m`,
  `!s`, `!sr` and `!wikt`. An `http://` destination costs an extra round trip and
  TLS handshake before the site redirects you to HTTPS. Only hosts that
  `scripts/probe-https.ts` actually reached over TLS were upgraded; the remaining
  3,280 are unreachable over HTTPS and were left alone.
- **17 site-relative URLs rebased onto `duckduckgo.com`.** `!pdf`, `!safe`,
  `!xkcd` and friends were stored as `/?q=…`, which previously resolved against
  this site and bounced the user back through it.
