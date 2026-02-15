import React, { useState } from 'react';
import { Plus, Radio, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

export const MobileQuickActions: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const refreshAll = async () => {
    if (refreshing) {
      return;
    }

    setRefreshing(true);
    try {
      await queryClient.invalidateQueries();
    } finally {
      window.setTimeout(() => setRefreshing(false), 550);
    }
  };

  return (
    <div className="fixed bottom-[4.75rem] right-3 z-40 lg:hidden">
      <div className="flex items-center gap-2 rounded-2xl border border-line/80 bg-card/90 p-2 shadow-soft backdrop-blur-xl">
        <button
          type="button"
          onClick={() => navigate('/inbounds?quick=create')}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line/70 bg-card/80 text-foreground transition hover:bg-card"
          aria-label="Quick add inbound"
          title="Quick add inbound"
        >
          <Radio className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={refreshAll}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line/70 bg-card/80 text-foreground transition hover:bg-card"
          aria-label="Refresh"
          title="Refresh data"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
        <button
          type="button"
          onClick={() => navigate('/users?quick=create')}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 px-3 text-sm font-semibold text-white transition hover:brightness-110"
        >
          <Plus className="h-4 w-4" />
          Create
        </button>
      </div>
    </div>
  );
};

