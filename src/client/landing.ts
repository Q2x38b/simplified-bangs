/**
 * Landing-page interactivity. Deferred — nothing here is on the redirect path.
 */
import { DEFAULT_BANG_COOKIE, DEFAULT_TRIGGER } from '../lib/resolve.js';

// Registering the worker is what makes subsequent redirects resolve with no
// network at all. It is purely an optimisation; the edge handles every request
// identically if registration fails or the browser has no support.
if ('serviceWorker' in navigator) {
  addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

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
