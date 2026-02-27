import apiClient from './client';
import type { ApiResponse } from '../types';

export interface MieruPolicy {
  enabled: boolean;
  mode: 'docker' | 'manual';
  containerName: string;
  composeServiceName: string;
  composeFilePath: string;
  healthUrl: string | null;
  manualRestartCommandConfigured: boolean;
  manualLogPathConfigured: boolean;
}

export interface MieruHealthStatus {
  configured: boolean;
  ok: boolean | null;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
}

export interface MieruStatus extends MieruPolicy {
  dockerAvailable?: boolean;
  running: boolean;
  state: string;
  restarting?: boolean;
  image?: string | null;
  restartMonitor?: {
    restartCount: number;
    observedRestarts: number;
    threshold: number;
    windowSeconds: number;
    cooldownSeconds: number;
    alerting: boolean;
    canAlert: boolean;
    windowStartedAt: string;
    lastAlertAt: string | null;
  } | null;
  version: string | null;
  health: MieruHealthStatus;
  checkedAt: string;
  detail?: string | null;
}

export interface MieruLogs {
  enabled: boolean;
  source: string | null;
  lines: number;
  raw: string;
  detail?: string | null;
}

export interface MieruRestartResult {
  success: boolean;
  message: string;
  status: MieruStatus;
}

export interface MieruSyncResult {
  enabled: boolean;
  autoSync: boolean;
  skipped: boolean;
  skippedReason: string | null;
  changed: boolean;
  restarted: boolean;
  restartError: string | null;
  configPath: string;
  usersPath: string;
  userCount: number;
  hash: string | null;
}

export interface MieruProfile {
  server: string;
  portRange: string;
  transport: 'TCP' | 'UDP';
  udp: boolean;
  multiplexing: string;
  updatedAt: string | null;
  source?: string;
  usersPath?: string;
  configPath?: string;
}

export interface MieruQuota {
  days?: number;
  megabytes?: number;
}

export interface MieruUserEntry {
  username: string;
  password: string;
  quotas?: MieruQuota[];
  source: 'panel' | 'custom' | 'config';
  enabled: boolean;
  configured: boolean;
  online: boolean;
  panelUserId?: number | null;
  dataLimitBytes?: number | null;
  uploadUsedBytes?: number | null;
  downloadUsedBytes?: number | null;
  expireDate?: string | null;
  ipLimit?: number | null;
  deviceLimit?: number | null;
  startOnFirstUse?: boolean | null;
  firstUsedAt?: string | null;
  updatedAt: string | null;
  createdAt: string | null;
}

export interface MieruOnlineSnapshot {
  checkedAt: string;
  users: Array<{
    username: string;
    online: boolean;
    lastActiveAt?: string | null;
  }>;
  summary: {
    total: number;
    online: number;
    offline: number;
  };
  commands: {
    users: {
      ok: boolean;
      error: string | null;
    };
    connections: {
      ok: boolean;
      error: string | null;
    };
  };
}

export interface MieruUsersResult {
  users: MieruUserEntry[];
  stats: {
    total: number;
    configured: number;
    panel: number;
    custom: number;
    online: number;
  };
  sync: {
    usersPath: string;
    configPath: string;
    usersHash: string | null;
    lastSyncedAt: string | null;
  };
  onlineSnapshot?: MieruOnlineSnapshot | null;
}

export interface MieruCustomUserResult {
  user: MieruUserEntry;
  syncResult: MieruSyncResult;
}

export interface MieruCustomUserDeleteResult {
  deleted: boolean;
  username: string;
  syncResult: MieruSyncResult;
}

export interface MieruUserExportResult {
  username: string;
  profile: MieruProfile;
  clashYaml: string;
  json: {
    type: 'mieru';
    server: string;
    portRange: string;
    transport: 'TCP' | 'UDP';
    udp: boolean;
    username: string;
    password: string;
    multiplexing: string;
    quotas?: MieruQuota[];
  };
}

export interface MieruUserSubscriptionUrlResult {
  username: string;
  email: string;
  subscriptionToken: string;
  subscriptionUrl: string;
}

export const mieruApi = {
  getPolicy: async (): Promise<ApiResponse<MieruPolicy>> => apiClient.get('/mieru/policy'),
  getStatus: async (): Promise<ApiResponse<MieruStatus>> => apiClient.get('/mieru/status'),
  restart: async (): Promise<ApiResponse<MieruRestartResult>> => apiClient.post('/mieru/restart'),
  syncUsers: async (reason?: string): Promise<ApiResponse<MieruSyncResult>> =>
    apiClient.post('/mieru/sync', reason ? { reason } : {}),
  getLogs: async (params: { lines?: number } = {}): Promise<ApiResponse<MieruLogs>> =>
    apiClient.get('/mieru/logs', { params }),
  getProfile: async (): Promise<ApiResponse<MieruProfile>> => apiClient.get('/mieru/profile'),
  updateProfile: async (payload: Partial<MieruProfile>): Promise<ApiResponse<MieruProfile>> =>
    apiClient.put('/mieru/profile', payload),
  listUsers: async (params: { includeOnline?: boolean } = {}): Promise<ApiResponse<MieruUsersResult>> =>
    apiClient.get('/mieru/users', { params }),
  createUser: async (payload: {
    username: string;
    password: string;
    enabled?: boolean;
    quotas?: MieruQuota[];
  }): Promise<ApiResponse<MieruCustomUserResult>> => apiClient.post('/mieru/users', payload),
  updateUser: async (
    username: string,
    payload: {
      username?: string;
      password?: string;
      enabled?: boolean;
      quotas?: MieruQuota[];
    }
  ): Promise<ApiResponse<MieruCustomUserResult>> => apiClient.put(`/mieru/users/${encodeURIComponent(username)}`, payload),
  deleteUser: async (username: string): Promise<ApiResponse<MieruCustomUserDeleteResult>> =>
    apiClient.delete(`/mieru/users/${encodeURIComponent(username)}`),
  getOnlineSnapshot: async (): Promise<ApiResponse<MieruOnlineSnapshot>> => apiClient.get('/mieru/online'),
  getUserExport: async (username: string): Promise<ApiResponse<MieruUserExportResult>> =>
    apiClient.get(`/mieru/users/${encodeURIComponent(username)}/export`),
  getUserSubscriptionUrl: async (username: string): Promise<ApiResponse<MieruUserSubscriptionUrlResult>> =>
    apiClient.get(`/mieru/users/${encodeURIComponent(username)}/subscription-url`)
};

export const getMieruPolicy = async (): Promise<MieruPolicy> => {
  const response = await mieruApi.getPolicy();
  return response.data ?? {
    enabled: false,
    mode: 'docker',
    containerName: 'mieru-sidecar',
    composeServiceName: 'mieru',
    composeFilePath: '/opt/one-ui/docker-compose.yml',
    healthUrl: null,
    manualRestartCommandConfigured: false,
    manualLogPathConfigured: false
  };
};

export const getMieruStatus = async (): Promise<MieruStatus> => {
  const response = await mieruApi.getStatus();
  if (!response.data) {
    throw new Error(response.message || 'Unable to fetch Mieru status');
  }
  return response.data;
};

export const restartMieru = async (): Promise<MieruRestartResult> => {
  const response = await mieruApi.restart();
  if (!response.data) {
    throw new Error(response.message || 'Unable to restart Mieru sidecar');
  }
  return response.data;
};

export const syncMieruUsers = async (reason?: string): Promise<MieruSyncResult> => {
  const response = await mieruApi.syncUsers(reason);
  if (!response.data) {
    throw new Error(response.message || 'Unable to sync Mieru users');
  }
  return response.data;
};

export const getMieruLogs = async (lines = 120): Promise<MieruLogs> => {
  const response = await mieruApi.getLogs({ lines });
  if (!response.data) {
    throw new Error(response.message || 'Unable to fetch Mieru logs');
  }
  return response.data;
};

export const getMieruProfile = async (): Promise<MieruProfile> => {
  const response = await mieruApi.getProfile();
  if (!response.data) {
    throw new Error(response.message || 'Unable to fetch Mieru profile');
  }
  return response.data;
};

export const updateMieruProfile = async (payload: Partial<MieruProfile>): Promise<MieruProfile> => {
  const response = await mieruApi.updateProfile(payload);
  if (!response.data) {
    throw new Error(response.message || 'Unable to update Mieru profile');
  }
  return response.data;
};

export const listMieruUsers = async (includeOnline = true): Promise<MieruUsersResult> => {
  const response = await mieruApi.listUsers({ includeOnline });
  if (!response.data) {
    throw new Error(response.message || 'Unable to fetch Mieru users');
  }
  return response.data;
};

export const createMieruUser = async (payload: {
  username: string;
  password: string;
  enabled?: boolean;
  quotas?: MieruQuota[];
}): Promise<MieruCustomUserResult> => {
  const response = await mieruApi.createUser(payload);
  if (!response.data) {
    throw new Error(response.message || 'Unable to create Mieru user');
  }
  return response.data;
};

export const updateMieruUser = async (
  username: string,
  payload: {
    username?: string;
    password?: string;
    enabled?: boolean;
    quotas?: MieruQuota[];
  }
): Promise<MieruCustomUserResult> => {
  const response = await mieruApi.updateUser(username, payload);
  if (!response.data) {
    throw new Error(response.message || 'Unable to update Mieru user');
  }
  return response.data;
};

export const deleteMieruUser = async (username: string): Promise<MieruCustomUserDeleteResult> => {
  const response = await mieruApi.deleteUser(username);
  if (!response.data) {
    throw new Error(response.message || 'Unable to delete Mieru user');
  }
  return response.data;
};

export const getMieruOnlineSnapshot = async (): Promise<MieruOnlineSnapshot> => {
  const response = await mieruApi.getOnlineSnapshot();
  if (!response.data) {
    throw new Error(response.message || 'Unable to fetch Mieru online snapshot');
  }
  return response.data;
};

export const getMieruUserExport = async (username: string): Promise<MieruUserExportResult> => {
  const response = await mieruApi.getUserExport(username);
  if (!response.data) {
    throw new Error(response.message || 'Unable to generate Mieru export');
  }
  return response.data;
};

export const getMieruUserSubscriptionUrl = async (username: string): Promise<MieruUserSubscriptionUrlResult> => {
  const response = await mieruApi.getUserSubscriptionUrl(username);
  if (!response.data) {
    throw new Error(response.message || 'Unable to generate Mieru subscription URL');
  }
  return response.data;
};
