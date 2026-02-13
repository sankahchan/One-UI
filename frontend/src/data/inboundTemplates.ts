import type { Inbound } from '../types';

export interface InboundTemplateDraft {
  protocol: Inbound['protocol'];
  network?: Inbound['network'];
  security?: Inbound['security'];
  port?: number;
  tag?: string;
  remark?: string;
  serverAddress?: string;
  serverName?: string;
  wsPath?: string;
  wsHost?: string;
  xhttpMode?: string;
  grpcServiceName?: string;
  alpn?: string;
  cipher?: string;
  realityPublicKey?: string;
  realityPrivateKey?: string;
  realityShortId?: string;
  realityFingerprint?: string;
  wgPrivateKey?: string;
  wgPublicKey?: string;
  wgAddress?: string;
  wgPeerPublicKey?: string;
  wgPeerEndpoint?: string;
  wgAllowedIPs?: string;
  wgMtu?: number;
  dokodemoTargetPort?: number;
  dokodemoNetwork?: string;
  dokodemoFollowRedirect?: boolean;
}

export interface InboundTemplate {
  id: string;
  name: string;
  description: string;
  category: 'recommended' | 'cdn' | 'transport' | 'utility';
  highlights: string[];
  values: InboundTemplateDraft;
}

export const inboundTemplates: InboundTemplate[] = [
  {
    id: 'vless-reality-xhttp',
    name: 'VLESS + REALITY + XHTTP',
    description: 'Modern anti-censorship profile for latest Xray clients.',
    category: 'recommended',
    highlights: ['Anti-censorship', 'Modern Xray', 'XHTTP'],
    values: {
      protocol: 'VLESS',
      network: 'XHTTP',
      security: 'REALITY',
      port: 443,
      tag: 'vless-reality-xhttp',
      remark: 'VLESS REALITY XHTTP',
      wsPath: '/xhttp',
      xhttpMode: 'auto',
      serverName: 'www.microsoft.com',
      realityFingerprint: 'chrome'
    }
  },
  {
    id: 'vless-reality-tcp',
    name: 'VLESS + REALITY + TCP',
    description: 'Lean REALITY profile with plain TCP transport.',
    category: 'recommended',
    highlights: ['Low overhead', 'REALITY', 'TCP'],
    values: {
      protocol: 'VLESS',
      network: 'TCP',
      security: 'REALITY',
      port: 443,
      tag: 'vless-reality-tcp',
      remark: 'VLESS REALITY TCP',
      serverName: 'www.cloudflare.com',
      realityFingerprint: 'chrome'
    }
  },
  {
    id: 'vless-ws-tls',
    name: 'VLESS + WS + TLS',
    description: 'Compatible profile for websocket clients and CDN edge.',
    category: 'cdn',
    highlights: ['CDN friendly', 'WS', 'TLS'],
    values: {
      protocol: 'VLESS',
      network: 'WS',
      security: 'TLS',
      port: 443,
      tag: 'vless-ws-tls',
      remark: 'VLESS WS TLS',
      wsPath: '/vless',
      alpn: '["h2","http/1.1"]'
    }
  },
  {
    id: 'vless-httpupgrade-tls',
    name: 'VLESS + HTTPUpgrade + TLS',
    description: 'HTTPUpgrade profile for edge/CDN traffic blending.',
    category: 'cdn',
    highlights: ['HTTPUpgrade', 'CDN edge', 'TLS'],
    values: {
      protocol: 'VLESS',
      network: 'HTTPUPGRADE',
      security: 'TLS',
      port: 443,
      tag: 'vless-httpupgrade-tls',
      remark: 'VLESS HTTPUpgrade TLS',
      wsPath: '/upgrade',
      alpn: '["h2","http/1.1"]'
    }
  },
  {
    id: 'trojan-grpc',
    name: 'Trojan + gRPC + TLS',
    description: 'Stable TLS profile with gRPC transport.',
    category: 'transport',
    highlights: ['TLS only', 'gRPC', 'Stable'],
    values: {
      protocol: 'TROJAN',
      network: 'GRPC',
      security: 'TLS',
      port: 443,
      tag: 'trojan-grpc',
      remark: 'Trojan gRPC',
      grpcServiceName: 'trojan-grpc',
      alpn: '["h2","http/1.1"]'
    }
  },
  {
    id: 'trojan-ws-tls',
    name: 'Trojan + WS + TLS',
    description: 'Trojan profile tuned for websocket deployments.',
    category: 'transport',
    highlights: ['Trojan', 'WebSocket', 'TLS'],
    values: {
      protocol: 'TROJAN',
      network: 'WS',
      security: 'TLS',
      port: 443,
      tag: 'trojan-ws-tls',
      remark: 'Trojan WS TLS',
      wsPath: '/trojan',
      alpn: '["h2","http/1.1"]'
    }
  },
  {
    id: 'vmess-ws-tls',
    name: 'VMess + WS + TLS',
    description: 'Classic VMess deployment profile.',
    category: 'transport',
    highlights: ['Legacy compatible', 'WS', 'TLS'],
    values: {
      protocol: 'VMESS',
      network: 'WS',
      security: 'TLS',
      port: 443,
      tag: 'vmess-ws-tls',
      remark: 'VMess WS TLS',
      wsPath: '/vmess',
      alpn: '["h2","http/1.1"]'
    }
  },
  {
    id: 'vmess-grpc-tls',
    name: 'VMess + gRPC + TLS',
    description: 'VMess profile with gRPC transport for modern clients.',
    category: 'transport',
    highlights: ['VMess', 'gRPC', 'TLS'],
    values: {
      protocol: 'VMESS',
      network: 'GRPC',
      security: 'TLS',
      port: 443,
      tag: 'vmess-grpc-tls',
      remark: 'VMess gRPC TLS',
      grpcServiceName: 'vmess-grpc',
      alpn: '["h2","http/1.1"]'
    }
  },
  {
    id: 'dokodemo-dns-forward',
    name: 'Dokodemo DNS Forward',
    description: 'Forward DNS traffic to an upstream resolver.',
    category: 'utility',
    highlights: ['DNS relay', 'UDP', 'Resolver'],
    values: {
      protocol: 'DOKODEMO_DOOR',
      network: 'TCP',
      security: 'NONE',
      port: 5353,
      tag: 'dokodemo-dns',
      remark: 'Dokodemo DNS Forward',
      serverAddress: '1.1.1.1',
      dokodemoTargetPort: 53,
      dokodemoNetwork: 'udp',
      dokodemoFollowRedirect: false
    }
  },
  {
    id: 'dokodemo-tcp-forward',
    name: 'Dokodemo TCP Forward',
    description: 'Forward raw TCP traffic to a target service.',
    category: 'utility',
    highlights: ['TCP relay', 'Debugging', 'Forward'],
    values: {
      protocol: 'DOKODEMO_DOOR',
      network: 'TCP',
      security: 'NONE',
      port: 10080,
      tag: 'dokodemo-tcp-forward',
      remark: 'Dokodemo TCP Forward',
      serverAddress: '127.0.0.1',
      dokodemoTargetPort: 80,
      dokodemoNetwork: 'tcp',
      dokodemoFollowRedirect: false
    }
  },
  {
    id: 'shadowsocks-tcp',
    name: 'Shadowsocks (TCP/UDP)',
    description: 'Lightweight encrypted proxy profile for broad client compatibility.',
    category: 'recommended',
    highlights: ['Fast', 'Simple', 'Broad client support'],
    values: {
      protocol: 'SHADOWSOCKS',
      network: 'TCP',
      security: 'NONE',
      port: 8388,
      tag: 'shadowsocks-main',
      remark: 'Shadowsocks Main',
      cipher: 'chacha20-ietf-poly1305'
    }
  },
  {
    id: 'socks5-local-lan',
    name: 'SOCKS5 LAN Gateway',
    description: 'SOCKS gateway profile for local/LAN applications.',
    category: 'utility',
    highlights: ['LAN apps', 'SOCKS5', 'Simple'],
    values: {
      protocol: 'SOCKS',
      network: 'TCP',
      security: 'NONE',
      port: 1080,
      tag: 'socks5-lan-gateway',
      remark: 'SOCKS5 LAN Gateway',
      serverAddress: '0.0.0.0'
    }
  },
  {
    id: 'socks5-auth',
    name: 'SOCKS5 Auth Gateway',
    description: 'Username/password SOCKS proxy using panel user credentials.',
    category: 'utility',
    highlights: ['Auth', 'SOCKS5', 'Gateway'],
    values: {
      protocol: 'SOCKS',
      network: 'TCP',
      security: 'NONE',
      port: 10808,
      tag: 'socks-auth',
      remark: 'SOCKS5 Auth Gateway'
    }
  },
  {
    id: 'http-proxy-auth',
    name: 'HTTP Proxy Auth',
    description: 'Classic authenticated HTTP forward proxy for browser/system use.',
    category: 'utility',
    highlights: ['HTTP proxy', 'Auth', 'Legacy tools'],
    values: {
      protocol: 'HTTP',
      network: 'TCP',
      security: 'NONE',
      port: 10809,
      tag: 'http-proxy-auth',
      remark: 'HTTP Proxy Auth'
    }
  },
  {
    id: 'wireguard-egress',
    name: 'WireGuard Egress Tunnel',
    description: 'Expose a local SOCKS listener routed over WireGuard outbound.',
    category: 'transport',
    highlights: ['WireGuard', 'Egress', 'Secure tunnel'],
    values: {
      protocol: 'WIREGUARD',
      network: 'TCP',
      security: 'NONE',
      port: 51820,
      tag: 'wireguard-egress',
      remark: 'WireGuard Egress',
      wgAddress: '10.66.2.2/32',
      wgAllowedIPs: '0.0.0.0/0, ::/0',
      wgMtu: 1420
    }
  },
  {
    id: 'mtproto-telegram',
    name: 'MTProto Telegram',
    description: 'Telegram-oriented proxy inbound using MTProto protocol.',
    category: 'utility',
    highlights: ['Telegram', 'MTProto', 'Stealth'],
    values: {
      protocol: 'MTPROTO',
      network: 'TCP',
      security: 'NONE',
      port: 443,
      tag: 'mtproto-telegram',
      remark: 'MTProto Telegram'
    }
  }
];
