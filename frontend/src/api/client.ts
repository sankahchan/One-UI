import axios, { AxiosError, type AxiosRequestConfig } from 'axios';

import { useAuthStore } from '../store/authStore';
import type { ApiResponse, AuthResponse } from '../types';

type RetriableRequestConfig = AxiosRequestConfig & {
  _retry?: boolean;
};

const detectApiUrl = () => {
  const configured = import.meta.env.VITE_API_URL as string | undefined;
  if (configured && configured.trim()) {
    return configured.trim();
  }

  // Auto-detect panel path from current URL
  // e.g., if the app is served at http://host:port/a1b2c3d4/, the API is at /a1b2c3d4/api
  if (typeof window !== 'undefined' && window.location) {
    const panelPath = (import.meta.env.VITE_PANEL_PATH as string | undefined)?.replace(/\/+$/, '') || '';
    if (panelPath) {
      return `${window.location.origin}${panelPath}/api`;
    }
    return `${window.location.origin}/api`;
  }

  return 'http://127.0.0.1:3000/api';
};

const API_URL = detectApiUrl();

const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

const refreshClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

function readAuthPayload(payload: unknown): AuthResponse | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const envelope = payload as ApiResponse<AuthResponse>;
  if (envelope?.data?.token) {
    return envelope.data;
  }

  const raw = payload as AuthResponse;
  if (raw?.token) {
    return raw;
  }

  return null;
}

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const { refreshToken } = useAuthStore.getState();
  if (!refreshToken) {
    return null;
  }

  const response = await refreshClient.post('/auth/refresh', { refreshToken });
  const authPayload = readAuthPayload(response.data);
  if (!authPayload?.token) {
    return null;
  }

  useAuthStore.getState().setSession({
    token: authPayload.token,
    refreshToken: authPayload.refreshToken ?? refreshToken,
    admin: authPayload.admin
      ? {
          id: authPayload.admin.id,
          username: authPayload.admin.username,
          role: authPayload.admin.role,
          email: authPayload.admin.email,
          twoFactorEnabled: authPayload.admin.twoFactorEnabled
        }
      : undefined
  });

  return authPayload.token;
}

function isAuthEndpoint(url?: string) {
  if (!url) {
    return false;
  }

  return url.includes('/auth/login') || url.includes('/auth/refresh');
}

apiClient.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
  (response) => response.data,
  async (error: AxiosError<ApiResponse<unknown>>) => {
    if (!error.response) {
      return Promise.reject(new Error(`Cannot reach API server at ${API_URL}`));
    }

    const originalRequest = (error.config || {}) as RetriableRequestConfig;
    const statusCode = error.response.status;

    if (statusCode === 401 && !originalRequest._retry && !isAuthEndpoint(originalRequest.url)) {
      originalRequest._retry = true;

      try {
        if (!refreshPromise) {
          refreshPromise = refreshAccessToken().finally(() => {
            refreshPromise = null;
          });
        }

        const nextToken = await refreshPromise;
        if (nextToken) {
          originalRequest.headers = originalRequest.headers || {};
          originalRequest.headers.Authorization = `Bearer ${nextToken}`;
          return apiClient(originalRequest);
        }
      } catch {
        // fall through to logout.
      }

      useAuthStore.getState().logout();
      if (typeof window !== 'undefined') {
        const basePath = (import.meta.env.VITE_PANEL_PATH as string | undefined)?.replace(/\/+$/, '') || '';
        window.location.href = `${basePath}/login`;
      }
      return Promise.reject(new Error('Session expired. Please sign in again.'));
    }

    const body: any = error.response.data;
    const message = body?.error?.message || body?.message || (typeof body === 'string' ? body : 'An error occurred');
    return Promise.reject(new Error(message));
  }
);

export default apiClient;
export { apiClient, API_URL, refreshAccessToken };

