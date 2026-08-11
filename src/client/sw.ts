/// <reference lib="webworker" />
/**
 * Service worker — the fastest redirect layer.
 *
 * Once installed it answers `/?q=...` navigations directly from a locally
 * cached copy of the redirect map, so a bang resolves with *zero* network
 * requests (~1-3 ms) and keeps working offline. If anything is missing or
 * stale it simply declines to handle the request and the edge middleware takes
 * over, so this can never make a redirect fail — only skip a round trip.
 */
import type { RedirectPayload } from '../lib/types.js';
import { DEFAULT_BANG_COOKIE, DEFAULT_TRIGGER, resolve } from '../lib/resolve.js';

declare const self: ServiceWorkerGlobalScope;

// Injected by the build (esbuild `define`).
declare const __REDIRECT_MAP_URL__: string;
declare const __BUILD_ID__: string;
declare const __PRECACHE__: readonly string[];

const CACHE = `bangs-${__BUILD_ID__}`;

/** Parsed payload, memoised for the lifetime of this worker instance. */
let mapPromise: Promise<RedirectPayload | null> | null = null;

function loadMap(): Promise<RedirectPayload | null> {
  mapPromise ??= (async () => {
    try {
      const cache = await caches.open(CACHE);
      const hit = (await cache.match(__REDIRECT_MAP_URL__)) ?? (await fetch(__REDIRECT_MAP_URL__));
      if (!hit.ok) return null;
      return (await hit.json()) as RedirectPayload;
    } catch {
      return null;
    }
  })();
  return mapPromise;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll([__REDIRECT_MAP_URL__, ...__PRECACHE__]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith('bangs-') && n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

async function readDefaultTrigger(): Promise<string> {
  // `cookieStore` is the only way to read cookies from a worker; where it is
  // unavailable we just use the global default.
  const store = (self as unknown as { cookieStore?: { get(name: string): Promise<{ value: string } | null> } })
    .cookieStore;
  if (!store) return DEFAULT_TRIGGER;
  try {
    const cookie = await store.get(DEFAULT_BANG_COOKIE);
    const value = cookie?.value?.toLowerCase();
    return value && value.length <= 32 && !/\s/.test(value) ? value : DEFAULT_TRIGGER;
  } catch {
    return DEFAULT_TRIGGER;
  }
}

async function handleBang(query: string): Promise<Response | null> {
  const payload = await loadMap();
  if (!payload) return null;
  const resolution = resolve(query, (t) => payload.map[t], {
    defaultTrigger: await readDefaultTrigger(),
    lookupHome: (t) => payload.home[t],
  });
  if (!resolution) return null;
  return Response.redirect(resolution.url, 302);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.mode !== 'navigate' || request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname !== '/') return;

  const query = url.searchParams.get('q');
  if (!query?.trim()) return;

  event.respondWith(
    // Any failure here falls back to the network, where the edge middleware
    // produces exactly the same redirect.
    handleBang(query).then((response) => response ?? fetch(request)),
  );
});

// Serve the cached app shell for everything we precached.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname === '/' && url.searchParams.has('q')) return; // handled above

  if (url.pathname === __REDIRECT_MAP_URL__ || __PRECACHE__.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then((hit) => hit ?? fetch(event.request)));
  }
});
