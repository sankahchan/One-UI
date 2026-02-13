import { useQuery } from '@tanstack/react-query';

import * as systemApi from '../api/system';

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: systemApi.getHealth,
    refetchInterval: 30_000
  });
}

export function useSystemStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: systemApi.getStats,
    refetchInterval: 20_000
  });
}
