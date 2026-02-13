import { useQuery } from '@tanstack/react-query';
import {
    ArrowDown,
    ArrowUp,
    Calendar,
    Clock,
    Copy,
    Download,
    Info,
    QrCode,
    Server,
    Share2
} from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';

import { QRCodeDisplay } from '../components/molecules/QRCodeDisplay';
import { useToast } from '../hooks/useToast';
import { useTheme } from '../hooks/useTheme';

interface UserInfo {
    email: string;
    status: string;
    usage: {
        upload: number;
        download: number;
        total: number;
        limit: number;
        remaining: number;
        percent: number;
    };
    expiry: {
        date: string;
        daysRemaining: number;
    };
    subscription: {
        url: string;
        clashUrl: string;
        qrUrl: string;
    };
    inbounds: Array<{
        id: number;
        tag: string;
        protocol: string;
        remark: string | null;
    }>;
    trafficResetPeriod: string;
    lastTrafficReset: string | null;
}

const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
};

export const UserInfoPage = () => {
  const { token } = useParams<{ token: string }>();
  const [showQR, setShowQR] = useState(false);
  const toast = useToast();
  useTheme(); // Initialize theme to ensure dark class is applied from local storage

    // We fetch directly from the backend URL since this is a public page
    // and might not be served from the same domain in production setups
    const apiUrl = import.meta.env.VITE_API_URL || '';
    // Strip /api endpoint if present to get base URL, as the user info route is mounted at root /user
    const backendUrl = apiUrl.replace(/\/api\/?$/, '');

    const { data, isLoading, error } = useQuery({
        queryKey: ['userInfo', token],
        queryFn: async () => {
            const res = await fetch(`${backendUrl}/user/${token}/info`);
            if (!res.ok) throw new Error('Failed to load user info');
            return (await res.json()).data as UserInfo;
        },
        enabled: !!token
    });

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent"></div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-900">
                <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg text-center dark:bg-gray-800">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20">
                        <Info className="h-8 w-8 text-red-600 dark:text-red-400" />
                    </div>
                    <h2 className="mb-2 text-xl font-bold text-gray-900 dark:text-white">Information Not Found</h2>
                    <p className="text-gray-600 dark:text-gray-400">The subscription token is invalid or has been revoked.</p>
                </div>
            </div>
        );
    }

  const copyToClipboard = async (text: string) => {
      try {
          await navigator.clipboard.writeText(text);
          toast.success('Copied to clipboard', 'Copied to clipboard.');
      } catch {
          toast.error('Copy failed', 'Unable to copy to clipboard.');
      }
  };

    return (
        <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8 dark:bg-gray-900 transition-colors duration-200">
            <div className="mx-auto max-w-3xl space-y-6">
                {/* Header User Card */}
                <div className="overflow-hidden rounded-xl bg-gradient-to-r from-blue-600 to-indigo-700 shadow-lg text-white">
                    <div className="p-6 sm:p-8">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h1 className="text-2xl font-bold tracking-tight">{data.email}</h1>
                                <div className="mt-2 flex items-center space-x-4">
                                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${data.status === 'ACTIVE'
                                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-100'
                                        : data.status === 'EXPIRED'
                                            ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-100'
                                            : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-100'
                                        }`}>
                                        {data.status}
                                    </span>
                                    {data.trafficResetPeriod !== 'NEVER' && (
                                        <span className="flex items-center text-sm opacity-90">
                                            <Clock className="mr-1 h-3 w-3" />
                                            Resets {data.trafficResetPeriod.toLowerCase()}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="mt-4 sm:mt-0 text-right">
                                <div className="mb-1 text-sm opacity-80">Valid until</div>
                                <div className="flex items-center justify-end font-medium">
                                    <Calendar className="mr-2 h-4 w-4" />
                                    {new Date(data.expiry.date).toLocaleDateString()}
                                </div>
                                <div className="mt-1 text-xs opacity-75">
                                    ({data.expiry.daysRemaining} days remaining)
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Usage Bar */}
                    <div className="bg-black/10 px-6 py-4 sm:px-8">
                        <div className="mb-2 flex justify-between text-sm">
                            <span>Data Usage</span>
                            <span className="font-medium">
                                {formatBytes(data.usage.total)} / {data.usage.limit > 0 ? formatBytes(data.usage.limit) : '∞'}
                            </span>
                        </div>
                        <div className="h-3 w-full overflow-hidden rounded-full bg-white/20">
                            <div
                                className={`h-full transition-all duration-500 ${data.usage.percent > 90 ? 'bg-red-400' : 'bg-green-400'
                                    }`}
                                style={{ width: `${Math.min(data.usage.percent, 100)}%` }}
                            />
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                            <div className="flex items-center">
                                <ArrowUp className="mr-2 h-4 w-4 text-blue-200" />
                                <span className="text-blue-100">Upload: {formatBytes(data.usage.upload)}</span>
                            </div>
                            <div className="flex items-center justify-end">
                                <ArrowDown className="mr-2 h-4 w-4 text-green-200" />
                                <span className="text-green-100">Download: {formatBytes(data.usage.download)}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <button
                        onClick={() => { void copyToClipboard(data.subscription.url); }}
                        className="flex items-center justify-center rounded-xl bg-white p-4 shadow-sm transition hover:bg-gray-50 hover:shadow-md dark:bg-gray-800 dark:hover:bg-gray-700"
                    >
                        <Copy className="mr-3 h-6 w-6 text-blue-600 dark:text-blue-400" />
                        <div className="text-left">
                            <div className="font-semibold text-gray-900 dark:text-white">Copy Link</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">Subscription URL</div>
                        </div>
                    </button>

                    <button
                        onClick={() => setShowQR(!showQR)}
                        className="flex items-center justify-center rounded-xl bg-white p-4 shadow-sm transition hover:bg-gray-50 hover:shadow-md dark:bg-gray-800 dark:hover:bg-gray-700"
                    >
                        <QrCode className="mr-3 h-6 w-6 text-purple-600 dark:text-purple-400" />
                        <div className="text-left">
                            <div className="font-semibold text-gray-900 dark:text-white">Show QR</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">Scan to import</div>
                        </div>
                    </button>

                    <a
                        href={data.subscription.clashUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center rounded-xl bg-white p-4 shadow-sm transition hover:bg-gray-50 hover:shadow-md dark:bg-gray-800 dark:hover:bg-gray-700"
                    >
                        <Download className="mr-3 h-6 w-6 text-orange-600 dark:text-orange-400" />
                        <div className="text-left">
                            <div className="font-semibold text-gray-900 dark:text-white">Download Config</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">Clash / Meta format</div>
                        </div>
                    </a>

                    <button
                        onClick={() => window.open(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(data.subscription.url)}`, '_blank')}
                        className="flex items-center justify-center rounded-xl bg-white p-4 shadow-sm transition hover:bg-gray-50 hover:shadow-md dark:bg-gray-800 dark:hover:bg-gray-700"
                    >
                        <Share2 className="mr-3 h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                        <div className="text-left">
                            <div className="font-semibold text-gray-900 dark:text-white">Share</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">Open external QR</div>
                        </div>
                    </button>
                </div>

                {/* QR Code Expansion */}
                {showQR && (
                    <div className="overflow-hidden rounded-xl bg-white p-8 shadow-lg text-center animate-in fade-in zoom-in duration-300 dark:bg-gray-800">
                        <h3 className="mb-6 text-lg font-medium text-gray-900 dark:text-white">Scan with your VPN client</h3>
                        <div className="mx-auto mb-4 bg-white p-2 inline-block rounded-lg shadow-inner border border-gray-100">
                            <QRCodeDisplay
                                text={data.subscription.url}
                                size={256}
                            />
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">or copy the link above</p>
                    </div>
                )}

                {/* Configurations List */}
                <div className="rounded-xl bg-white shadow-sm overflow-hidden dark:bg-gray-800">
                    <div className="border-b border-gray-100 bg-gray-50/50 px-6 py-4 dark:border-gray-700 dark:bg-gray-800/50">
                        <h3 className="font-semibold text-gray-900 dark:text-white">Available Configurations</h3>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-700">
                        {data.inbounds.map((inbound) => (
                            <div key={inbound.id} className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition dark:hover:bg-gray-700">
                                <div className="flex items-center">
                                    <div className="mr-4 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                                        <Server className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <div className="font-medium text-gray-900 dark:text-white">{inbound.remark || inbound.tag}</div>
                                        <div className="text-xs text-gray-500 uppercase dark:text-gray-400">{inbound.protocol}</div>
                                    </div>
                                </div>
                                <button
                                    onClick={() => copyToClipboard(inbound.remark || inbound.tag)}
                                    className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-600 dark:hover:text-gray-300"
                                >
                                    <Copy className="h-4 w-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="text-center text-xs text-gray-400 py-4 dark:text-gray-500">
                    Powered by One-UI
                </div>
            </div>
        </div>
    );
};
