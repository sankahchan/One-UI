import { expect, test } from '@playwright/test';
import {
  API_BASE_URL,
  E2E_BYPASS_HEADERS,
  authHeaders,
  createAdminAuth,
  createInbound,
  createUser,
  safeDelete
} from './helpers/api';

test.describe('API contract smoke', () => {
  test.describe.configure({ mode: 'serial', retries: process.env.CI ? 1 : 0 });

  let token = '';
  let createdInboundId: number | null = null;
  let createdUserId: number | null = null;

  test.beforeAll(async ({ request }) => {
    const auth = await createAdminAuth(request);
    token = auth.token;
  });

  test.afterAll(async ({ request }) => {
    if (createdUserId) {
      await safeDelete(request, token, `${API_BASE_URL}/users/${createdUserId}`);
      createdUserId = null;
    }

    if (createdInboundId) {
      await safeDelete(request, token, `${API_BASE_URL}/inbounds/${createdInboundId}`);
      createdInboundId = null;
    }
  });

  test('GET /api/system/health returns healthy contract', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/system/health`, {
      headers: E2E_BYPASS_HEADERS
    });
    expect(response.ok()).toBeTruthy();

    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(typeof payload.message).toBe('string');
    expect(typeof payload.data?.status).toBe('string');
    expect(typeof payload.data?.timestamp).toBe('string');
  });

  test('POST /api/auth/login rejects invalid credentials', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/auth/login`, {
      headers: E2E_BYPASS_HEADERS,
      data: {
        username: 'invalid-admin',
        password: 'wrong-password'
      }
    });

    expect([400, 401]).toContain(response.status());
    const payload = await response.json();
    expect(payload.success).toBe(false);
    expect(typeof payload.error?.message).toBe('string');
  });

  test('authenticated contracts for users, inbounds, and system stats', async ({ request }) => {
    const [usersResponse, inboundsResponse, statsResponse] = await Promise.all([
      request.get(`${API_BASE_URL}/users`, { headers: authHeaders(token) }),
      request.get(`${API_BASE_URL}/inbounds`, { headers: authHeaders(token) }),
      request.get(`${API_BASE_URL}/system/stats`, { headers: authHeaders(token) })
    ]);

    expect(usersResponse.ok()).toBeTruthy();
    expect(inboundsResponse.ok()).toBeTruthy();
    expect(statsResponse.ok()).toBeTruthy();

    const usersPayload = await usersResponse.json();
    const inboundsPayload = await inboundsResponse.json();
    const statsPayload = await statsResponse.json();

    expect(usersPayload.success).toBe(true);
    expect(Array.isArray(usersPayload.data)).toBe(true);

    expect(inboundsPayload.success).toBe(true);
    expect(Array.isArray(inboundsPayload.data)).toBe(true);

    expect(statsPayload.success).toBe(true);
    expect(typeof statsPayload.data?.users).toBe('number');
    expect(typeof statsPayload.data?.inbounds).toBe('number');
  });

  test('create and read inbound/user contracts, then cleanup', async ({ request }) => {
    const inbound = await createInbound(request, token, {
      serverAddress: 'contract.example.com',
      wsPath: '/contract'
    });
    createdInboundId = inbound.id;

    const user = await createUser(request, token, [inbound.id], {
      dataLimit: 5,
      expiryDays: 14,
      note: 'API contract smoke user'
    });
    createdUserId = user.id;

    const [getUserResponse, subscriptionResponse] = await Promise.all([
      request.get(`${API_BASE_URL}/users/${createdUserId}`, {
        headers: authHeaders(token)
      }),
      request.get(`${API_BASE_URL}/users/${createdUserId}/subscription`, {
        headers: authHeaders(token)
      })
    ]);

    expect(getUserResponse.ok()).toBeTruthy();
    expect(subscriptionResponse.ok()).toBeTruthy();

    const getUserPayload = await getUserResponse.json();
    const subscriptionPayload = await subscriptionResponse.json();

    expect(getUserPayload.success).toBe(true);
    expect(Number(getUserPayload?.data?.id)).toBe(createdUserId);

    expect(subscriptionPayload.success).toBe(true);
    expect(typeof subscriptionPayload?.data?.token).toBe('string');
    expect(typeof subscriptionPayload?.data?.urls?.v2ray).toBe('string');

    await safeDelete(request, token, `${API_BASE_URL}/users/${createdUserId}`);
    createdUserId = null;
    await safeDelete(request, token, `${API_BASE_URL}/inbounds/${createdInboundId}`);
    createdInboundId = null;
  });
});
