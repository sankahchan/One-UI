import type { Inbound } from '../types';

export interface ProtocolCompatibilityItem {
  protocol: Inbound['protocol'];
  title: string;
  useCase: string;
  networks: Inbound['network'][];
  security: Inbound['security'][];
  clients: string[];
  recommendation: string;
}

export const protocolCompatibility: ProtocolCompatibilityItem[] = [
  {
    protocol: 'VLESS',
    title: 'VLESS',
    useCase: 'Best overall protocol for modern Xray deployments',
    networks: ['TCP', 'WS', 'GRPC', 'HTTPUPGRADE', 'XHTTP'],
    security: ['NONE', 'TLS', 'REALITY'],
    clients: ['v2rayN', 'v2rayNG', 'Clash Meta', 'sing-box'],
    recommendation: 'Use REALITY + XHTTP for anti-censorship or WS+TLS for CDN.'
  },
  {
    protocol: 'VMESS',
    title: 'VMess',
    useCase: 'Legacy compatibility with older V2Ray clients',
    networks: ['TCP', 'WS', 'GRPC', 'HTTP'],
    security: ['NONE', 'TLS'],
    clients: ['v2rayN', 'v2rayNG', 'some Clash cores'],
    recommendation: 'Prefer VLESS for new installs; keep VMess for migration.'
  },
  {
    protocol: 'TROJAN',
    title: 'Trojan',
    useCase: 'TLS-native protocol with strong censorship resistance',
    networks: ['TCP', 'WS', 'GRPC'],
    security: ['TLS'],
    clients: ['Clash', 'sing-box', 'NekoBox'],
    recommendation: 'Use gRPC+TLS for clean setup and stable performance.'
  },
  {
    protocol: 'SHADOWSOCKS',
    title: 'Shadowsocks',
    useCase: 'Lightweight encrypted proxy for low overhead scenarios',
    networks: ['TCP'],
    security: ['NONE'],
    clients: ['Shadowrocket', 'Clash', 'Outline-compatible apps'],
    recommendation: 'Great fallback profile; pair with strong cipher.'
  },
  {
    protocol: 'SOCKS',
    title: 'SOCKS5',
    useCase: 'Generic proxy for apps and browsers',
    networks: ['TCP'],
    security: ['NONE'],
    clients: ['Browsers', 'OS proxy', 'Proxifier'],
    recommendation: 'Use for local gateway use-cases with account auth.'
  },
  {
    protocol: 'HTTP',
    title: 'HTTP Proxy',
    useCase: 'Simple forward proxy for standard HTTP tooling',
    networks: ['TCP'],
    security: ['NONE'],
    clients: ['Browsers', 'curl', 'system proxy'],
    recommendation: 'Use where HTTP proxy support is explicitly required.'
  },
  {
    protocol: 'DOKODEMO_DOOR',
    title: 'Dokodemo-door',
    useCase: 'Traffic forwarding and transparent proxy integration',
    networks: ['TCP'],
    security: ['NONE'],
    clients: ['Xray internal routing', 'DNS forwarders'],
    recommendation: 'Ideal for DNS forward and transparent redirection flows.'
  },
  {
    protocol: 'WIREGUARD',
    title: 'WireGuard',
    useCase: 'Tunnel outbound transport through WireGuard peer',
    networks: ['TCP'],
    security: ['NONE'],
    clients: ['WireGuard app (for preview config)', 'Xray upstream'],
    recommendation: 'Set peer endpoint + keys first, then route traffic through it.'
  },
  {
    protocol: 'MTPROTO',
    title: 'MTProto',
    useCase: 'Telegram-specific proxy protocol',
    networks: ['TCP'],
    security: ['NONE'],
    clients: ['Telegram MTProto proxy clients'],
    recommendation: 'Use dedicated port and isolate from normal user traffic.'
  }
];

