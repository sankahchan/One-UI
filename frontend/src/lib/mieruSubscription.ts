const PLACEHOLDER_ORIGIN = 'http://one-ui.local';

function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z\d+\-.]*:\/\//i.test(value);
}

export function toMieruPageUrl(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) {
    return '';
  }

  try {
    const absolute = isAbsoluteUrl(raw);
    const parsed = absolute ? new URL(raw) : new URL(raw, PLACEHOLDER_ORIGIN);
    const target = parsed.searchParams.get('target');

    if (target && target.toLowerCase() === 'mieru') {
      parsed.searchParams.delete('target');
    }

    if (!/\/mieru\/?$/i.test(parsed.pathname)) {
      parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/mieru`;
    }

    if (absolute) {
      return parsed.toString();
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return raw;
  }
}
