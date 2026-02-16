import apiClient from './client';
import { useAuthStore } from '../store/authStore';
import type { ApiResponse, AuthResponse, LoginCredentials } from '../types';

interface TwoFactorSetupResponse {
  secret: string;
  issuer: string;
  otpAuthUrl: string;
}

interface TwoFactorToggleResponse {
  enabled: boolean;
}

interface CurrentAdminResponse {
  id: number;
  username: string;
  email?: string;
  role: string;
  twoFactorEnabled?: boolean;
  telegramId?: string | null;
  lastLoginAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminSessionEntry {
  id: number;
  sessionId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
  expiresAt: string;
  revokedAt?: string | null;
  current: boolean;
}

export interface AdminSessionListResponse {
  total: number;
  active: number;
  sessions: AdminSessionEntry[];
}

export interface UpdateProfilePayload {
  currentPassword: string;
  username?: string;
  newPassword?: string;
  confirmPassword?: string;
}

export interface UpdateProfileResponse {
  id: number;
  username: string;
  role: string;
  email?: string;
  twoFactorEnabled?: boolean;
  passwordChangedAt?: string | null;
  updatedAt?: string;
  usernameChanged: boolean;
  passwordChanged: boolean;
  sessionsRevoked: boolean;
}

export interface TelegramOAuthConfig {
  enabled: boolean;
  botUsername: string;
}

export interface TelegramLinkStatus {
  linked: boolean;
  telegramId: string | null;
  username: string;
}

export interface TelegramLoginPayload {
  id: string | number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: string | number;
  hash: string;
}

function extractPayload<T>(response: ApiResponse<T> | T): T {
  if (response && typeof response === 'object' && 'success' in response) {
    return ((response as ApiResponse<T>).data ?? null) as T;
  }

  return response as T;
}

export interface LoginInfo {
  requireTwoFactorForSuperAdmin: boolean;
}

export const authApi = {
  getLoginInfo: async (): Promise<LoginInfo> => {
    const response = await apiClient.get<any, ApiResponse<LoginInfo> | LoginInfo>('/auth/login-info');
    return extractPayload<LoginInfo>(response);
  },

  login: async (credentials: LoginCredentials): Promise<AuthResponse> => {
    const response = await apiClient.post<any, ApiResponse<AuthResponse> | AuthResponse>('/auth/login', credentials);
    return extractPayload<AuthResponse>(response);
  },

  getTelegramConfig: async (): Promise<TelegramOAuthConfig> => {
    const response = await apiClient.get<any, ApiResponse<TelegramOAuthConfig> | TelegramOAuthConfig>(
      '/auth/telegram/config'
    );
    return extractPayload<TelegramOAuthConfig>(response);
  },

  loginWithTelegram: async (payload: TelegramLoginPayload): Promise<AuthResponse> => {
    const response = await apiClient.post<any, ApiResponse<AuthResponse> | AuthResponse>(
      '/auth/login/telegram',
      payload
    );
    return extractPayload<AuthResponse>(response);
  },

  getTelegramLink: async (): Promise<TelegramLinkStatus> => {
    const response = await apiClient.get<any, ApiResponse<TelegramLinkStatus> | TelegramLinkStatus>(
      '/auth/telegram/link'
    );
    return extractPayload<TelegramLinkStatus>(response);
  },

  linkTelegram: async (telegramId: string): Promise<TelegramLinkStatus> => {
    const response = await apiClient.put<any, ApiResponse<TelegramLinkStatus> | TelegramLinkStatus>(
      '/auth/telegram/link',
      { telegramId }
    );
    return extractPayload<TelegramLinkStatus>(response);
  },

  unlinkTelegram: async (): Promise<TelegramLinkStatus> => {
    const response = await apiClient.delete<any, ApiResponse<TelegramLinkStatus> | TelegramLinkStatus>(
      '/auth/telegram/link'
    );
    return extractPayload<TelegramLinkStatus>(response);
  },

  refresh: async (refreshToken: string): Promise<AuthResponse> => {
    const response = await apiClient.post<any, ApiResponse<AuthResponse> | AuthResponse>('/auth/refresh', {
      refreshToken
    });
    return extractPayload<AuthResponse>(response);
  },

  logout: async (refreshToken?: string | null): Promise<void> => {
    await apiClient.post('/auth/logout', refreshToken ? { refreshToken } : {});
  },

  logoutAll: async (): Promise<void> => {
    await apiClient.post('/auth/logout-all');
  },

  getSessions: async (params?: { limit?: number; includeRevoked?: boolean }): Promise<AdminSessionListResponse> => {
    const response = await apiClient.get<any, ApiResponse<AdminSessionListResponse> | AdminSessionListResponse>(
      '/auth/sessions',
      { params }
    );
    return extractPayload<AdminSessionListResponse>(response);
  },

  revokeSessionById: async (sid: string, allowCurrent = false): Promise<{ sessionId: string; revoked: boolean }> => {
    const response = await apiClient.delete<any, ApiResponse<{ sessionId: string; revoked: boolean }> | { sessionId: string; revoked: boolean }>(
      `/auth/sessions/${encodeURIComponent(sid)}`,
      { data: { allowCurrent } }
    );
    return extractPayload<{ sessionId: string; revoked: boolean }>(response);
  },

  me: async (): Promise<CurrentAdminResponse> => {
    const response = await apiClient.get<any, ApiResponse<CurrentAdminResponse> | CurrentAdminResponse>('/auth/me');
    return extractPayload<CurrentAdminResponse>(response);
  },

  updateProfile: async (payload: UpdateProfilePayload): Promise<UpdateProfileResponse> => {
    const response = await apiClient.put<any, ApiResponse<UpdateProfileResponse> | UpdateProfileResponse>(
      '/auth/profile',
      payload
    );
    return extractPayload<UpdateProfileResponse>(response);
  },

  setupTwoFactor: async (): Promise<TwoFactorSetupResponse> => {
    const response = await apiClient.post<any, ApiResponse<TwoFactorSetupResponse> | TwoFactorSetupResponse>(
      '/auth/2fa/setup'
    );
    return extractPayload<TwoFactorSetupResponse>(response);
  },

  enableTwoFactor: async (otp: string): Promise<TwoFactorToggleResponse> => {
    const response = await apiClient.post<any, ApiResponse<TwoFactorToggleResponse> | TwoFactorToggleResponse>(
      '/auth/2fa/enable',
      { otp }
    );
    return extractPayload<TwoFactorToggleResponse>(response);
  },

  disableTwoFactor: async (otp?: string): Promise<TwoFactorToggleResponse> => {
    const response = await apiClient.post<any, ApiResponse<TwoFactorToggleResponse> | TwoFactorToggleResponse>(
      '/auth/2fa/disable',
      otp ? { otp } : {}
    );
    return extractPayload<TwoFactorToggleResponse>(response);
  }
};

export const login = authApi.login;
export const refresh = authApi.refresh;
export const logout = authApi.logout;
export const logoutAll = authApi.logoutAll;

export const syncCurrentAdmin = async (): Promise<CurrentAdminResponse | null> => {
  try {
    const admin = await authApi.me();
    useAuthStore.getState().setAdmin({
      id: admin.id,
      username: admin.username,
      role: admin.role,
      email: admin.email,
      twoFactorEnabled: admin.twoFactorEnabled
    });
    return admin;
  } catch {
    return null;
  }
};
