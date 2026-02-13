import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inboundsApi } from '../api/inbounds';

export const useInbounds = () => {
  return useQuery({
    queryKey: ['inbounds'],
    queryFn: async () => {
      const response = await inboundsApi.getInbounds();
      return response.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000
  });
};

export const useInbound = (id: number) => {
  return useQuery({
    queryKey: ['inbound', id],
    queryFn: async () => {
      const response = await inboundsApi.getInboundById(id);
      return response.data;
    },
    enabled: !!id,
    staleTime: 30_000
  });
};

export const useCreateInbound = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: any) => {
      const response = await inboundsApi.createInbound(data);
      return response.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inbounds'] });
    }
  });
};

export const useUpdateInbound = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const response = await inboundsApi.updateInbound(id, data);
      return response.data;
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['inbounds'] });
      void queryClient.invalidateQueries({ queryKey: ['inbound', variables.id] });
    }
  });
};

export const useDeleteInbound = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      await inboundsApi.deleteInbound(id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inbounds'] });
    }
  });
};

export const useToggleInbound = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const response = await inboundsApi.toggleInbound(id);
      return response.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inbounds'] });
    }
  });
};

export const useBulkDeleteInbounds = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (inboundIds: number[]) => {
      const response = await inboundsApi.bulkDeleteInbounds(inboundIds);
      return response.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inbounds'] });
    }
  });
};

export const useBulkEnableInbounds = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (inboundIds: number[]) => {
      const response = await inboundsApi.bulkEnableInbounds(inboundIds);
      return response.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inbounds'] });
    }
  });
};

export const useBulkDisableInbounds = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (inboundIds: number[]) => {
      const response = await inboundsApi.bulkDisableInbounds(inboundIds);
      return response.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inbounds'] });
    }
  });
};

export const useApplyMyanmarPreset = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      serverAddress: string;
      serverName?: string;
      cdnHost?: string;
      fallbackPorts?: number[] | string;
    }) => {
      const response = await inboundsApi.applyMyanmarPreset(payload);
      return response.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inbounds'] });
      void queryClient.invalidateQueries({ queryKey: ['inbounds-users-directory'] });
    }
  });
};
