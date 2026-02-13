import apiClient from './client';
import type { Inbound, ApiResponse } from '../types';

interface BulkInboundResult {
  requestedCount: number;
  updatedCount?: number;
  deletedCount?: number;
  enabled?: boolean;
  missingIds?: number[];
}

interface RandomPortResult {
  port: number;
}

interface MyanmarPresetPayload {
  serverAddress: string;
  serverName?: string;
  cdnHost?: string;
  fallbackPorts?: number[] | string;
  dryRun?: boolean;
}

interface MyanmarPresetResult {
  dryRun?: boolean;
  created: Inbound[];
  planned?: Array<Partial<Inbound>>;
  warnings: string[];
}

export const inboundsApi = {
  getInbounds: async (): Promise<ApiResponse<Inbound[]>> => {
    return apiClient.get('/inbounds');
  },

  getInboundById: async (id: number): Promise<ApiResponse<Inbound>> => {
    return apiClient.get(`/inbounds/${id}`);
  },

  createInbound: async (data: any): Promise<ApiResponse<Inbound>> => {
    return apiClient.post('/inbounds', data);
  },

  updateInbound: async (id: number, data: any): Promise<ApiResponse<Inbound>> => {
    return apiClient.put(`/inbounds/${id}`, data);
  },

  deleteInbound: async (id: number): Promise<ApiResponse<void>> => {
    return apiClient.delete(`/inbounds/${id}`);
  },

  toggleInbound: async (id: number): Promise<ApiResponse<Inbound>> => {
    return apiClient.post(`/inbounds/${id}/toggle`);
  },

  getRandomPort: async (): Promise<ApiResponse<RandomPortResult>> => {
    return apiClient.get('/inbounds/random-port');
  },

  assignRandomPort: async (id: number): Promise<ApiResponse<Inbound>> => {
    return apiClient.post(`/inbounds/${id}/random-port`);
  },

  bulkDeleteInbounds: async (inboundIds: number[]): Promise<ApiResponse<BulkInboundResult>> => {
    return apiClient.post('/inbounds/bulk/delete', { inboundIds });
  },

  bulkEnableInbounds: async (inboundIds: number[]): Promise<ApiResponse<BulkInboundResult>> => {
    return apiClient.post('/inbounds/bulk/enable', { inboundIds });
  },

  bulkDisableInbounds: async (inboundIds: number[]): Promise<ApiResponse<BulkInboundResult>> => {
    return apiClient.post('/inbounds/bulk/disable', { inboundIds });
  },

  applyMyanmarPreset: async (payload: MyanmarPresetPayload): Promise<ApiResponse<MyanmarPresetResult>> => {
    return apiClient.post('/inbounds/presets/myanmar', payload);
  }
};
