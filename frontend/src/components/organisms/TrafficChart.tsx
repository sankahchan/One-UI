import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import apiClient from '../../api/client';
import { formatBytes } from '../../utils/formatters';
import { Card } from '../atoms/Card';

interface TrafficChartProps {
  userId: number;
}

interface TrafficLog {
  timestamp: string;
  upload: number;
  download: number;
}

interface ChartPoint {
  dateKey: string;
  date: string;
  upload: number;
  download: number;
  total: number;
}

export const TrafficChart: React.FC<TrafficChartProps> = ({ userId }) => {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['traffic-logs', userId],
    queryFn: async () => {
      const response = await apiClient.get('/users/' + userId + '/traffic?days=30');
      return (response?.data || []) as TrafficLog[];
    },
    enabled: Number.isInteger(userId) && userId > 0
  });

  if (isLoading) {
    return (
      <Card>
        <h2 className="mb-4 text-xl font-bold text-foreground">Traffic Usage (Last 30 Days)</h2>
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-line/70 border-t-brand-500" />
        </div>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <h2 className="mb-4 text-xl font-bold text-foreground">Traffic Usage (Last 30 Days)</h2>
        <div className="flex h-64 items-center justify-center text-muted">Unable to load traffic data</div>
      </Card>
    );
  }

  const logs = data || [];

  const chartData = logs.reduce((acc: ChartPoint[], log: TrafficLog) => {
    const day = new Date(log.timestamp);
    const dateKey = day.toISOString().split('T')[0];
    const date = day.toLocaleDateString();
    const existing = acc.find((item) => item.dateKey === dateKey);

    const upload = Number(log.upload || 0);
    const download = Number(log.download || 0);

    if (existing) {
      existing.upload += upload;
      existing.download += download;
      existing.total += upload + download;
    } else {
      acc.push({
        dateKey,
        date,
        upload,
        download,
        total: upload + download
      });
    }

    return acc;
  }, []);

  chartData.sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length >= 2) {
      const upload = Number(payload[0].value || 0);
      const download = Number(payload[1].value || 0);
      return (
        <div className="rounded-xl border border-line/80 bg-card/95 p-3 shadow-soft backdrop-blur-lg">
          <p className="mb-2 text-sm font-semibold text-foreground">{payload[0].payload.date}</p>
          <p className="text-sm text-blue-500">Upload: {formatBytes(upload)}</p>
          <p className="text-sm text-emerald-500">Download: {formatBytes(download)}</p>
          <p className="text-sm font-semibold text-foreground">Total: {formatBytes(upload + download)}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <Card>
      <h2 className="mb-4 text-xl font-bold text-foreground">Traffic Usage (Last 30 Days)</h2>
      {chartData.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-muted">No traffic data available</div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12, fill: '#64748b' }}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis
              tickFormatter={(value: number) => formatBytes(value)}
              tick={{ fontSize: 12, fill: '#64748b' }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12, color: '#64748b' }} />
            <Line type="monotone" dataKey="upload" stroke="#3b82f6" strokeWidth={2} name="Upload" dot={false} />
            <Line type="monotone" dataKey="download" stroke="#10b981" strokeWidth={2} name="Download" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
};
