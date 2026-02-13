import { useCallback, useEffect, useMemo, useState } from 'react';

type SetStateAction<T> = T | ((previous: T) => T);

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        ...fallback,
        ...parsed
      };
    }
  } catch {
    // Ignore malformed payload and fallback to defaults.
  }

  return fallback;
}

export function usePersistedFilters<T extends Record<string, any>>(storageKey: string, defaultValue: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return defaultValue;
    }

    return safeParse<T>(window.localStorage.getItem(storageKey), defaultValue);
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(storageKey, JSON.stringify(value));
  }, [storageKey, value]);

  const update = useCallback((action: SetStateAction<T>) => {
    setValue((previous) => (typeof action === 'function' ? (action as (prev: T) => T)(previous) : action));
  }, []);

  const reset = useCallback(() => {
    setValue(defaultValue);
  }, [defaultValue]);

  const api = useMemo(
    () => ({
      value,
      setValue: update,
      reset
    }),
    [reset, update, value]
  );

  return api;
}

export interface SavedView<T extends Record<string, any>> {
  id: string;
  name: string;
  filters: T;
  createdAt: string;
}

export function useSavedViews<T extends Record<string, any>>(storageKey: string) {
  const [views, setViews] = useState<SavedView<T>[]>(() => {
    if (typeof window === 'undefined') {
      return [];
    }

    const parsed = safeParse<SavedView<T>[]>(window.localStorage.getItem(storageKey), []);
    return Array.isArray(parsed) ? parsed : [];
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(storageKey, JSON.stringify(views));
  }, [storageKey, views]);

  const saveView = useCallback((name: string, filters: T) => {
    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      throw new Error('View name is required');
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nextView: SavedView<T> = {
      id,
      name: trimmedName,
      filters,
      createdAt: new Date().toISOString()
    };

    setViews((previous) => [nextView, ...previous].slice(0, 20));
    return nextView;
  }, []);

  const deleteView = useCallback((id: string) => {
    setViews((previous) => previous.filter((entry) => entry.id !== id));
  }, []);

  return {
    views,
    saveView,
    deleteView
  };
}
