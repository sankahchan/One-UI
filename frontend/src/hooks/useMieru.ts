import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getMieruLogs,
  getMieruPolicy,
  getMieruStatus,
  restartMieru,
  syncMieruUsers,
  type MieruLogs,
  type MieruPolicy,
  type MieruRestartResult,
  type MieruSyncResult,
  type MieruStatus
} from '../api/mieru';

export const useMieruPolicy = () => {
  return useQuery<MieruPolicy>({
    queryKey: ['mieru-policy'],
    queryFn: getMieruPolicy,
    refetchInterval: 30_000,
    staleTime: 10_000
  });
};

export const useMieruStatus = () => {
  return useQuery<MieruStatus>({
    queryKey: ['mieru-status'],
    queryFn: getMieruStatus,
    refetchInterval: 15_000,
    staleTime: 5_000
  });
};

export const useMieruLogs = (lines = 120, enabled = true) => {
  return useQuery<MieruLogs>({
    queryKey: ['mieru-logs', lines],
    queryFn: () => getMieruLogs(lines),
    enabled,
    staleTime: 3_000
  });
};

export const useRestartMieru = () => {
  const queryClient = useQueryClient();

  return useMutation<MieruRestartResult>({
    mutationFn: restartMieru,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mieru-status'] });
      void queryClient.invalidateQueries({ queryKey: ['mieru-logs'] });
      void queryClient.invalidateQueries({ queryKey: ['mieru-policy'] });
    }
  });
};

export const useSyncMieruUsers = () => {
  const queryClient = useQueryClient();

  return useMutation<MieruSyncResult, Error, string | undefined>({
    mutationFn: (reason) => syncMieruUsers(reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mieru-status'] });
      void queryClient.invalidateQueries({ queryKey: ['mieru-logs'] });
      void queryClient.invalidateQueries({ queryKey: ['mieru-policy'] });
    }
  });
};
