import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getOutbounds, createOutbound, updateOutbound, deleteOutbound, toggleOutbound, type Outbound, type OutboundPayload } from '../api/outbound';

export const useOutbounds = (page = 1, limit = 50) => {
  return useQuery({
    queryKey: ['outbounds', page, limit],
    queryFn: () => getOutbounds({ page, limit }),
    staleTime: 5_000
  });
};

export const useCreateOutbound = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createOutbound,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['outbounds'] }); }
  });
};

export const useUpdateOutbound = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<OutboundPayload> }) => updateOutbound(id, data),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['outbounds'] }); }
  });
};

export const useDeleteOutbound = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteOutbound,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['outbounds'] }); }
  });
};

export const useToggleOutbound = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: toggleOutbound,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['outbounds'] }); }
  });
};
