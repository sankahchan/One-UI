import apiClient from './client';
import type { ApiResponse } from '../types';

export interface OnlineUser {
  id: number;
  email: string;
  uuid: string;
  protocol: string;
  upload: number;
  download: number;
  lastActivity: string | null;
}

export interface OnlineUsersResponse {
  count: number;
  users: OnlineUser[];
}

export interface XrayStatus {
  running: boolean;
  version: string;
}

export interface XrayActionResult {
  success: boolean;
  message: string;
  inbounds?: number;
  configPath?: string;
}

export interface XrayUpdatePolicy {
  mode?: 'docker' | 'manual';
  updatesEnabled?: boolean;
  requireCanaryBeforeFull: boolean;
  canaryWindowMinutes: number;
  defaultChannel: 'stable' | 'latest';
  updateTimeoutMs: number;
  canaryReady: boolean;
  lastSuccessfulCanaryAt: string | null;
}

export interface XrayUpdatePreflightCheck {
  id: string;
  label: string;
  ok: boolean;
  blocking: boolean;
  detail: string;
  metadata?: Record<string, unknown> | null;
}

export interface XrayUpdatePreflight {
  mode?: 'docker' | 'manual';
  updatesEnabled?: boolean;
  ready: boolean;
  lockName: string;
  generatedAt: string;
  checks: XrayUpdatePreflightCheck[];
}

export interface XrayUpdateRunResult {
  ok: boolean;
  stage: 'canary' | 'full' | 'rollback';
  channel: 'stable' | 'latest';
  image: string | null;
  backupTag?: string | null;
  createdBackupTag?: string | null;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  summary: string | null;
  outputTail: string | null;
  telegramForwarded: boolean;
}

export interface XrayUpdateHistoryItem {
  id: number;
  level: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  message: string;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

export interface XrayUpdateHistoryResponse {
  items: XrayUpdateHistoryItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface XrayRollbackRequest {
  backupTag?: string;
}

export interface XrayUpdateUnlockRequest {
  reason?: string;
  force?: boolean;
}

export interface XrayUpdateUnlockResult {
  unlocked: boolean;
  hadLock: boolean;
  forced: boolean;
  stale: boolean;
  lockName: string;
  previousOwnerId: string | null;
  previousExpiresAt: string | null;
  reason: string;
  message: string;
}

export interface XrayRuntimeDoctorCheck {
  id: string;
  label: string;
  ok: boolean;
  blocking: boolean;
  repaired: boolean;
  detail: string;
  metadata?: Record<string, unknown> | null;
}

export interface XrayRuntimeDoctorResult {
  ok: boolean;
  mode: 'docker' | 'manual';
  updatesEnabled: boolean;
  source: string;
  repair: boolean;
  repairedCount: number;
  generatedAt: string;
  actions: string[];
  checks: XrayRuntimeDoctorCheck[];
  preflight: XrayUpdatePreflight;
}

export type XrayConfig = Record<string, unknown>;

export interface XrayReleaseChannel {
  id: number;
  tagName: string;
  name: string;
  publishedAt: string;
  prerelease: boolean;
  draft: boolean;
  url: string;
  version?: string;
  needsUpdate?: boolean;
}

export interface XrayReleaseIntel {
  repository: string;
  source: string;
  fetchedAt: string;
  currentVersion: string;
  channels: {
    stable: XrayReleaseChannel | null;
    latest: XrayReleaseChannel | null;
  };
  recent: XrayReleaseChannel[];
}

export interface XrayConfigSnapshot {
  id: string;
  createdAt: string | null;
  reason?: string | null;
  size: number;
}

export interface XrayConfigSnapshotList {
  directory: string;
  snapshots: XrayConfigSnapshot[];
}

export interface XrayRoutingProfile {
  mode: 'smart' | 'filtered' | 'strict' | 'open';
  blockPrivate: boolean;
  blockBitTorrent: boolean;
  domesticIps: string[];
  domesticDomains: string[];
}

export interface XrayGeodataFileStatus {
  key: string;
  name: string;
  path: string;
  exists: boolean;
  size: number;
  modifiedAt: string | null;
  sha256?: string;
}

export interface XrayGeodataStatus {
  directory: string;
  files: XrayGeodataFileStatus[];
}

export const xrayApi = {
  getOnlineUsers: async (): Promise<ApiResponse<OnlineUsersResponse>> => {
    return apiClient.get('/xray/online');
  },

  getStatus: async (): Promise<ApiResponse<XrayStatus>> => {
    return apiClient.get('/xray/status');
  },

  getConfig: async (): Promise<ApiResponse<XrayConfig>> => {
    return apiClient.get('/xray/config');
  },

  reloadConfig: async (): Promise<ApiResponse<XrayActionResult>> => {
    return apiClient.post('/xray/config/reload');
  },

  restart: async (): Promise<ApiResponse<XrayActionResult>> => {
    return apiClient.post('/xray/restart');
  },

  getUpdatePolicy: async (): Promise<ApiResponse<XrayUpdatePolicy>> => {
    return apiClient.get('/xray/update/policy');
  },

  getUpdatePreflight: async (): Promise<ApiResponse<XrayUpdatePreflight>> => {
    return apiClient.get('/xray/update/preflight');
  },

  getUpdateHistory: async (params: { page?: number; limit?: number } = {}): Promise<ApiResponse<XrayUpdateHistoryItem[]>> => {
    return apiClient.get('/xray/update/history', { params });
  },

  runCanaryUpdate: async (data: { channel?: 'stable' | 'latest'; image?: string; noRollback?: boolean } = {}): Promise<ApiResponse<XrayUpdateRunResult>> => {
    return apiClient.post('/xray/update/canary', data);
  },

  runFullUpdate: async (data: { channel?: 'stable' | 'latest'; image?: string; noRollback?: boolean; force?: boolean } = {}): Promise<ApiResponse<XrayUpdateRunResult>> => {
    return apiClient.post('/xray/update/full', data);
  },

  getRollbackBackups: async (): Promise<ApiResponse<string[]>> => {
    return apiClient.get('/xray/update/backups');
  },

  getUpdateReleaseIntel: async (params: { force?: boolean } = {}): Promise<ApiResponse<XrayReleaseIntel>> => {
    return apiClient.get('/xray/update/releases', { params });
  },

  runRollback: async (data: XrayRollbackRequest = {}): Promise<ApiResponse<XrayUpdateRunResult>> => {
    return apiClient.post('/xray/update/rollback', data);
  },

  runUpdateUnlock: async (data: XrayUpdateUnlockRequest = {}): Promise<ApiResponse<XrayUpdateUnlockResult>> => {
    return apiClient.post('/xray/update/unlock', data);
  },

  runRuntimeDoctor: async (data: { repair?: boolean; source?: string } = {}): Promise<ApiResponse<XrayRuntimeDoctorResult>> => {
    return apiClient.post('/xray/update/runtime-doctor', data);
  },

  getConfigSnapshots: async (params: { limit?: number } = {}): Promise<ApiResponse<XrayConfigSnapshotList>> => {
    return apiClient.get('/xray/config/snapshots', { params });
  },

  createConfigSnapshot: async (): Promise<ApiResponse<XrayConfigSnapshot>> => {
    return apiClient.post('/xray/config/snapshots');
  },

  rollbackConfigSnapshot: async (payload: { snapshotId: string; applyMethod?: 'restart' | 'hot' | 'none' }): Promise<ApiResponse<XrayActionResult>> => {
    return apiClient.post('/xray/config/rollback', payload);
  },

  getRoutingProfile: async (): Promise<ApiResponse<XrayRoutingProfile>> => {
    return apiClient.get('/xray/routing/profile');
  },

  updateRoutingProfile: async (payload: Partial<XrayRoutingProfile> & { apply?: boolean }): Promise<ApiResponse<{ profile: XrayRoutingProfile; apply?: XrayActionResult | null }>> => {
    return apiClient.put('/xray/routing/profile', payload);
  },

  getGeodataStatus: async (params: { includeHash?: boolean } = {}): Promise<ApiResponse<XrayGeodataStatus>> => {
    return apiClient.get('/xray/geodata/status', { params });
  },

  updateGeodata: async (payload: { useCommand?: boolean; forceDownload?: boolean; reload?: boolean; command?: string } = {}): Promise<ApiResponse<{ result: unknown; reloaded?: XrayActionResult | null }>> => {
    return apiClient.post('/xray/geodata/update', payload);
  },

  syncConfDir: async (): Promise<ApiResponse<{ directory: string; files: Array<{ name: string; path: string }>; inbounds: number }>> => {
    return apiClient.post('/xray/confdir/sync');
  },

  getConfDirStatus: async (): Promise<ApiResponse<{ directory: string; files: Array<{ name: string; path: string; size: number; modifiedAt: string }> }>> => {
    return apiClient.get('/xray/confdir/status');
  }
};

export const getOnlineUsers = async (): Promise<OnlineUsersResponse> => {
  const response = await xrayApi.getOnlineUsers();
  return response.data ?? { count: 0, users: [] };
};

export const getXrayStatus = async (): Promise<XrayStatus> => {
  const response = await xrayApi.getStatus();
  return response.data ?? {
    running: false,
    version: 'unknown'
  };
};

export const getXrayConfig = async (): Promise<XrayConfig> => {
  const response = await xrayApi.getConfig();
  return response.data ?? {};
};

export const reloadXrayConfig = async (): Promise<XrayActionResult> => {
  const response = await xrayApi.reloadConfig();
  return response.data ?? {
    success: false,
    message: 'Unable to reload Xray config'
  };
};

export const restartXray = async (): Promise<XrayActionResult> => {
  const response = await xrayApi.restart();
  return response.data ?? {
    success: false,
    message: 'Unable to restart Xray'
  };
};

export const getXrayUpdatePolicy = async (): Promise<XrayUpdatePolicy> => {
  const response = await xrayApi.getUpdatePolicy();
  return response.data ?? {
    mode: 'docker',
    updatesEnabled: true,
    requireCanaryBeforeFull: true,
    canaryWindowMinutes: 360,
    defaultChannel: 'stable',
    updateTimeoutMs: 20 * 60 * 1000,
    canaryReady: false,
    lastSuccessfulCanaryAt: null
  };
};

export const getXrayUpdatePreflight = async (): Promise<XrayUpdatePreflight> => {
  const response = await xrayApi.getUpdatePreflight();
  return response.data ?? {
    mode: 'docker',
    updatesEnabled: true,
    ready: false,
    lockName: 'one-ui-xray-update',
    generatedAt: new Date().toISOString(),
    checks: []
  };
};

export const getXrayUpdateHistory = async (params: { page?: number; limit?: number } = {}): Promise<XrayUpdateHistoryResponse> => {
  const response = await xrayApi.getUpdateHistory(params);
  return {
    items: response.data ?? [],
    pagination: response.pagination ?? {
      page: params.page || 1,
      limit: params.limit || 20,
      total: (response.data ?? []).length,
      totalPages: 1
    }
  };
};

export const runXrayCanaryUpdate = async (data: { channel?: 'stable' | 'latest'; image?: string; noRollback?: boolean } = {}): Promise<XrayUpdateRunResult> => {
  const response = await xrayApi.runCanaryUpdate(data);
  if (!response.data) {
    throw new Error(response.message || 'Unable to run Xray canary update');
  }
  return response.data;
};

export const runXrayFullUpdate = async (data: { channel?: 'stable' | 'latest'; image?: string; noRollback?: boolean; force?: boolean } = {}): Promise<XrayUpdateRunResult> => {
  const response = await xrayApi.runFullUpdate(data);
  if (!response.data) {
    throw new Error(response.message || 'Unable to run Xray full update');
  }
  return response.data;
};

export const getXrayRollbackBackups = async (): Promise<string[]> => {
  const response = await xrayApi.getRollbackBackups();
  return response.data ?? [];
};

export const getXrayUpdateReleaseIntel = async (params: { force?: boolean } = {}): Promise<XrayReleaseIntel> => {
  const response = await xrayApi.getUpdateReleaseIntel(params);
  if (!response.data) {
    throw new Error(response.message || 'Unable to fetch Xray release intel');
  }
  return response.data;
};

export const runXrayRollback = async (data: XrayRollbackRequest = {}): Promise<XrayUpdateRunResult> => {
  const response = await xrayApi.runRollback(data);
  if (!response.data) {
    throw new Error(response.message || 'Unable to run Xray rollback');
  }
  return response.data;
};

export const runXrayUpdateUnlock = async (data: XrayUpdateUnlockRequest = {}): Promise<XrayUpdateUnlockResult> => {
  const response = await xrayApi.runUpdateUnlock(data);
  if (!response.data) {
    throw new Error(response.message || 'Unable to unlock Xray update lock');
  }
  return response.data;
};

export const runXrayRuntimeDoctor = async (data: { repair?: boolean; source?: string } = {}): Promise<XrayRuntimeDoctorResult> => {
  const response = await xrayApi.runRuntimeDoctor(data);
  if (!response.data) {
    throw new Error(response.message || 'Unable to run runtime doctor');
  }
  return response.data;
};

export const getXrayConfigSnapshots = async (params: { limit?: number } = {}): Promise<XrayConfigSnapshotList> => {
  const response = await xrayApi.getConfigSnapshots(params);
  return response.data ?? {
    directory: '',
    snapshots: []
  };
};

export const createXrayConfigSnapshot = async (): Promise<XrayConfigSnapshot> => {
  const response = await xrayApi.createConfigSnapshot();
  if (!response.data) {
    throw new Error(response.message || 'Unable to create config snapshot');
  }
  return response.data;
};

export const rollbackXrayConfigSnapshot = async (payload: { snapshotId: string; applyMethod?: 'restart' | 'hot' | 'none' }): Promise<XrayActionResult> => {
  const response = await xrayApi.rollbackConfigSnapshot(payload);
  if (!response.data) {
    throw new Error(response.message || 'Unable to rollback config snapshot');
  }
  return response.data;
};

export const getXrayRoutingProfile = async (): Promise<XrayRoutingProfile> => {
  const response = await xrayApi.getRoutingProfile();
  if (!response.data) {
    throw new Error(response.message || 'Unable to fetch routing profile');
  }
  return response.data;
};

export const updateXrayRoutingProfile = async (payload: Partial<XrayRoutingProfile> & { apply?: boolean }): Promise<{ profile: XrayRoutingProfile; apply?: XrayActionResult | null }> => {
  const response = await xrayApi.updateRoutingProfile(payload);
  if (!response.data) {
    throw new Error(response.message || 'Unable to update routing profile');
  }
  return response.data;
};

export const getXrayGeodataStatus = async (params: { includeHash?: boolean } = {}): Promise<XrayGeodataStatus> => {
  const response = await xrayApi.getGeodataStatus(params);
  if (!response.data) {
    throw new Error(response.message || 'Unable to fetch geodata status');
  }
  return response.data;
};

export const updateXrayGeodata = async (payload: { useCommand?: boolean; forceDownload?: boolean; reload?: boolean; command?: string } = {}): Promise<{ result: unknown; reloaded?: XrayActionResult | null }> => {
  const response = await xrayApi.updateGeodata(payload);
  if (!response.data) {
    throw new Error(response.message || 'Unable to update geodata');
  }
  return response.data;
};

export const syncXrayConfDir = async (): Promise<{ directory: string; files: Array<{ name: string; path: string }>; inbounds: number }> => {
  const response = await xrayApi.syncConfDir();
  if (!response.data) {
    throw new Error(response.message || 'Unable to sync confdir');
  }
  return response.data;
};

export const getXrayConfDirStatus = async (): Promise<{ directory: string; files: Array<{ name: string; path: string; size: number; modifiedAt: string }> }> => {
  const response = await xrayApi.getConfDirStatus();
  if (!response.data) {
    throw new Error(response.message || 'Unable to fetch confdir status');
  }
  return response.data;
};
