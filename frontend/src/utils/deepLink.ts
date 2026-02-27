function normalizeUrls(urls: string[]): string[] {
  return Array.from(new Set(urls.map((value) => String(value || '').trim()).filter(Boolean)));
}

type DeepLinkFallbackOptions = {
  stepDelayMs?: number;
  onExhausted?: () => void;
};

/**
 * Launch app deep links with a best-effort fallback chain.
 * If the page remains visible, we assume handoff failed and try the next URL.
 */
export function openDeepLinksWithFallback(
  urls: string[],
  options: number | DeepLinkFallbackOptions = 850
): void {
  if (typeof window === 'undefined') {
    return;
  }

  const parsedOptions: DeepLinkFallbackOptions = typeof options === 'number'
    ? { stepDelayMs: options }
    : options || {};
  const stepDelayMs = Number.isFinite(parsedOptions.stepDelayMs)
    ? Math.max(250, Number(parsedOptions.stepDelayMs))
    : 850;
  const onExhausted = typeof parsedOptions.onExhausted === 'function' ? parsedOptions.onExhausted : undefined;

  const queue = normalizeUrls(urls);
  if (queue.length === 0) {
    onExhausted?.();
    return;
  }

  let index = 0;
  let stopped = false;
  let exhausted = false;
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

  const markExhausted = () => {
    if (exhausted || stopped) {
      cleanup();
      return;
    }
    exhausted = true;
    cleanup();
    onExhausted?.();
  };

  const launchNext = () => {
    if (stopped || index >= queue.length) {
      markExhausted();
      return;
    }

    const targetUrl = queue[index];
    index += 1;
    window.location.assign(targetUrl);

    timer = window.setTimeout(() => {
      if (stopped || document.visibilityState !== 'visible') {
        cleanup();
        return;
      }

      if (index < queue.length) {
        launchNext();
      } else {
        markExhausted();
      }
    }, stepDelayMs);
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  launchNext();
}
