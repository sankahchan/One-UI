import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { APIRequestContext } from '@playwright/test';

export const API_BASE_URL = process.env.E2E_API_URL || 'http://127.0.0.1:3000/api';
export const E2E_BYPASS_HEADER_NAME = 'x-oneui-e2e-bypass';
export const E2E_BYPASS_HEADERS = {
  [E2E_BYPASS_HEADER_NAME]: '1'
};

interface PasswordLoginResult {
  token: string;
  username: string;
  password: string;
  usedPasswordLogin: boolean;
}

function base64UrlEncode(input: string) {
  return Buffer.from(input).toString('base64url');
}

function readJwtSecret() {
  if (process.env.E2E_JWT_SECRET) {
    return process.env.E2E_JWT_SECRET;
  }

  const envPath = path.resolve(process.cwd(), '../backend/.env');
  const raw = readFileSync(envPath, 'utf8');
  const line = raw
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('JWT_SECRET='));
  const value = line ? line.slice('JWT_SECRET='.length).trim() : '';

  if (!value) {
    throw new Error('JWT_SECRET not found. Set E2E_JWT_SECRET or define JWT_SECRET in backend/.env.');
  }

  return value;
}

function createFallbackAccessToken() {
  const jwtSecret = readJwtSecret();
  const header = { alg: 'HS256', typ: 'JWT' };
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    id: Number.parseInt(process.env.E2E_ADMIN_ID || '1', 10),
    username: process.env.E2E_ADMIN_USERNAME || 'admin',
    role: process.env.E2E_ADMIN_ROLE || 'SUPER_ADMIN',
    type: 'access',
    iat: issuedAt,
    exp: issuedAt + (60 * 60)
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', jwtSecret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

async function tryPasswordLogin(request: APIRequestContext): Promise<PasswordLoginResult | null> {
  const username = process.env.E2E_ADMIN_USERNAME || 'admin';
  const password = process.env.E2E_ADMIN_PASSWORD || 'admin123';

  const response = await request.post(`${API_BASE_URL}/auth/login`, {
    headers: E2E_BYPASS_HEADERS,
    data: {
      username,
      password
    }
  });

  if (!response.ok()) {
    return null;
  }

  const payload = await response.json();
  const token = payload?.data?.token;
  if (typeof token !== 'string' || token.length < 20) {
    return null;
  }

  return {
    token,
    username,
    password,
    usedPasswordLogin: true
  };
}

export async function createAdminAuth(request: APIRequestContext) {
  const login = await tryPasswordLogin(request);
  if (login) {
    return login;
  }

  return {
    token: createFallbackAccessToken(),
    username: process.env.E2E_ADMIN_USERNAME || 'admin',
    password: process.env.E2E_ADMIN_PASSWORD || 'admin123',
    usedPasswordLogin: false
  };
}

export function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    ...E2E_BYPASS_HEADERS
  };
}

export function uniqueSuffix(prefix = 'e2e') {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export async function safeDelete(request: APIRequestContext, token: string, url: string) {
  await request.delete(url, { headers: authHeaders(token) });
}

export async function createInbound(
  request: APIRequestContext,
  token: string,
  overrides: Record<string, unknown> = {}
) {
  const randomPortResponse = await request.get(`${API_BASE_URL}/inbounds/random-port`, {
    headers: authHeaders(token)
  });
  if (!randomPortResponse.ok()) {
    throw new Error('Failed to get random port');
  }
  const randomPortPayload = await randomPortResponse.json();
  const port = Number(randomPortPayload?.data?.port);
  if (!Number.isInteger(port)) {
    throw new Error('Random port response was invalid');
  }

  const suffix = uniqueSuffix('inbound');
  const createResponse = await request.post(`${API_BASE_URL}/inbounds`, {
    headers: authHeaders(token),
    data: {
      port,
      protocol: 'VLESS',
      tag: `e2e-${suffix}`,
      remark: `e2e-${suffix}`,
      network: 'WS',
      security: 'NONE',
      serverAddress: 'e2e.example.com',
      wsPath: '/ws',
      ...overrides
    }
  });

  if (!createResponse.ok()) {
    const payload = await createResponse.json().catch(() => ({}));
    throw new Error(`Failed to create inbound (${createResponse.status()}): ${JSON.stringify(payload)}`);
  }

  const createPayload = await createResponse.json();
  return {
    id: Number(createPayload?.data?.id),
    port: Number(createPayload?.data?.port),
    tag: String(createPayload?.data?.tag || ''),
    remark: String(createPayload?.data?.remark || '')
  };
}

export async function createUser(
  request: APIRequestContext,
  token: string,
  inboundIds: number[],
  overrides: Record<string, unknown> = {}
) {
  const suffix = uniqueSuffix('user');
  const response = await request.post(`${API_BASE_URL}/users`, {
    headers: authHeaders(token),
    data: {
      email: `${suffix}@example.com`,
      dataLimit: 10,
      expiryDays: 20,
      inboundIds,
      note: 'e2e generated user',
      ...overrides
    }
  });

  if (!response.ok()) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(`Failed to create user (${response.status()}): ${JSON.stringify(payload)}`);
  }

  const payload = await response.json();
  return {
    id: Number(payload?.data?.id),
    email: String(payload?.data?.email || '')
  };
}
