import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, ADMIN_E2E, DIFY_KEY } from '../constants.js';

/**
 * Admin interface (E4b.1, spec §9) against the development Keycloak realms (deploy/keycloak)
 * and a Postgres database reset on every run. Test users and passwords from
 * deploy/keycloak/README.md (development only).
 */
test.skip(!ADMIN_E2E, 'needs E2E_ADMIN=1 with Postgres, Redis and Keycloak running');
test.describe.configure({ mode: 'serial' });

interface User {
  org: string;
  username: string;
  password: string;
  broker?: boolean;
}
const user = (org: string, username: string, password: string, broker = false): User => ({
  org,
  username,
  password,
  broker,
});
const PILOT_ADMIN = user('pilot', 'pilot-admin', 'dev-pilot-admin-Pass1');
const PILOT_EDITOR = user('pilot', 'pilot-editor', 'dev-pilot-editor-Pass1');
const PILOT_VIEWER = user('pilot', 'pilot-viewer', 'dev-pilot-viewer-Pass1');
const DEMO_ADMIN = user('demo-primarie', 'demo-admin', 'dev-demo-admin-Pass1');
const PLATFORM = user('platform', 'platform-admin', 'dev-platform-admin-Pass1');
const ALICE = user('pilot', 'alice', 'dev-idp-alice-Pass1', true);
const CAROL = user('pilot', 'carol', 'dev-idp-carol-Pass1', true);

/** Signs in through the admin login page and the Keycloak form, like a person would. */
async function signIn(page: Page, who: User): Promise<void> {
  await page.goto(`${ADMIN}/admin/?org=${who.org}`);
  await page.getByRole('button', { name: 'Continuă spre autentificare' }).click();
  if (who.broker) {
    await page.getByRole('link', { name: 'Contul de serviciu (IdP simulat)' }).click();
  }
  await page.locator('#username').fill(who.username);
  await page.locator('#password').fill(who.password);
  await page.locator('#kc-login').click();
  await page.waitForURL(`${ADMIN}/admin/**`);
}

async function openEditor(page: Page, who: User): Promise<void> {
  await signIn(page, who);
  await expect(page.getByLabel('Numele clientului')).toBeVisible();
}

/** Calls the admin API from the page (session cookie + CSRF token), like the interface does. */
async function api(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const session = (await fetch('/admin/api/session').then((r) => r.json())) as {
        csrfToken: string;
      };
      const response = await fetch(path, {
        method,
        headers: {
          'x-csrf-token': session.csrfToken,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, text: await response.text() };
    },
    { method, path, body },
  );
}

const discardDraft = (page: Page, tenant: string) =>
  api(page, 'DELETE', `/admin/api/tenants/${tenant}/config/draft`);

const publicAccent = async (page: Page, tenant: string) =>
  (
    (await (await page.request.get(`${ADMIN}/api/loader-config?tenant=${tenant}`)).json()) as {
      theme: { accent: string };
    }
  ).theme.accent;

const status = (page: Page) => page.getByRole('status').filter({ hasText: /./ }).first();
const saved = (page: Page) => expect(status(page)).toHaveText(/^Ciornă salvată la/);
const color = (page: Page, label: string) => page.getByLabel(label, { exact: true });

test('a client administrator signs in to their own tenant and cannot reach another', async ({
  page,
}) => {
  await openEditor(page, PILOT_ADMIN);
  await expect(page.getByText('Client: pilot')).toBeVisible();
  await expect(page.getByText('(Administrator)')).toBeVisible();
  expect((await api(page, 'GET', '/admin/api/tenants/demo-primarie/config')).status).toBe(403);
  expect(
    (await api(page, 'PUT', '/admin/api/tenants/demo-primarie/config/draft', { config: {} }))
      .status,
  ).toBe(403);
});

test('a user of another client realm only reaches their own tenant', async ({ page }) => {
  await openEditor(page, DEMO_ADMIN);
  await expect(page.getByText('Client: demo-primarie')).toBeVisible();
  expect((await api(page, 'GET', '/admin/api/tenants/pilot/config')).status).toBe(403);
  expect((await api(page, 'POST', '/admin/api/tenants/pilot/config/publish', {})).status).toBe(403);
  // A bearer token (from any realm) is never accepted: only the admin session cookie.
  const bearer = await page.request.get(`${ADMIN}/admin/api/tenants/pilot/config`, {
    headers: { authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.e30.x', cookie: '' },
  });
  expect(bearer.status()).toBe(401);
});

test('users without a chatbot group are refused, with an explanation', async ({ page }) => {
  await signIn(page, PILOT_VIEWER);
  await expect(page).toHaveURL(/error=no_role/);
  await expect(page.getByRole('alert')).toContainText('nu face parte din grupurile');
  expect((await page.request.get(`${ADMIN}/admin/api/session`)).status()).toBe(401);
});

test('groups of the brokered identity provider map to roles', async ({ page, browser }) => {
  await openEditor(page, ALICE);
  await expect(page.getByText('(Administrator)')).toBeVisible();
  const other = await browser.newPage();
  try {
    await signIn(other, CAROL);
    await expect(other).toHaveURL(/error=no_role/);
  } finally {
    await other.close();
  }
});

test('the platform super-admin sees every tenant', async ({ page }) => {
  await openEditor(page, PLATFORM);
  const tenants = page.getByLabel('Client', { exact: true });
  await expect(tenants.locator('option')).toHaveText(['demo-primarie', 'pilot']);
  await tenants.selectOption('pilot');
  await expect(page.getByRole('heading', { level: 1, name: 'pilot' })).toBeVisible();
});

test('an editor saves the draft but cannot publish (visible reason)', async ({ page }) => {
  await openEditor(page, PILOT_EDITOR);
  await page.getByLabel('Numele clientului').fill('Pilot de la editor');
  await saved(page);
  const publish = page.getByRole('button', { name: 'Publică' });
  await expect(publish).toHaveAttribute('aria-disabled', 'true');
  await expect(
    page.getByText(/^Doar administratorii \(rolul widget-admin\) pot publica/),
  ).toBeVisible();
  expect((await api(page, 'POST', '/admin/api/tenants/pilot/config/publish', {})).status).toBe(403);
  // Images and allowed domains are for administrators too.
  await expect(page.getByText('Doar administratorii pot încărca imagini.').first()).toBeVisible();
  await expect(page.getByLabel('Domenii pe care funcționează widget-ul')).toHaveAttribute(
    'readonly',
    '',
  );
  expect((await discardDraft(page, 'pilot')).status).toBe(204);
});

test('changes show in the preview at once and publicly only after publishing', async ({ page }) => {
  await openEditor(page, PILOT_ADMIN);
  const previewConfig = page.waitForResponse(
    (r) => r.url().includes('/api/loader-config') && r.url().includes('--p-'),
  );
  await color(page, 'Culoare principală (antet, buton)').fill('#0b6e4f');
  await page.getByLabel('Poziție', { exact: true }).selectOption('bottom-left');
  await saved(page);
  await previewConfig;

  // Preview: the real widget with the draft (launcher color and side).
  const preview = page.frameLocator('iframe[title="Previzualizarea widget-ului cu ciorna"]');
  const launcher = preview.locator('[data-chat-widget^="pilot--p-"] .launcher');
  await expect(launcher).toHaveCSS('background-image', /rgb\(11, 110, 79\)/);
  // Public widget: unchanged until publishing.
  expect(await publicAccent(page, 'pilot')).toBe('#3a36d0');

  await page.getByRole('button', { name: 'Publică' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publicați modificările?' });
  await expect(dialog.getByRole('listitem')).toHaveText([
    'Buton de pornire',
    'Fereastră și culori',
  ]);
  await dialog.getByLabel('Comentariu (opțional)').fill('Culorile primăriei');
  await dialog.getByRole('button', { name: 'Publică acum' }).click();
  await expect(status(page)).toHaveText('Versiunea 2 a fost publicată.');
  // Hot reload (NOTIFY), no gateway restart.
  await expect.poll(() => publicAccent(page, 'pilot')).toBe('#0b6e4f');
});

test('a color pair below the AA contrast blocks publishing', async ({ page }) => {
  await openEditor(page, PILOT_ADMIN);
  const text = color(page, 'Text');
  await text.fill('#eeeeee');
  await expect(text).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(/Contrast 1\.\d+:1 față de „Fundal”/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publică' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(page.getByText(/^Corectați/)).toBeVisible();
  await saved(page);
  // The server refuses it as well.
  const refused = await api(page, 'POST', '/admin/api/tenants/pilot/config/publish', {});
  expect(refused.status).toBe(422);
  expect((await discardDraft(page, 'pilot')).status).toBe(204);
});

// 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test('images: SVG and fake images are refused next to the field, real ones previewed', async ({
  page,
}) => {
  await openEditor(page, PILOT_ADMIN);
  const logo = page.getByLabel('Logo', { exact: true });
  const field = page.locator('.image-field').filter({ has: logo });

  await logo.setInputFiles({
    name: 'logo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  });
  await expect(field.getByRole('alert')).toContainText('SVG nu este acceptat');
  await expect(logo).toHaveAttribute('aria-invalid', 'true');

  await logo.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('MZ') });
  await expect(field.getByRole('alert')).toContainText('nu este o imagine PNG');

  await logo.setInputFiles({ name: 'Stemă.png', mimeType: 'image/png', buffer: PNG });
  const thumbnail = field.getByRole('img', { name: 'Previzualizare: Logo' });
  await expect(thumbnail).toHaveAttribute(
    'src',
    /\/admin\/api\/tenants\/pilot\/assets\/stema-[0-9a-f]{12}\.png$/,
  );
  await expect.poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await expect(field.getByRole('alert')).toHaveCount(0);
  await saved(page);
  expect((await discardDraft(page, 'pilot')).status).toBe(204);
});

test('a save based on an outdated draft is refused with a clear message', async ({
  page,
  browser,
}) => {
  await openEditor(page, PILOT_ADMIN);
  const editor = await browser.newPage();
  try {
    await openEditor(editor, PILOT_EDITOR);
    // The editor saves first...
    await editor.getByLabel('Numele clientului').fill('Varianta editorului');
    await saved(editor);
    // ...then the administrator, who loaded the page before, saves on top of it.
    await page.getByLabel('Numele clientului').fill('Varianta administratorului');
    const alert = page
      .getByRole('alert')
      .filter({ hasText: 'Ciorna a fost modificată de altcineva' });
    await expect(alert).toContainText('a salvat ciorna la');
    await expect(alert).toContainText('nu au fost salvate');
    // Nothing was overwritten.
    const draft = JSON.parse((await api(page, 'GET', '/admin/api/tenants/pilot/config')).text) as {
      draft: { config: { name: string } };
    };
    expect(draft.draft.config.name).toBe('Varianta editorului');
    await alert.getByRole('button', { name: 'Încarcă ciorna actuală' }).click();
    await expect(page.getByLabel('Numele clientului')).toHaveValue('Varianta editorului');
  } finally {
    expect((await discardDraft(page, 'pilot')).status).toBe(204);
    await editor.close();
  }
});

test('an expired session loses nothing: sign in again and back to the form', async ({
  page,
  context,
}) => {
  await openEditor(page, PILOT_ADMIN);
  // The gateway session ends (expiry); the Keycloak single sign-on session remains.
  await context.clearCookies({ name: /^(__Secure-)?admin$/ });
  const viaKeycloak = page.waitForRequest(/\/realms\/pilot\/protocol\/openid-connect\/auth/);
  await page.getByLabel('Numele clientului').fill('Scris înainte de expirare');
  // The single sign-on session at Keycloak brings the browser straight back.
  await viaKeycloak;
  await page.waitForURL(`${ADMIN}/admin/?tenant=pilot`);
  await expect(page.getByText(/au fost restaurate/)).toBeVisible();
  await expect(page.getByLabel('Numele clientului')).toHaveValue('Scris înainte de expirare');
  await saved(page);
  expect((await discardDraft(page, 'pilot')).status).toBe(204);
});

test('the Dify key never appears in the admin interface traffic', async ({ page }) => {
  const bodies: { json: boolean; text: string }[] = [];
  page.on('response', (response) => {
    if (response.url().startsWith(ADMIN)) {
      const json = (response.headers()['content-type'] ?? '').includes('json');
      void response.text().then(
        (text) => bodies.push({ json, text }),
        () => undefined,
      );
    }
  });
  await openEditor(page, PILOT_ADMIN);
  const previewReloaded = page.waitForResponse(
    (r) => r.url().includes('/api/loader-config') && r.url().includes('--p-'),
  );
  await page.getByLabel('Numele clientului').fill('Pilot e2e (cheie)');
  await saved(page);
  await previewReloaded;
  // Every answer (pages, bundles, API): neither the key nor the variable that holds it.
  const all = bodies.map((body) => body.text).join('\n');
  expect(all.length).toBeGreaterThan(1000);
  expect(all).not.toContain(DIFY_KEY);
  expect(all).not.toContain('DIFY_API_KEY_E2E');
  // API answers: not even the Dify connection fields (server-managed, ADR 008).
  const api = bodies
    .filter((body) => body.json)
    .map((body) => body.text)
    .join('\n');
  expect(api).toContain('"published"');
  expect(api).not.toContain('difyApiKeyEnv');
  expect(api).not.toContain('difyBaseUrl');
  expect((await discardDraft(page, 'pilot')).status).toBe(204);
});

const serious = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );

test('no serious or critical axe violations on the login page', async ({ page }) => {
  await page.goto(`${ADMIN}/admin/`);
  await expect(page.getByRole('heading', { name: 'Autentificare' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'pilot' })).toBeVisible();
  expect(await serious(page)).toEqual([]);
});

test('no serious or critical axe violations in the editor', async ({ page }) => {
  await openEditor(page, PILOT_ADMIN);
  // The preview frame holds the public widget, axe-tested in its own specs (widget,
  // white-label). Injecting axe into the nested frames crashed Firefox in CI, so the frame is
  // removed before scanning the editor itself.
  await page.locator('.preview__frame').evaluate((frame) => {
    frame.remove();
  });
  expect(await serious(page)).toEqual([]);
});
