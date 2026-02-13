import apiClient from './client';
import type { ApiResponse, SystemStats } from '../types';

interface HealthData {
  status: string;
  timestamp: string;
}

export async function getHealth(): Promise<HealthData> {
  const response = await apiClient.get<any, ApiResponse<HealthData>>('/system/health');
  if (!response.data) {
    throw new Error(response.message || 'Health check failed');
  }
  return response.data;
}

interface RawSystemStats {
  users?: number | { total: number; active: number; expired: number; disabled: number };
  active?: number;
  expired?: number;
  disabled?: number;
  totalUpload?: number;
  totalDownload?: number;
  totalTraffic?: number;
  traffic?: {
    totalUpload?: number;
    totalDownload?: number;
    totalTraffic?: number;
  };
}

export async function getStats(): Promise<SystemStats> {
  const response = await apiClient.get<any, ApiResponse<RawSystemStats>>('/system/stats');
  const raw = response.data || {};

  const users =
    typeof raw.users === 'object' && raw.users !== null
      ? raw.users
      : {
          total: typeof raw.users === 'number' ? raw.users : 0,
          active: raw.active ?? 0,
          expired: raw.expired ?? 0,
          disabled: raw.disabled ?? 0
        };

  const traffic = raw.traffic || {
    totalUpload: raw.totalUpload ?? 0,
    totalDownload: raw.totalDownload ?? 0,
    totalTraffic: raw.totalTraffic ?? 0
  };

  return {
    users: {
      total: users.total ?? 0,
      active: users.active ?? 0,
      expired: users.expired ?? 0,
      disabled: users.disabled ?? 0
    },
    traffic: {
      totalUpload: traffic.totalUpload ?? 0,
      totalDownload: traffic.totalDownload ?? 0,
      totalTraffic: traffic.totalTraffic ?? 0
    }
  };
}
