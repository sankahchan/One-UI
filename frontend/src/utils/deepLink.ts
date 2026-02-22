function normalizeUrls(urls: string[]): string[] {
  return Array.from(new Set(urls.map((value) => String(value || '').trim()).filter(Boolean)));
}

/**
 * Launch app deep links with a best-effort fallback chain.
 * If the page remains visible, we assume handoff failed and try the next URL.
 */
export function openDeepLinksWithFallback(urls: string[], stepDelayMs = 850): void {
  if (typeof window === 'undefined') {
    return;
  }

  const queue = normalizeUrls(urls);
  if (queue.length === 0) {
    return;
  }

  let index = 0;
  let stopped = false;
  let timer: ReturnType<typeof window.setTimeout> | null = null;

  const cleanup = () => {
    if (timer) {
      window.clearTimeout(timer);
      timer = null;
    }
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      stopped = true;
      cleanup();
    }
  };

  const launchNext = () => {
    if (stopped || index >= queue.length) {
      cleanup();
      return;
    }

    const targetUrl = queue[index];
    index += 1;
    window.location.href = targetUrl;

    if (index >= queue.length) {
      return;
    }

    timer = window.setTimeout(() => {
      if (!stopped && document.visibilityState === 'visible') {
        launchNext();
      } else {
        cleanup();
      }
    }, stepDelayMs);
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  launchNext();
}
