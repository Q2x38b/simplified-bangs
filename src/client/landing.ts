/**
 * Landing-page interactivity. Deferred — nothing here is on the redirect path.
 */
import { DEFAULT_BANG_COOKIE, DEFAULT_TRIGGER } from '../lib/resolve.js';

declare const __SEARCH_MODAL_JS__: string;
declare const __SEARCH_MODAL_CSS__: string;

// Registering the worker is what makes subsequent redirects resolve with no
// network at all. It is purely an optimisation; the edge handles every request
// identically if registration fails or the browser has no support.
if ('serviceWorker' in navigator) {
  // On a first visit the page loads uncontrolled, and the worker claiming it
  // moments later is not an update — reloading then would be pointless churn.
  // This has to be a mutable flag rather than a snapshot: a tab opened on that
  // first visit would otherwise treat every later deploy as the initial claim
  // and never refresh.
  let hasController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;

  // A replacement worker taking control means this document came from the
  // previous build. Reload once so the tab picks up the new one — this is what
  // makes a deploy reach tabs that have been sitting open.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hasController) {
      hasController = true; // initial claim, nothing on screen is stale
      return;
    }
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // Browsers only check for a new worker on navigation, so a tab left
        // open would otherwise never notice. Re-check when it regains focus.
        addEventListener('focus', () => void registration.update().catch(() => {}));
      })
      .catch(() => {});
  });
}

// ---------------------------------------------------------------------------
// Search island
//
// React + Radix + cmdk are ~70 KB gzipped, so they are fetched only when the
// user shows intent: pressing the shortcut, clicking the trigger, or landing on
// #search. A pointer near the trigger prefetches so the open feels instant.
// ---------------------------------------------------------------------------

let modalLoaded = false;

/**
 * `prefetch` warms the bundle without opening anything (used on pointer intent).
 * Anything else means the user asked for the palette, and the island reads this
 * flag on mount — the keystroke that triggers the load happens before the
 * island's own listeners exist, so it cannot observe the event itself.
 */
function loadSearchModal(intent: 'open' | 'prefetch' = 'open'): void {
  if (intent === 'open') window.__openBangSearch = true;
  if (modalLoaded) return;
  modalLoaded = true;

  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = __SEARCH_MODAL_CSS__;
  document.head.append(css);

  const script = document.createElement('script');
  script.type = 'module';
  script.src = __SEARCH_MODAL_JS__;
  document.body.append(script);
}

// Once loaded, the island owns these interactions; until then we forward them.
addEventListener(
  'keydown',
  (event: KeyboardEvent) => {
    const target = event.target;
    const typing =
      target instanceof HTMLElement &&
      (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing)) {
      event.preventDefault();
      loadSearchModal();
    }
  },
  { capture: true },
);

for (const trigger of document.querySelectorAll('[data-open-search]')) {
  trigger.addEventListener('pointerenter', () => loadSearchModal('prefetch'), { once: true });
  trigger.addEventListener('click', () => loadSearchModal());
}

if (location.hash === '#search') loadSearchModal();
addEventListener('hashchange', () => {
  if (location.hash === '#search') loadSearchModal();
});

// ---------------------------------------------------------------------------
// Copy + default bang
// ---------------------------------------------------------------------------

const copyButton = document.getElementById('copy-button');
const urlInput = document.getElementById('url-input') as HTMLInputElement | null;

copyButton?.addEventListener('click', async () => {
  if (!urlInput) return;
  try {
    await navigator.clipboard.writeText(urlInput.value);
  } catch {
    urlInput.select();
    return;
  }
  copyButton.classList.add('copied');
  setTimeout(() => copyButton.classList.remove('copied'), 1600);
});

// Default bang. Stored in a cookie as well as localStorage so the *edge* can
// honour it — middleware has no access to localStorage.
const defaultInput = document.getElementById('default-bang') as HTMLInputElement | null;
if (defaultInput) {
  defaultInput.value = localStorage.getItem(DEFAULT_BANG_COOKIE) ?? DEFAULT_TRIGGER;

  const save = (): void => {
    const value = defaultInput.value.trim().replace(/^!/, '').toLowerCase();
    const trigger = value || DEFAULT_TRIGGER;
    localStorage.setItem(DEFAULT_BANG_COOKIE, trigger);
    document.cookie = `${DEFAULT_BANG_COOKIE}=${encodeURIComponent(trigger)}; path=/; max-age=63072000; samesite=lax; secure`;
    defaultInput.value = trigger;
    defaultInput.classList.add('saved');
    setTimeout(() => defaultInput.classList.remove('saved'), 1200);
  };

  defaultInput.addEventListener('change', save);
  defaultInput.addEventListener('blur', save);
}
