import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const API_BASE_URL = process.env.E2E_API_URL || 'http://127.0.0.1:3000/api';
const E2E_BYPASS_HEADER_NAME = 'x-oneui-e2e-bypass';
const E2E_BYPASS_HEADERS = {
  [E2E_BYPASS_HEADER_NAME]: '1'
};

interface AdminAuthSession {
  token: string;
  refreshToken: string | null;
  admin: {
    id: number;
    username: string;
    role: string;
    email?: string;
  };
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

function createAccessToken(secret: string, admin: { id: number; username: string; role: string }) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    id: admin.id,
    username: admin.username,
    role: admin.role,
    type: 'access',
    iat: issuedAt,
    exp: issuedAt + 60 * 60
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

function createAdminSession(): AdminAuthSession {
  const jwtSecret = readJwtSecret();
  const admin = {
    id: Number.parseInt(process.env.E2E_ADMIN_ID || '1', 10),
    username: process.env.E2E_ADMIN_USERNAME || 'admin',
    role: process.env.E2E_ADMIN_ROLE || 'SUPER_ADMIN',
    email: process.env.E2E_ADMIN_EMAIL || 'admin@example.com'
  };
  const token = createAccessToken(jwtSecret, admin);

  return {
    token,
    refreshToken: null,
    admin
  } satisfies AdminAuthSession;
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    ...E2E_BYPASS_HEADERS
  };
}

async function cleanupGroupsArtifacts(request: APIRequestContext, token: string, prefix: string) {
  const headers = authHeaders(token);

  const schedulesResponse = await request.get(`${API_BASE_URL}/groups/policy-schedules`, {
    headers,
    params: { search: prefix, limit: 100 }
  });
  if (schedulesResponse.ok()) {
    const payload = await schedulesResponse.json();
    const schedules = Array.isArray(payload?.data) ? payload.data : [];
    for (const schedule of schedules) {
      const id = Number(schedule?.id);
      if (Number.isInteger(id) && id > 0) {
        await request.delete(`${API_BASE_URL}/groups/policy-schedules/${id}`, { headers });
      }
    }
  }

  const templatesResponse = await request.get(`${API_BASE_URL}/groups/templates`, {
    headers,
    params: { search: prefix, limit: 100 }
  });
  if (templatesResponse.ok()) {
    const payload = await templatesResponse.json();
    const templates = Array.isArray(payload?.data) ? payload.data : [];
    for (const template of templates) {
      const id = Number(template?.id);
      if (Number.isInteger(id) && id > 0) {
        await request.delete(`${API_BASE_URL}/groups/templates/${id}`, { headers });
      }
    }
  }

  const groupsResponse = await request.get(`${API_BASE_URL}/groups`, {
    headers,
    params: { search: prefix, limit: 100, includeDisabled: true }
  });
  if (groupsResponse.ok()) {
    const payload = await groupsResponse.json();
    const groups = Array.isArray(payload?.data) ? payload.data : [];
    for (const group of groups) {
      const id = Number(group?.id);
      if (Number.isInteger(id) && id > 0) {
        await request.delete(`${API_BASE_URL}/groups/${id}`, { headers });
      }
    }
  }
}

async function createInbound(request: APIRequestContext, token: string) {
  const randomPortResponse = await request.get(`${API_BASE_URL}/inbounds/random-port`, {
    headers: authHeaders(token)
  });

  expect(randomPortResponse.ok()).toBeTruthy();
  const randomPortPayload = await randomPortResponse.json();
  const port = Number(randomPortPayload?.data?.port);

  expect(Number.isInteger(port)).toBeTruthy();

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const createResponse = await request.post(`${API_BASE_URL}/inbounds`, {
    headers: authHeaders(token),
    data: {
      port,
      protocol: 'VLESS',
      tag: `e2e-vless-${suffix}`,
      remark: `e2e-inbound-${suffix}`,
      network: 'WS',
      security: 'NONE',
      serverAddress: 'e2e.example.com',
      wsPath: '/ws'
    }
  });

  expect(createResponse.ok()).toBeTruthy();
  const createPayload = await createResponse.json();

  return {
    id: Number(createPayload?.data?.id),
    tag: String(createPayload?.data?.tag || ''),
    remark: String(createPayload?.data?.remark || ''),
    port
  };
}

async function createUser(request: APIRequestContext, token: string, inboundId: number) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const email = `e2e-user-${suffix}@example.com`;

  const response = await request.post(`${API_BASE_URL}/users`, {
    headers: authHeaders(token),
    data: {
      email,
      dataLimit: 10,
      expiryDays: 20,
      inboundIds: [inboundId],
      note: 'e2e smoke user'
    }
  });

  expect(response.ok()).toBeTruthy();
  const payload = await response.json();

  return {
    id: Number(payload?.data?.id),
    email
  };
}

async function deleteUser(request: APIRequestContext, token: string, userId: number | undefined) {
  if (!userId) {
    return;
  }

  try {
    await request.delete(`${API_BASE_URL}/users/${userId}`, {
      headers: authHeaders(token)
    });
  } catch {
    // context may already be closed during teardown
  }
}

async function deleteInbound(request: APIRequestContext, token: string, inboundId: number | undefined) {
  if (!inboundId) {
    return;
  }

  try {
    await request.delete(`${API_BASE_URL}/inbounds/${inboundId}`, {
      headers: authHeaders(token)
    });
  } catch {
    // context may already be closed during teardown
  }
}

async function loginUi(page: Page, session: AdminAuthSession) {
  await page.context().setExtraHTTPHeaders(E2E_BYPASS_HEADERS);
  await page.goto('/login');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.evaluate((authSession) => {
    localStorage.setItem('auth-storage', JSON.stringify({
      state: {
        token: authSession.token,
        refreshToken: authSession.refreshToken,
        admin: authSession.admin,
        isAuthenticated: true
      },
      version: 0
    }));
  }, session);

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

test.describe('One-UI smoke flows', () => {
  let adminSession: AdminAuthSession;

  test.beforeAll(async () => {
    adminSession = createAdminSession();
  });

  test('login and create inbound from UI', async ({ page }) => {
    await loginUi(page, adminSession);

    await page.goto('/inbounds');
    await expect(page.getByRole('heading', { name: 'Inbounds' })).toBeVisible();

    await page.getByRole('button', { name: 'Add Inbound' }).first().click();
    await expect(page.getByRole('heading', { name: 'Add New Inbound' })).toBeVisible();

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const uniqueTag = `e2e-ui-${suffix}`;
    const uniqueRemark = `E2E UI ${suffix}`;

    await page.getByPlaceholder('vless-ws-tls').fill(uniqueTag);
    await page.getByPlaceholder('My VLESS Inbound').fill(uniqueRemark);
    await page.getByPlaceholder('your.domain.com or IP').fill('e2e-ui.example.com');
    await page.getByRole('button', { name: 'Random Free Port' }).click();
    await page.getByRole('button', { name: 'Create Inbound' }).click();

    await expect(page.getByRole('heading', { name: 'Add New Inbound' })).toBeHidden();
    await page.getByRole('button', { name: 'Inbounds' }).first().click();
    await expect(page.locator('table').locator(`text=${uniqueTag}`).first()).toBeVisible();
  });

  test('users list quick QR and quick edit', async ({ page, request }) => {
    const inbound = await createInbound(request, adminSession.token);
    const user = await createUser(request, adminSession.token, inbound.id);

    try {
      await loginUi(page, adminSession);

      await page.goto('/users');
      await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();

      await page.getByPlaceholder(/Search by email or UUID/i).fill(user.email);
      await page.getByRole('button', { name: 'Refresh' }).click();

      const row = page.locator('tbody tr', { hasText: user.email }).first();
      await expect(row).toBeVisible();
      await expect(row.getByText(/Online|Offline/i)).toBeVisible();
      await expect(page.getByText(/Session stream:/i)).toBeVisible();

      await row.getByLabel('More actions').click();
      await page.getByRole('button', { name: 'Show QR' }).first().click();
      await expect(page.getByRole('heading', { name: 'Quick QR' })).toBeVisible();
      await expect(page.getByText('/sub/')).toBeVisible();
      await page.locator('button[aria-label="Close"]').first().click();
      await expect(page.getByRole('heading', { name: 'Quick QR' })).toBeHidden();

      await row.getByLabel('More actions').click();
      await page.getByRole('button', { name: 'Quick Edit' }).first().click();
      await expect(page.getByRole('heading', { name: 'Quick Edit' })).toBeVisible();

      const date = new Date();
      date.setDate(date.getDate() + 15);
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const isoDate = `${yyyy}-${mm}-${dd}`;

      await page.locator('input[name="dataLimitGb"]').fill('15');
      await page.locator('input[name="expireDate"]').fill(isoDate);
      await page.getByRole('button', { name: 'Save Changes' }).click();

      await expect(page.getByRole('heading', { name: 'Quick Edit' })).toBeHidden();
      await expect(page.locator('tbody tr', { hasText: user.email }).first()).toContainText('15 GB');
    } finally {
      await deleteUser(request, adminSession.token, user.id);
      await deleteInbound(request, adminSession.token, inbound.id);
    }
  });

  test('groups templates schedules and rollouts tabs', async ({ page, request }) => {
    const prefix = `e2e-groups-${Date.now()}`;
    const suitePrefix = 'e2e-groups-';
    const groupName = `${prefix}-group`;
    const templateName = `${prefix}-template`;
    const scheduleName = `${prefix}-schedule`;

    try {
      await cleanupGroupsArtifacts(request, adminSession.token, suitePrefix);

      await loginUi(page, adminSession);
      await page.goto('/groups');
      await expect(page.getByRole('heading', { name: 'Groups', exact: true })).toBeVisible();

      await page.getByRole('button', { name: 'New Group' }).click();
      await page.getByPlaceholder('Premium users').fill(groupName);
      await page.getByRole('button', { name: 'Create Group' }).click();
      await expect(page.getByText(groupName).first()).toBeVisible();

      await page.getByRole('button', { name: /Templates/i }).first().click();
      await page.getByRole('button', { name: 'New Template' }).click();
      await page.getByPlaceholder('Monthly 50GB Standard').fill(templateName);
      await page.getByRole('button', { name: 'Create Template' }).click();
      await expect(page.getByText(templateName).first()).toBeVisible();
      await page.getByPlaceholder('Search templates by name or description').fill(templateName);
      const templateHeading = page.getByRole('heading', { name: templateName, exact: true }).first();
      await expect(templateHeading).toBeVisible();
      const applyButton = page.getByRole('button', { name: 'Apply to Group' }).first();
      await expect(applyButton).toBeVisible();
      await applyButton.click();
      const applyModal = page.locator('.glass-panel').filter({ hasText: 'Apply Template:' }).first();
      await expect(applyModal).toBeVisible();
      await applyModal.locator('select').first().selectOption({ label: groupName });
      const applyResponsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/groups/')
        && response.url().includes('/policy/template')
        && response.request().method() === 'POST'
      ));
      await applyModal.getByRole('button', { name: 'Apply Template' }).click();
      const applyResponse = await applyResponsePromise;
      expect(applyResponse.ok()).toBeTruthy();
      await expect(applyModal).toBeHidden({ timeout: 15_000 });

      await page.getByRole('button', { name: /Schedules/i }).first().click();
      await page.getByRole('button', { name: 'New Schedule' }).click();
      const scheduleModal = page.locator('.glass-panel').filter({ hasText: 'Create Policy Schedule' }).first();
      await expect(scheduleModal).toBeVisible();
      await scheduleModal.getByPlaceholder('Nightly premium sync').fill(scheduleName);
      await scheduleModal.locator('select').nth(0).selectOption({ label: groupName });
      await scheduleModal.locator('select').nth(1).selectOption({ label: templateName });
      await scheduleModal.getByRole('button', { name: 'Create Schedule' }).click();
      await expect(scheduleModal).toBeHidden();
      await expect(page.getByText(scheduleName).first()).toBeVisible();

      await page.getByRole('button', { name: /Rollouts/i }).first().click();
      await expect(page.getByText(/No rollout history|Summary|Status/i).first()).toBeVisible();
    } finally {
      await cleanupGroupsArtifacts(request, adminSession.token, prefix);
    }
  });

  test('settings notifications tab and dispatch test', async ({ page }) => {
    await loginUi(page, adminSession);

    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    await page.getByRole('button', { name: 'Notifications' }).click();
    await expect(page.getByRole('heading', { name: 'Notification Channels' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Send Test Notification' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Notification Audit History' })).toBeVisible();

    await page.getByPlaceholder('system.notification.test').fill('system.notification.test');
    await page.getByRole('button', { name: 'Dispatch Test' }).click();
    await expect(page.getByRole('heading', { name: 'Send Test Notification' })).toBeVisible();
  });

  test('desktop and mobile navigation buttons are clickable', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await loginUi(page, adminSession);

    const sidebar = page.locator('aside').first();
    await sidebar.getByRole('button', { name: /Users/i }).click();
    await expect(page).toHaveURL(/\/users/);

    await sidebar.getByRole('button', { name: /Inbounds/i }).click();
    await expect(page).toHaveURL(/\/inbounds/);

    await sidebar.getByRole('button', { name: /Settings/i }).click();
    await expect(page).toHaveURL(/\/settings/);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard');
    const mobileNav = page.locator('nav').last();

    await mobileNav.getByRole('button', { name: /Users/i }).click();
    await expect(page).toHaveURL(/\/users/);

    await mobileNav.getByRole('button', { name: /Inbounds/i }).click();
    await expect(page).toHaveURL(/\/inbounds/);

    await mobileNav.getByRole('button', { name: /Dashboard/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('users row buttons open detail and quick QR without reload', async ({ page, request }) => {
    const inbound = await createInbound(request, adminSession.token);
    const user = await createUser(request, adminSession.token, inbound.id);

    try {
      await loginUi(page, adminSession);
      await page.goto('/users');

      await page.getByPlaceholder(/Search by email or UUID/i).fill(user.email);
      await page.getByRole('button', { name: 'Refresh' }).click();

      const row = page.locator('tbody tr', { hasText: user.email }).first();
      await expect(row).toBeVisible();

      await row.getByRole('button', { name: user.email }).click();
      await expect(page).toHaveURL(new RegExp(`/users/${user.id}$`));

      await page.goto('/users');
      await page.getByPlaceholder(/Search by email or UUID/i).fill(user.email);
      await page.getByRole('button', { name: 'Refresh' }).click();

      const rowAfterBack = page.locator('tbody tr', { hasText: user.email }).first();
      await rowAfterBack.getByLabel('More actions').click();
      await page.getByRole('button', { name: 'Show QR' }).first().click();
      await expect(page.getByRole('heading', { name: 'Quick QR' })).toBeVisible();
    } finally {
      await deleteUser(request, adminSession.token, user.id);
      await deleteInbound(request, adminSession.token, inbound.id);
    }
  });
});
