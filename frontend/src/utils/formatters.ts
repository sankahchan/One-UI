export const formatBytes = (value: number | string | bigint, decimals: number = 2): string => {
  const bytes = Number(value);

  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

export const formatDate = (date: string | Date): string => {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

export const formatDateTime = (date: string | Date): string => {
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export const getDaysRemaining = (expireDate: string): number => {
  const now = new Date();
  const expire = new Date(expireDate);
  const diff = expire.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
};
