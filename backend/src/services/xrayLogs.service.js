const fs = require('fs');
const fsp = require('fs').promises;
const { execFile } = require('child_process');
const util = require('util');

const execFileAsync = util.promisify(execFile);

const DEFAULT_LOG_PATHS = {
  access: process.env.XRAY_ACCESS_LOG || '/var/log/xray/access.log',
  error: process.env.XRAY_ERROR_LOG || '/var/log/xray/error.log',
  output: process.env.XRAY_OUTPUT_LOG || '/var/log/xray/output.log'
};

const ALLOWED_TYPES = new Set(Object.keys(DEFAULT_LOG_PATHS));
const ALLOWED_LEVELS = new Set(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'UNKNOWN']);
const ALLOWED_PROTOCOLS = new Set([
  'VLESS',
  'VMESS',
  'TROJAN',
  'SHADOWSOCKS',
  'SOCKS',
  'HTTP',
  'DOKODEMO_DOOR',
  'WIREGUARD',
  'MTPROTO',
  'UNKNOWN'
]);

const PROTOCOL_MATCHERS = [
  { keyword: 'dokodemo-door', value: 'DOKODEMO_DOOR' },
  { keyword: 'shadowsocks', value: 'SHADOWSOCKS' },
  { keyword: 'wireguard', value: 'WIREGUARD' },
  { keyword: 'mtproto', value: 'MTPROTO' },
  { keyword: 'trojan', value: 'TROJAN' },
  { keyword: 'vmess', value: 'VMESS' },
  { keyword: 'vless', value: 'VLESS' },
  { keyword: 'socks', value: 'SOCKS' },
  { keyword: 'http', value: 'HTTP' }
];

class XrayLogsService {
  normalizeType(type) {
    const normalized = String(type || 'access').trim().toLowerCase();
    return ALLOWED_TYPES.has(normalized) ? normalized : 'access';
  }

  normalizeLines(lines) {
    const parsed = Number.parseInt(String(lines || 200), 10);
    if (Number.isNaN(parsed) || parsed < 1) {
      return 200;
    }
    return Math.min(parsed, 2000);
  }

  normalizeInterval(intervalMs) {
    const parsed = Number.parseInt(String(intervalMs || 2000), 10);
    if (Number.isNaN(parsed) || parsed < 500) {
      return 2000;
    }
    return Math.min(parsed, 10000);
  }

  normalizeSearch(search) {
    if (search === undefined || search === null) {
      return '';
    }
    return String(search).trim();
  }

  normalizeLevel(level) {
    const normalized = String(level || '')
      .trim()
      .toUpperCase();
    return ALLOWED_LEVELS.has(normalized) ? normalized : '';
  }

  normalizeProtocol(protocol) {
    const normalized = String(protocol || '')
      .trim()
      .toUpperCase();
    return ALLOWED_PROTOCOLS.has(normalized) ? normalized : '';
  }

  normalizeFilterValue(value) {
    if (value === undefined || value === null) {
      return '';
    }
    return String(value).trim();
  }

  getPath(type) {
    const normalizedType = this.normalizeType(type);
    return DEFAULT_LOG_PATHS[normalizedType];
  }

  async readLastLines(filePath, lines) {
    try {
      const { stdout } = await execFileAsync('tail', ['-n', String(lines), filePath]);
      return stdout.split(/\r?\n/).filter((line) => line.length > 0);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw error;
      }

      const content = await fsp.readFile(filePath, 'utf8');
      return content
        .split(/\r?\n/)
        .filter((line) => line.length > 0)
        .slice(-lines);
    }
  }

  extractTimestamp(line) {
    if (!line) {
      return '';
    }

    const isoLikeMatch = line.match(
      /(\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z)?)/
    );
    return isoLikeMatch ? isoLikeMatch[1] : '';
  }

  extractLevel(line) {
    if (!line) {
      return 'UNKNOWN';
    }

    const bracketLevelMatch = line.match(/\[(debug|info|warning|error)\]/i);
    if (bracketLevelMatch) {
      return bracketLevelMatch[1].toUpperCase();
    }

    if (/\b(error|fatal|critical)\b/i.test(line)) {
      return 'ERROR';
    }

    if (/\bwarn(?:ing)?\b/i.test(line)) {
      return 'WARNING';
    }

    if (/\bdebug\b/i.test(line)) {
      return 'DEBUG';
    }

    if (/\binfo\b/i.test(line)) {
      return 'INFO';
    }

    return 'UNKNOWN';
  }

  extractProtocol(line) {
    if (!line) {
      return 'UNKNOWN';
    }

    const lowered = line.toLowerCase();
    const match = PROTOCOL_MATCHERS.find((entry) => lowered.includes(entry.keyword));
    return match ? match.value : 'UNKNOWN';
  }

  extractIp(line) {
    if (!line) {
      return '';
    }

    const ipv4 = line.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    if (ipv4) {
      return ipv4[0];
    }

    const ipv6 = line.match(/\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/i);
    return ipv6 ? ipv6[0] : '';
  }

  extractUser(line) {
    if (!line) {
      return '';
    }

    const emailMatch = line.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}/);
    if (emailMatch) {
      return emailMatch[0];
    }

    const uuidMatch = line.match(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i
    );
    return uuidMatch ? uuidMatch[0] : '';
  }

  parseLine(rawLine) {
    return {
      raw: rawLine,
      timestamp: this.extractTimestamp(rawLine),
      level: this.extractLevel(rawLine),
      protocol: this.extractProtocol(rawLine),
      ip: this.extractIp(rawLine),
      user: this.extractUser(rawLine)
    };
  }

  matchesFilters(entry, filters) {
    if (filters.search && !entry.raw.toLowerCase().includes(filters.search.toLowerCase())) {
      return false;
    }

    if (filters.level && entry.level !== filters.level) {
      return false;
    }

    if (filters.protocol && entry.protocol !== filters.protocol) {
      return false;
    }

    if (filters.ip && !entry.ip.toLowerCase().includes(filters.ip.toLowerCase())) {
      return false;
    }

    if (filters.user && !entry.user.toLowerCase().includes(filters.user.toLowerCase())) {
      return false;
    }

    return true;
  }

  summarizeEntries(entries) {
    const levels = {};
    const protocols = {};

    for (const entry of entries) {
      levels[entry.level] = (levels[entry.level] || 0) + 1;
      protocols[entry.protocol] = (protocols[entry.protocol] || 0) + 1;
    }

    return {
      total: entries.length,
      levels,
      protocols
    };
  }

  async tail({
    type = 'access',
    lines = 200,
    search = '',
    level = '',
    protocol = '',
    ip = '',
    user = ''
  } = {}) {
    const normalizedType = this.normalizeType(type);
    const logPath = this.getPath(normalizedType);
    const safeLines = this.normalizeLines(lines);
    const filters = {
      search: this.normalizeSearch(search),
      level: this.normalizeLevel(level),
      protocol: this.normalizeProtocol(protocol),
      ip: this.normalizeFilterValue(ip),
      user: this.normalizeFilterValue(user)
    };

    const exists = fs.existsSync(logPath);
    if (!exists) {
      return {
        type: normalizedType,
        path: logPath,
        missing: true,
        lines: [],
        entries: [],
        summary: {
          total: 0,
          levels: {},
          protocols: {}
        },
        filters,
        timestamp: new Date().toISOString()
      };
    }

    const logLines = await this.readLastLines(logPath, safeLines);
    const parsedEntries = logLines.map((line) => this.parseLine(line));
    const filteredEntries = parsedEntries.filter((entry) => this.matchesFilters(entry, filters));
    const filteredLines = filteredEntries.map((entry) => entry.raw);

    return {
      type: normalizedType,
      path: logPath,
      missing: false,
      lines: filteredLines,
      entries: filteredEntries,
      summary: this.summarizeEntries(filteredEntries),
      filters,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new XrayLogsService();
