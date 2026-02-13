import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface SmartAutoRefreshOptions {
  enabled?: boolean;
  intervalMs?: number;
  pauseOnHidden?: boolean;
  label?: string;
}

export function useSmartAutoRefresh(
  callback: () => Promise<unknown> | void,
  options: SmartAutoRefreshOptions = {}
) {
  const {
    enabled = true,
    intervalMs = 20_000,
    pauseOnHidden = true
  } = options;

  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const [paused, setPaused] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [nextRunInMs, setNextRunInMs] = useState(intervalMs);

  const timerRef = useRef<ReturnType<typeof window.setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof window.setInterval> | null>(null);
  const nextTickRef = useRef(intervalMs);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (countdownRef.current) {
      window.clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  const runNow = useCallback(async () => {
    await callbackRef.current();
    const now = Date.now();
    setLastRunAt(new Date(now).toISOString());
    nextTickRef.current = now + intervalMs;
    setNextRunInMs(intervalMs);
  }, [intervalMs]);

  const shouldPause = useCallback(() => {
    if (!enabled || paused) {
      return true;
    }

    if (pauseOnHidden && typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return true;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return true;
    }

    return false;
  }, [enabled, pauseOnHidden, paused]);

  useEffect(() => {
    clearTimers();

    if (!enabled) {
      setNextRunInMs(intervalMs);
      return () => {};
    }

    nextTickRef.current = Date.now() + intervalMs;
    setNextRunInMs(intervalMs);

    timerRef.current = window.setInterval(() => {
      if (shouldPause()) {
        return;
      }

      if (Date.now() >= nextTickRef.current) {
        void runNow();
      }
    }, 500);

    countdownRef.current = window.setInterval(() => {
      const remaining = Math.max(0, nextTickRef.current - Date.now());
      setNextRunInMs(remaining);
    }, 1000);

    return () => {
      clearTimers();
    };
  }, [clearTimers, enabled, intervalMs, runNow, shouldPause]);

  useEffect(() => {
    if (!enabled) {
      return () => {};
    }

    const handleVisible = () => {
      if (!shouldPause()) {
        void runNow();
      }
    };

    window.addEventListener('focus', handleVisible);
    document.addEventListener('visibilitychange', handleVisible);
    window.addEventListener('online', handleVisible);

    return () => {
      window.removeEventListener('focus', handleVisible);
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('online', handleVisible);
    };
  }, [enabled, runNow, shouldPause]);

  const togglePaused = useCallback(() => {
    setPaused((previous) => !previous);
  }, []);

  const statusLabel = useMemo(() => {
    if (!enabled) {
      return 'Off';
    }
    if (paused) {
      return 'Paused';
    }
    if (pauseOnHidden && typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return 'Hidden';
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return 'Offline';
    }
    return 'Active';
  }, [enabled, pauseOnHidden, paused]);

  return {
    enabled,
    paused,
    statusLabel,
    lastRunAt,
    nextRunInMs,
    forceRefresh: runNow,
    togglePaused
  };
}
