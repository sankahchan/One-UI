module.exports = {
  realityDestinations: [
    {
      name: 'Microsoft',
      dest: 'www.microsoft.com:443',
      serverNames: ['www.microsoft.com'],
      region: 'Global',
      reliability: 'Very High'
    },
    {
      name: 'Apple',
      dest: 'www.apple.com:443',
      serverNames: ['www.apple.com'],
      region: 'Global',
      reliability: 'Very High'
    },
    {
      name: 'Amazon AWS',
      dest: 'aws.amazon.com:443',
      serverNames: ['aws.amazon.com'],
      region: 'Global',
      reliability: 'High'
    },
    {
      name: 'Google Cloud',
      dest: 'cloud.google.com:443',
      serverNames: ['cloud.google.com'],
      region: 'Global',
      reliability: 'High'
    },
    {
      name: 'Cloudflare',
      dest: 'www.cloudflare.com:443',
      serverNames: ['www.cloudflare.com'],
      region: 'Global',
      reliability: 'Very High'
    },
    {
      name: 'Cisco',
      dest: 'www.cisco.com:443',
      serverNames: ['www.cisco.com'],
      region: 'Global',
      reliability: 'High'
    }
  ],
  recommendedWsPaths: [
    '/api/v1/stream',
    '/api/updates',
    '/graphql',
    '/websocket/chat',
    '/live/stream',
    '/analytics/events',
    '/cdn/assets',
    '/push/notifications'
  ],
  avoidPaths: [
    '/v2ray',
    '/vmess',
    '/vless',
    '/proxy',
    '/vpn',
    '/ss',
    '/trojan'
  ],
  recommendedPorts: [443, 80, 8443, 2053, 2083, 2087, 2096],
  avoidPorts: [1080, 8080, 8388, 9050, 10086]
};
