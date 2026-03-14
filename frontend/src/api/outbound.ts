import apiClient from './client';
import type { ApiResponse } from '../types';

export interface Outbound {
  id: number;
  tag: string;
  protocol: 'FREEDOM' | 'BLACKHOLE' | 'SOCKS' | 'HTTP' | 'TROJAN' | 'VMESS' | 'VLESS' | 'SHADOWSOCKS';
  address: string;
  port: number;
  enabled: boolean;
  remark?: string;
  settings: Record<string, unknown>;
  streamSettings?: Record<string, unknown> | null;
  mux?: Record<string, unknown> | null;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export type OutboundPayload = Omit<Outbound, 'id' | 'createdAt' | 'updatedAt'>;

export const outboundApi = {
  list: async (params: { page?: number; limit?: number } = {}): Promise<ApiResponse<Outbound[]>> => {
    return apiClient.get('/outbounds', { params });
  },
  getById: async (id: number): Promise<ApiResponse<Outbound>> => {
    return apiClient.get(`/outbounds/${id}`);
  },
  create: async (data: Partial<OutboundPayload>): Promise<ApiResponse<Outbound>> => {
    return apiClient.post('/outbounds', data);
  },
  update: async (id: number, data: Partial<OutboundPayload>): Promise<ApiResponse<Outbound>> => {
    return apiClient.put(`/outbounds/${id}`, data);
  },
  remove: async (id: number): Promise<ApiResponse<null>> => {
    return apiClient.delete(`/outbounds/${id}`);
  },
  toggle: async (id: number): Promise<ApiResponse<Outbound>> => {
    return apiClient.post(`/outbounds/${id}/toggle`);
  }
};

export const getOutbounds = async (params: { page?: number; limit?: number } = {}): Promise<{ items: Outbound[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> => {
  const response = await outboundApi.list(params);
  return {
    items: response.data ?? [],
    pagination: response.pagination ?? { page: 1, limit: 50, total: 0, totalPages: 1 }
  };
};

export const createOutbound = async (data: Partial<OutboundPayload>): Promise<Outbound> => {
  const response = await outboundApi.create(data);
  if (!response.data) throw new Error(response.message || 'Failed to create outbound');
  return response.data;
};

export const updateOutbound = async (id: number, data: Partial<OutboundPayload>): Promise<Outbound> => {
  const response = await outboundApi.update(id, data);
  if (!response.data) throw new Error(response.message || 'Failed to update outbound');
  return response.data;
};

export const deleteOutbound = async (id: number): Promise<void> => {
  await outboundApi.remove(id);
};

export const toggleOutbound = async (id: number): Promise<Outbound> => {
  const response = await outboundApi.toggle(id);
  if (!response.data) throw new Error(response.message || 'Failed to toggle outbound');
  return response.data;
};
