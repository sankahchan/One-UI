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

export const mieruApi = {
  getPolicy: async (): Promise<ApiResponse<MieruPolicy>> => apiClient.get('/mieru/policy'),
  getStatus: async (): Promise<ApiResponse<MieruStatus>> => apiClient.get('/mieru/status'),
  restart: async (): Promise<ApiResponse<MieruRestartResult>> => apiClient.post('/mieru/restart'),
  getLogs: async (params: { lines?: number } = {}): Promise<ApiResponse<MieruLogs>> =>
    apiClient.get('/mieru/logs', { params })
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

export const getMieruLogs = async (lines = 120): Promise<MieruLogs> => {
  const response = await mieruApi.getLogs({ lines });
  if (!response.data) {
    throw new Error(response.message || 'Unable to fetch Mieru logs');
  }
  return response.data;
};
