# simplified-bangs

Fast DuckDuckGo-style `!bang` redirects. Add `https://bang.e108.dev/?q=%s` as a
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
middleware.ts            Edge redirect — the primary path
src/lib/resolve.ts       Shared resolution logic (the only copy)
src/lib/types.ts         Bang, SearchEntry, RedirectMap
src/data/bangs.json      Source of truth: 13,569 bangs
src/data/https-hosts.json  Hosts verified to answer over HTTPS
src/client/              boot / sw / search / landing entry points
src/pages/               HTML templates
src/generated/           Built artifact, committed so deploys are deterministic
scripts/build.ts         Builds dist/ and src/generated/
scripts/test.ts          Resolver tests
scripts/probe-https.ts   Re-probes hosts for HTTPS support
```

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

Edit `src/data/bangs.json` (`t` trigger, `s` name, `d` domain, `c`/`sc`
category, `r` relevance, `u` URL template with `{{{s}}}` placeholders), then
`npm run build && npm test`.

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
