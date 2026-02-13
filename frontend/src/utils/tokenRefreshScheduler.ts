import { useAuthStore } from '../store/authStore';

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function parseJwtExp(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function performRefresh(): Promise<void> {
  try {
    const { refreshAccessToken } = await import('../api/client');
    const newToken = await refreshAccessToken();
    if (newToken) {
      schedule();
    }
  } catch {
    // 401 interceptor handles failures on next API call
  }
}

function schedule(): void {
  cancel();

  const { token } = useAuthStore.getState();
  if (!token) return;

  const expiresAt = parseJwtExp(token);
  if (!expiresAt) return;

  const now = Date.now();
  const remaining = expiresAt - now;
  if (remaining <= 60_000) return;

  const delay = remaining - 60_000;

  refreshTimer = setTimeout(() => {
    void performRefresh();
  }, delay);
}

function cancel(): void {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

export function initTokenRefreshScheduler(): void {
  schedule();

  useAuthStore.subscribe((state, prevState) => {
    if (state.token && state.token !== prevState.token) {
      schedule();
    }
    if (!state.token && prevState.token) {
      cancel();
    }
  });
}
