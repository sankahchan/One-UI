import { expect, test } from '@playwright/test';
import {
  API_BASE_URL,
  E2E_BYPASS_HEADERS,
  authHeaders,
  createAdminAuth,
  createInbound,
  createUser,
  safeDelete,
  uniqueSuffix
} from './helpers/api';

test.describe('Critical flows smoke', () => {
  test.describe.configure({ mode: 'serial', retries: process.env.CI ? 1 : 0 });

  let auth: Awaited<ReturnType<typeof createAdminAuth>>;
  const cleanupUserIds: number[] = [];
  const cleanupInboundIds: number[] = [];

  test.beforeAll(async ({ request }) => {
    auth = await createAdminAuth(request);
  });

  test.afterAll(async ({ request }) => {
    const userIds = Array.from(new Set(cleanupUserIds.filter((value) => Number.isInteger(value) && value > 0)));
    const inboundIds = Array.from(new Set(cleanupInboundIds.filter((value) => Number.isInteger(value) && value > 0)));

    for (const userId of userIds) {
      await safeDelete(request, auth.token, `${API_BASE_URL}/users/${userId}`);
    }

    for (const inboundId of inboundIds) {
      await safeDelete(request, auth.token, `${API_BASE_URL}/inbounds/${inboundId}`);
    }
  });

  test('Myanmar resilience pack can be assigned to selected users', async ({ request }) => {
    const baseInbound = await createInbound(request, auth.token, {
      security: 'TLS',
      serverName: 'mm-base.example.com',
      serverAddress: 'mm-base.example.com'
    });
    cleanupInboundIds.push(baseInbound.id);

    const user = await createUser(request, auth.token, [baseInbound.id], {
      note: 'critical-flow-myanmar-pack'
    });
    cleanupUserIds.push(user.id);

    const previewResponse = await request.post(`${API_BASE_URL}/inbounds/presets/myanmar`, {
      headers: authHeaders(auth.token),
      data: {
        serverAddress: 'mm-pack.example.com',
        serverName: 'mm-pack.example.com',
        cdnHost: 'cdn-mm-pack.example.com',
        fallbackPorts: [8443, 9443],
        userIds: [user.id],
        dryRun: true
      }
    });
    expect(previewResponse.ok()).toBeTruthy();
    const previewPayload = await previewResponse.json();
    expect(previewPayload.success).toBe(true);
    expect(Array.isArray(previewPayload?.data?.planned)).toBe(true);
    expect(previewPayload?.data?.planned?.length).toBe(3);

    const applyResponse = await request.post(`${API_BASE_URL}/inbounds/presets/myanmar`, {
      headers: authHeaders(auth.token),
      data: {
        serverAddress: 'mm-pack.example.com',
        serverName: 'mm-pack.example.com',
        cdnHost: 'cdn-mm-pack.example.com',
        fallbackPorts: [8443, 9443],
        userIds: [user.id]
      }
    });
    expect(applyResponse.status()).toBe(201);
    const applyPayload = await applyResponse.json();
    expect(applyPayload.success).toBe(true);
    expect(Array.isArray(applyPayload?.data?.created)).toBe(true);
    expect(applyPayload?.data?.created?.length).toBe(3);
    expect(Number(applyPayload?.data?.assignment?.assignedUsers)).toBe(1);

    const createdInboundIds = (applyPayload?.data?.created || [])
      .map((entry: { id: number }) => Number(entry.id))
      .filter((value: number) => Number.isInteger(value) && value > 0);
    cleanupInboundIds.push(...createdInboundIds);

    await expect.poll(async () => {
      const userResponse = await request.get(`${API_BASE_URL}/users/${user.id}`, {
        headers: authHeaders(auth.token)
      });
      if (!userResponse.ok()) {
        return 0;
      }
      const userPayload = await userResponse.json();
      const relations = Array.isArray(userPayload?.data?.inbounds) ? userPayload.data.inbounds : [];
      const relationInboundIds = relations.map((relation: { inboundId: number }) => Number(relation.inboundId));
      return createdInboundIds.filter((id: number) => relationInboundIds.includes(id)).length;
    }, { timeout: 12_000, interval: 500 }).toBe(createdInboundIds.length);
  });

  test('Admin can reorder user inbound priorities deterministically', async ({ request }) => {
    const inboundA = await createInbound(request, auth.token, { tag: `e2e-a-${uniqueSuffix()}` });
    const inboundB = await createInbound(request, auth.token, { tag: `e2e-b-${uniqueSuffix()}` });
    const inboundC = await createInbound(request, auth.token, { tag: `e2e-c-${uniqueSuffix()}` });
    cleanupInboundIds.push(inboundA.id, inboundB.id, inboundC.id);

    const user = await createUser(request, auth.token, [inboundA.id, inboundB.id, inboundC.id], {
      note: 'critical-flow-priority'
    });
    cleanupUserIds.push(user.id);

    const previewResponse = await request.post(`${API_BASE_URL}/users/${user.id}/inbounds/reorder-pattern/preview`, {
      headers: authHeaders(auth.token),
      data: {
        pattern: 'myanmar'
      }
    });
    expect(previewResponse.ok()).toBeTruthy();
    const previewPayload = await previewResponse.json();
    expect(previewPayload.success).toBe(true);

    const reorderResponse = await request.post(`${API_BASE_URL}/users/${user.id}/inbounds/reorder`, {
      headers: authHeaders(auth.token),
      data: {
        assignments: [
          { inboundId: inboundC.id, priority: 100, enabled: true },
          { inboundId: inboundA.id, priority: 110, enabled: true },
          { inboundId: inboundB.id, priority: 120, enabled: true }
        ]
      }
    });
    expect(reorderResponse.ok()).toBeTruthy();
    const reorderPayload = await reorderResponse.json();
    expect(reorderPayload.success).toBe(true);

    const getUserResponse = await request.get(`${API_BASE_URL}/users/${user.id}`, {
      headers: authHeaders(auth.token)
    });
    expect(getUserResponse.ok()).toBeTruthy();
    const userPayload = await getUserResponse.json();
    const relations = Array.isArray(userPayload?.data?.inbounds) ? userPayload.data.inbounds : [];
    const priorityByInbound = new Map<number, number>(
      relations.map((relation: { inboundId: number; priority: number }) => [
        Number(relation.inboundId),
        Number(relation.priority)
      ])
    );

    expect(priorityByInbound.get(inboundC.id)).toBe(100);
    expect(priorityByInbound.get(inboundA.id)).toBe(110);
    expect(priorityByInbound.get(inboundB.id)).toBe(120);
  });

  test('Xray update control-plane endpoints return valid contracts', async ({ request }) => {
    const [policyResponse, preflightResponse, historyResponse, backupsResponse] = await Promise.all([
      request.get(`${API_BASE_URL}/xray/update/policy`, {
        headers: authHeaders(auth.token)
      }),
      request.get(`${API_BASE_URL}/xray/update/preflight`, {
        headers: authHeaders(auth.token)
      }),
      request.get(`${API_BASE_URL}/xray/update/history?page=1&limit=5`, {
        headers: authHeaders(auth.token)
      }),
      request.get(`${API_BASE_URL}/xray/update/backups`, {
        headers: authHeaders(auth.token)
      })
    ]);

    expect(policyResponse.ok()).toBeTruthy();
    expect(preflightResponse.ok()).toBeTruthy();
    expect(historyResponse.ok()).toBeTruthy();
    expect(backupsResponse.ok()).toBeTruthy();

    const policyPayload = await policyResponse.json();
    const preflightPayload = await preflightResponse.json();
    const historyPayload = await historyResponse.json();
    const backupsPayload = await backupsResponse.json();

    expect(policyPayload.success).toBe(true);
    expect(typeof policyPayload?.data?.mode).toBe('string');
    expect(typeof policyPayload?.data?.updatesEnabled).toBe('boolean');

    expect(preflightPayload.success).toBe(true);
    expect(Array.isArray(preflightPayload?.data?.checks)).toBe(true);

    expect(historyPayload.success).toBe(true);
    expect(Array.isArray(historyPayload?.data)).toBe(true);

    expect(backupsPayload.success).toBe(true);
    expect(Array.isArray(backupsPayload?.data)).toBe(true);
  });

  test('Admin username/password change can rotate and roll back safely', async ({ request }) => {
    test.skip(!auth.usedPasswordLogin, 'This flow requires password-login credentials (E2E_ADMIN_USERNAME/PASSWORD).');

    const meResponse = await request.get(`${API_BASE_URL}/auth/me`, {
      headers: authHeaders(auth.token)
    });
    expect(meResponse.ok()).toBeTruthy();
    const mePayload = await meResponse.json();
    const originalUsername = String(mePayload?.data?.username || auth.username || 'admin');
    const originalPassword = String(auth.password || process.env.E2E_ADMIN_PASSWORD || 'admin123');

    const tempUsername = `adm${Date.now().toString().slice(-7)}`;
    const tempPassword = 'TempPass1234';

    const updateResponse = await request.put(`${API_BASE_URL}/auth/profile`, {
      headers: authHeaders(auth.token),
      data: {
        currentPassword: originalPassword,
        username: tempUsername,
        newPassword: tempPassword,
        confirmPassword: tempPassword
      }
    });
    expect(updateResponse.ok()).toBeTruthy();
    const updatePayload = await updateResponse.json();
    expect(updatePayload.success).toBe(true);

    const loginWithTempResponse = await request.post(`${API_BASE_URL}/auth/login`, {
      headers: E2E_BYPASS_HEADERS,
      data: {
        username: tempUsername,
        password: tempPassword
      }
    });
    expect(loginWithTempResponse.ok()).toBeTruthy();
    const tempLoginPayload = await loginWithTempResponse.json();
    const tempToken = String(tempLoginPayload?.data?.token || '');
    expect(tempToken.length).toBeGreaterThan(20);

    const rollbackResponse = await request.put(`${API_BASE_URL}/auth/profile`, {
      headers: authHeaders(tempToken),
      data: {
        currentPassword: tempPassword,
        username: originalUsername,
        newPassword: originalPassword,
        confirmPassword: originalPassword
      }
    });
    expect(rollbackResponse.ok()).toBeTruthy();
    const rollbackPayload = await rollbackResponse.json();
    expect(rollbackPayload.success).toBe(true);

    const loginWithOriginalResponse = await request.post(`${API_BASE_URL}/auth/login`, {
      headers: E2E_BYPASS_HEADERS,
      data: {
        username: originalUsername,
        password: originalPassword
      }
    });
    expect(loginWithOriginalResponse.ok()).toBeTruthy();
    const finalLoginPayload = await loginWithOriginalResponse.json();
    const finalToken = String(finalLoginPayload?.data?.token || '');
    expect(finalToken.length).toBeGreaterThan(20);
    auth = {
      ...auth,
      token: finalToken,
      username: originalUsername,
      password: originalPassword,
      usedPasswordLogin: true
    };
  });
});
