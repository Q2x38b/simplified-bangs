/**
 * Handoff flag between the landing page and the lazily-loaded search island.
 * Set before the island's bundle is injected; read once on mount.
 */
declare global {
  interface Window {
    __openBangSearch?: boolean;
  }
}

export {};
