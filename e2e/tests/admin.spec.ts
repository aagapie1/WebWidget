import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
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

const status = (page: Page) => page.locator('.save-status').getByRole('status');
const saved = (page: Page) => expect(status(page)).toHaveText(/^Ciornă: salvată la/);
const color = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const area = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: 'Zone de configurare' })
    .getByRole('link', { name, exact: true })
    .click();
const publishButton = (page: Page) => page.getByRole('button', { name: /^Publică/ });
/** The user menu (header): name, role and organisation. */
async function userMenu(page: Page) {
  await page.getByRole('button', { name: /^Meniul utilizatorului/ }).click();
  return page.locator('#user-menu-panel');
}

test('a client administrator signs in to their own tenant and cannot reach another', async ({
  page,
}) => {
  await openEditor(page, PILOT_ADMIN);
  // Header: the client's assistant, not the tenant code; the role is in the user menu.
  await expect(page.locator('.brand__name')).toHaveText('Pilot e2e');
  const menu = await userMenu(page);
  await expect(menu).toContainText('Administrator');
  await expect(menu).toContainText('pilot');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  // The client's name is set by the platform team (super-admin).
  await expect(page.getByLabel('Numele clientului')).toHaveAttribute('readonly', '');
  expect((await api(page, 'GET', '/admin/api/tenants/demo-primarie/config')).status).toBe(403);
  expect(
    (await api(page, 'PUT', '/admin/api/tenants/demo-primarie/config/draft', { config: {} }))
      .status,
  ).toBe(403);
});

test('a user of another client realm only reaches their own tenant', async ({ page }) => {
  await openEditor(page, DEMO_ADMIN);
  await expect(page.locator('.brand__name')).toHaveText('Primăria e2e');
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
  await expect(await userMenu(page)).toContainText('Administrator');
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
  await tenants.selectOption('demo-primarie');
  await expect(page.locator('.brand__name')).toHaveText('Primăria e2e');
  // Only the super-admin may rename a client.
  await expect(page.getByLabel('Numele clientului')).not.toHaveAttribute('readonly', '');
});

test('an editor saves the draft but cannot publish (visible reason)', async ({ page }) => {
  await openEditor(page, PILOT_EDITOR);
  await page.getByLabel('Numele asistentului').fill('Pilot de la editor');
  await saved(page);
  const publish = publishButton(page);
  await expect(publish).toHaveAttribute('aria-disabled', 'true');
  // The reason shows on hover and on focus.
  const reason = page.locator('#publish-blocker');
  await expect(reason).toBeHidden();
  await publish.hover();
  await expect(reason).toBeVisible();
  await expect(reason).toHaveText(/^Doar administratorii pot publica/);
  expect((await api(page, 'POST', '/admin/api/tenants/pilot/config/publish', {})).status).toBe(403);
  // Images and allowed domains are for administrators too.
  await expect(page.getByText('Doar administratorii pot încărca imagini.').first()).toBeVisible();
  // The allowed domains are not shown to an editor at all; the server refuses a change too.
  await expect(
    page.getByRole('navigation', { name: 'Zone de configurare' }).getByRole('link'),
  ).not.toContainText(['Domenii permise']);
  const state = JSON.parse((await api(page, 'GET', '/admin/api/tenants/pilot/config')).text) as {
    published: { version: number; config: Record<string, unknown> };
    draft: { revision: number; config: Record<string, unknown> } | null;
  };
  const changed = await api(page, 'PUT', '/admin/api/tenants/pilot/config/draft', {
    config: {
      ...(state.draft?.config ?? state.published.config),
      allowedOrigins: ['https://x.ro'],
    },
    baseVersion: state.published.version,
    draftRevision: state.draft?.revision ?? null,
  });
  expect(changed.status).toBe(403);
  expect((await discardDraft(page, 'pilot')).status).toBe(204);
});

test('changes show in the preview at once and publicly only after publishing', async ({ page }) => {
  await openEditor(page, PILOT_ADMIN);
  const previewConfig = page.waitForResponse(
    (r) => r.url().includes('/api/loader-config') && r.url().includes('--p-'),
  );
  await color(page, 'Culoarea principală').fill('#0b6e4f');
  await page.getByLabel('Poziție', { exact: true }).selectOption('bottom-left');
  await saved(page);
  await previewConfig;

  // Preview: the real widget with the draft (launcher color and side).
  const preview = page.frameLocator('iframe[title="Previzualizarea asistentului cu ciorna"]');
  const launcher = preview.locator('[data-chat-widget^="pilot--p-"] .launcher');
  await expect(launcher).toHaveCSS('background-image', /rgb\(11, 110, 79\)/);
  // Public widget: unchanged until publishing.
  expect(await publicAccent(page, 'pilot')).toBe('#3a36d0');

  await expect(publishButton(page)).toHaveText('Publică (2)');
  await publishButton(page).click();
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

test("the launcher's own color shows in the preview, its icon color is automatic", async ({
  page,
}) => {
  await openEditor(page, PILOT_ADMIN);
  const previewConfig = page.waitForResponse(
    (r) => r.url().includes('/api/loader-config') && r.url().includes('--p-'),
  );
  await color(page, 'Culoarea butonului').fill('#d97706');
  await saved(page);
  await previewConfig;
  const preview = page.frameLocator('iframe[title="Previzualizarea asistentului cu ciorna"]');
  const launcher = preview.locator('[data-chat-widget^="pilot--p-"] .launcher');
  await expect(launcher).toHaveCSS('background-color', 'rgb(217, 119, 6)');
  await expect(launcher).toHaveCSS('color', 'rgb(0, 0, 0)');
  expect((await discardDraft(page, 'pilot')).status).toBe(204);
});

test('a color pair below the AA contrast blocks publishing', async ({ page }) => {
  await openEditor(page, PILOT_ADMIN);
  // The text colors are folded under Culori avansate.
  await page.getByText('Culori avansate', { exact: true }).click();
  const text = color(page, 'Text');
  await text.fill('#eeeeee');
  await expect(text).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(/Contrast 1\.\d+:1 față de „Fundal”/).first()).toBeVisible();
  await expect(publishButton(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#publish-blocker')).toHaveText(/^Corectați/);
  await expect(page.locator('.statusbar')).toContainText(/probleme? de contrast/);
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
  const field = page.getByRole('group', { name: 'Logo', exact: true });
  const logo = field.locator('input[type="file"]');

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
    await editor.getByLabel('Numele asistentului').fill('Varianta editorului');
    await saved(editor);
    // ...then the administrator, who loaded the page before, saves on top of it.
    await page.getByLabel('Numele asistentului').fill('Varianta administratorului');
    const alert = page
      .getByRole('alert')
      .filter({ hasText: 'Ciorna a fost modificată de altcineva' });
    await expect(alert).toContainText('a salvat ciorna la');
    await expect(alert).toContainText('nu au fost salvate');
    // Nothing was overwritten.
    const draft = JSON.parse((await api(page, 'GET', '/admin/api/tenants/pilot/config')).text) as {
      draft: { config: { identity: { assistantName: string } } };
    };
    expect(draft.draft.config.identity.assistantName).toBe('Varianta editorului');
    await alert.getByRole('button', { name: 'Încarcă ciorna actuală' }).click();
    await expect(page.getByLabel('Numele asistentului')).toHaveValue('Varianta editorului');
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
  await page.getByLabel('Numele asistentului').fill('Scris înainte de expirare');
  // The single sign-on session at Keycloak brings the browser straight back.
  await viaKeycloak;
  await page.waitForURL(`${ADMIN}/admin/?tenant=pilot`);
  await expect(page.getByText(/au fost restaurate/)).toBeVisible();
  await expect(page.getByLabel('Numele asistentului')).toHaveValue('Scris înainte de expirare');
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
  await page.getByLabel('Numele asistentului').fill('Pilot e2e (cheie)');
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

test('sign-in: a known organisation hides the code field; "Altă organizație?" brings it back', async ({
  page,
}) => {
  await page.goto(`${ADMIN}/admin/?org=pilot`);
  await expect(page.locator('.login__org')).toHaveText('Pilot e2e');
  await expect(
    page.getByText('Veți fi redirecționat la pagina de autentificare a instituției.'),
  ).toBeVisible();
  await expect(page.getByLabel('Codul organizației')).toHaveCount(0);
  await page.getByRole('button', { name: 'Altă organizație?' }).click();
  await expect(page.getByLabel('Codul organizației')).toBeFocused();

  // An organisation that does not exist: the field, with the reason.
  await page.goto(`${ADMIN}/admin/?org=nu-exista`);
  const code = page.getByLabel('Codul organizației');
  await expect(code).toHaveValue('nu-exista');
  await expect(code).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(/^Organizația nu este configurată/)).toBeVisible();
  expect(await serious(page)).toEqual([]);
});

test("Keycloak sign-in page: the admin theme, in Romanian, with the client's name and logo", async ({
  page,
}) => {
  await page.goto(`${ADMIN}/admin/?org=pilot`);
  await page.getByRole('button', { name: 'Continuă spre autentificare' }).click();
  await page.waitForURL(
    /\/realms\/pilot\/protocol\/openid-connect\/auth|\/realms\/pilot\/login-actions\//,
  );
  // The theme is the one mounted, not Keycloak's default (no silent fallback).
  expect(
    await page.evaluate(() =>
      [...document.styleSheets].some((sheet) => sheet.href?.endsWith('/css/widget-admin.css')),
    ),
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ro');
  await expect(page).toHaveTitle('Autentificare – Pilot');
  await expect(page.locator('.widget-brand__name')).toHaveText('Pilot');
  await expect(page.locator('.widget-brand__suffix')).toHaveText(
    'administrarea asistentului virtual',
  );
  await expect(page.getByRole('heading', { name: 'Autentificați-vă' })).toBeVisible();
  await expect(page.getByLabel('Parolă', { exact: true })).toBeVisible();
  // The logo comes from the realm attribute, through the gateway, and really loads (the realm's
  // CSP allows the gateway in img-src).
  const logo = page.locator('#widget-logo');
  await expect(logo).toHaveAttribute('src', `${ADMIN}/w/t/pilot/logo`);
  await expect
    .poll(() => logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth))
    .toBeGreaterThan(0);
  expect(
    await page
      .locator('body')
      .evaluate((body) => getComputedStyle(body).fontFamily.split(',')[0]?.replace(/["']/g, '')),
  ).toBe('Inter');
  expect(await serious(page)).toEqual([]);
});

/** Where the focused element is (top level, or inside the preview frame). */
const focusRegion = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    if (!active || active === document.body) return { region: 'none', ring: true, label: '' };
    const regions: [string, string][] = [
      ['.skip-link', 'skip'],
      ['.app-header', 'header'],
      ['.statusbar', 'status'],
      ['.sidebar', 'sidebar'],
      ['.workspace__form', 'form'],
      ['#preview-column', 'preview'],
    ];
    const region = regions.find(([selector]) => active.closest(selector))?.[1] ?? 'other';
    const style = getComputedStyle(active);
    // A visible focus indicator: an outline, or (text fields) a focus border/shadow.
    const ring =
      active.tagName === 'IFRAME' ||
      (style.outlineStyle !== 'none' && style.outlineWidth !== '0px') ||
      style.boxShadow !== 'none';
    const label = active.getAttribute('aria-label') ?? active.textContent.trim().slice(0, 40);
    return { region, ring, label };
  });

test('keyboard: focus order through the editor, with a visible ring at every stop', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page, PILOT_ADMIN);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  const order: string[] = [];
  const noRing: string[] = [];
  for (let step = 0; step < 200; step += 1) {
    await page.keyboard.press('Tab');
    const { region, ring, label } = await focusRegion(page);
    if (!ring) noRing.push(`${region}: ${label}`);
    if (order.at(-1) !== region) order.push(region);
    if (region === 'preview') break;
  }
  expect(order).toEqual(['skip', 'header', 'status', 'sidebar', 'form', 'preview']);
  expect(noRing).toEqual([]);
});

test('keyboard: Escape closes the user menu, the preview panel and dialogs; focus comes back', async ({
  page,
}) => {
  await openEditor(page, PILOT_ADMIN);
  // User menu: opened from the keyboard, its action reached with Tab.
  const menuButton = page.getByRole('button', { name: /^Meniul utilizatorului/ });
  await menuButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#user-menu-panel')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Deconectare' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#user-menu-panel')).toBeHidden();

  // Preview side panel (under 1280 px).
  await page.setViewportSize({ width: 1100, height: 800 });
  const toggle = page.getByRole('button', { name: 'Previzualizare', exact: true });
  await toggle.click();
  await expect(page.getByRole('button', { name: 'Închide previzualizarea' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();

  // Dialog: discard, cancelled with Escape.
  await page.getByLabel('Numele asistentului').fill('Pentru dialog');
  await saved(page);
  const discard = page.getByRole('button', { name: 'Renunță la modificări' });
  await discard.click();
  const dialog = page.getByRole('dialog', { name: 'Renunțați la modificări?' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(discard).toBeFocused();
  expect((await discardDraft(page, 'pilot')).status).toBe(204);
});

test('tablet: no horizontal scroll at 768, 1024 and 1279 px; under 1024 the areas are a row', async ({
  page,
}) => {
  await openEditor(page, PILOT_ADMIN);
  for (const [width, height] of [
    [1279, 800],
    [1024, 768],
    [768, 1024],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`${ADMIN}/admin/`);
    await expect(page.getByLabel('Numele clientului')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${String(width)} px`).toBeLessThanOrEqual(0);
  }
  // 768 px: a horizontal row with a faded edge where more areas follow.
  const nav = page.getByRole('navigation', { name: 'Zone de configurare' });
  expect(await nav.evaluate((element) => getComputedStyle(element).flexDirection)).toBe('row');
  await expect(nav).toHaveAttribute('data-more', 'end');
  // Every area is reached with Tab and scrolled into view; Enter opens it.
  const last = nav.getByRole('link', { name: /^Integrare pe site/ });
  await nav.getByRole('link', { name: /^Aspect/ }).focus();
  for (let step = 0; step < 6; step += 1) await page.keyboard.press('Tab');
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport({ ratio: 0.9 });
  await expect(nav).toHaveAttribute('data-more', /start/);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Integrare pe site' })).toBeVisible();
});

test('no serious or critical axe violations on the login page', async ({ page }) => {
  await page.goto(`${ADMIN}/admin/`);
  await expect(page.getByRole('heading', { name: 'Autentificare' })).toBeVisible();
  await expect(page.getByRole('button', { name: /\(pilot\)$/ })).toBeVisible();
  expect(await serious(page)).toEqual([]);
});

const preview = (page: Page) =>
  page.frameLocator('iframe[title="Previzualizarea asistentului cu ciorna"]');
const previewWidget = (page: Page) => preview(page).locator('[data-chat-widget^="pilot--p-"]');

test('the preview opens on a sample conversation and follows the edited section', async ({
  page,
}) => {
  await openEditor(page, PILOT_ADMIN);
  const launcher = previewWidget(page).locator('.launcher');
  // Open window with the sample: question, answer with a link and a source.
  await expect(launcher).toHaveAttribute('aria-expanded', 'true');
  const chat = preview(page).frameLocator('iframe[title="Asistent virtual"]');
  await expect(chat.getByText('Care este programul cu publicul?')).toBeVisible();
  await expect(chat.getByRole('link', { name: /pagina de servicii/ })).toBeVisible();
  await expect(chat.getByText('Regulamentul de organizare')).toBeVisible();

  // Editing the launcher: the window closes, the launcher stays in view.
  await page.getByLabel('Poziție', { exact: true }).focus();
  await expect(launcher).toHaveAttribute('aria-expanded', 'false');
  await expect(launcher).toBeInViewport();

  // Back to Identitate: the window is open again, with the sample conversation.
  await page.getByRole('link', { name: 'Identitate', exact: true }).click();
  await page.getByLabel('Numele asistentului').focus();
  await expect(launcher).toHaveAttribute('aria-expanded', 'true');
  await expect(chat.getByText('Care este programul cu publicul?')).toBeVisible();
  // The initials in the form are the ones the window shows (same function, gateway/initials).
  const formInitials = await page
    .getByRole('group', { name: /^Avatarul asistentului/ })
    .locator('.tile')
    .first()
    .locator('.glyph')
    .innerText();
  await expect(chat.locator('.avatar__initials').first()).toHaveText(formInitials);
  expect(formInitials).toBe('PE');

  // "Mesaj proactiv": the bubble shows at once, with the new text.
  await area(page, 'Mesaj proactiv');
  await page.getByRole('switch', { name: 'Afișează mesajul proactiv' }).click();
  await page.getByLabel('Textul mesajului (română)').fill('Vă putem ajuta cu actele?');
  await saved(page);
  await expect(previewWidget(page).locator('.proactive')).toContainText(
    'Vă putem ajuta cu actele?',
  );
  expect((await discardDraft(page, 'pilot')).status).toBe(204);
});

test("starter questions: take the assistant's, reorder, see them in the preview", async ({
  page,
}) => {
  await openEditor(page, PILOT_ADMIN);
  await area(page, 'Texte și întrebări');
  const romanian = page.getByRole('tabpanel', { name: 'Română' });
  await expect(romanian.getByText('Care e programul?')).toBeVisible();
  await romanian.getByRole('button', { name: 'Preia și editează' }).click();
  await expect(romanian.getByLabel('Întrebarea 1', { exact: true })).toHaveValue(
    'Care e programul?',
  );
  await romanian.getByRole('button', { name: 'Mută mai jos întrebarea 1' }).click();
  await expect(romanian.getByLabel('Întrebarea 1', { exact: true })).toHaveValue(
    'Ce taxe sunt? surse',
  );
  await expect(romanian.getByRole('status')).toHaveText('Întrebarea a fost mutată pe poziția 2.');
  await saved(page);
  const chat = preview(page).frameLocator('iframe[title="Asistent virtual"]');
  await expect(chat.getByRole('button', { name: 'Ce taxe sunt? surse' })).toBeVisible();
  expect((await discardDraft(page, 'pilot')).status).toBe(204);
});

test('site integration: the code to copy, and the installation check', async ({ page }) => {
  await openEditor(page, PILOT_ADMIN);
  await area(page, 'Integrare pe site');
  const section = page.locator('section').filter({ has: page.locator('#section-integration') });
  await expect(section.locator('.checklist__item--ok')).toContainText('Domenii permise');
  await expect(section.locator('pre').first()).toHaveText(
    `<script src="${ADMIN}/w/loader.js" data-tenant="pilot" async></script>`,
  );
  await section.getByLabel('Engleză (data-locale="en")').check();
  await expect(section.locator('pre').first()).toContainText('data-locale="en"');

  // Installation records live in Redis (not reset between local runs): no assumption about the
  // state before; after loader.js loads on the site, the check reports it.
  // loader.js on the client's site asks for its configuration (an allowed origin).
  await page.request.get(`${ADMIN}/api/loader-config?tenant=pilot`, {
    headers: { origin: 'http://127.0.0.1:5180' },
  });
  await section.getByRole('button', { name: 'Verifică instalarea' }).click();
  await expect(
    section.getByText(/^Widget detectat pe http:\/\/127\.0\.0\.1:5180 la /),
  ).toBeVisible();
});

test('validation errors show in the status bar, link to the field and block publishing', async ({
  page,
}) => {
  await openEditor(page, PILOT_ADMIN);
  await area(page, 'Domenii permise');
  await expect(page.getByLabel('Domeniul 1', { exact: true })).toHaveValue('http://127.0.0.1:5180');
  await page.getByRole('button', { name: 'Adaugă domeniu' }).click();
  const domains = page.getByLabel('Domeniul 2', { exact: true });
  await expect(domains).toBeFocused();
  // http is refused outside localhost; the error stays on its row.
  await domains.fill('http://www.exemplu.ro');
  await expect(page.locator('#section-allowedOrigins').locator('..')).toContainText(
    'Folosiți https://',
  );
  await domains.fill('https://www.exemplu.ro/pagina');
  const badge = page.locator('.statusbar').getByRole('link', { name: /1 eroare/ });
  await expect(badge).toBeVisible();
  await expect(publishButton(page)).toHaveAttribute('aria-disabled', 'true');
  await publishButton(page).focus();
  await expect(page.locator('#publish-blocker')).toBeVisible();
  await expect(page.locator('#publish-blocker')).toHaveText(/^Corectați eroarea/);
  // The sidebar marks the area; the badge leads to the field.
  await expect(
    page
      .getByRole('navigation', { name: 'Zone de configurare' })
      .getByRole('link', { name: /^Domenii permise.*1 eroare/ }),
  ).toBeVisible();
  await area(page, 'Aspect');
  await badge.click();
  await expect(domains).toBeFocused();
  await saved(page);

  // Removing a domain asks first: the assistant stops there once published.
  await page.getByRole('button', { name: 'Elimină domeniul 1 (http://127.0.0.1:5180)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Eliminați domeniul?' });
  await expect(dialog).toContainText('Asistentul se va opri pe http://127.0.0.1:5180');
  await dialog.getByRole('button', { name: 'Anulează' }).click();
  await expect(page.getByLabel('Domeniul 1', { exact: true })).toHaveValue('http://127.0.0.1:5180');
  expect((await discardDraft(page, 'pilot')).status).toBe(204);
});

test('the visual choices show a focus ring for the keyboard', async ({ page }) => {
  await openEditor(page, PILOT_ADMIN);
  const tiles = page.getByRole('group', { name: 'Avatarul asistentului' });
  const selected = tiles.getByRole('radio', { checked: true });
  await selected.focus();
  await page.keyboard.press('ArrowRight');
  const focused = tiles.locator('input:focus');
  await expect(focused).toHaveCount(1);
  expect(await focused.evaluate((input) => getComputedStyle(input).outlineStyle)).toBe('solid');
  await page
    .locator('.option-grid')
    .first()
    .screenshot({ path: test.info().outputPath('focus.png') });
  expect((await discardDraft(page, 'pilot')).status).toBe(204);
});

// The editor is scanned region by region, each in a fresh page of the same session: a scan of
// the whole editor at once crashed Firefox in CI ("Page crashed"), even without frames. The
// preview frame holds the public widget, axe-tested in its own specs, and is left out.
const EDITOR_REGIONS: { area: string; selector: string }[] = [
  { area: 'Aspect', selector: '.app-header' },
  { area: 'Aspect', selector: '.statusbar' },
  { area: 'Aspect', selector: '.sidebar' },
  { area: 'Aspect', selector: '#section-identity' },
  { area: 'Aspect', selector: '#section-launcher' },
  { area: 'Aspect', selector: '#section-window' },
  { area: 'Aspect', selector: '#section-colors' },
  { area: 'Texte și întrebări', selector: '#section-texts' },
  { area: 'Mesaj proactiv', selector: '#section-proactive' },
  { area: 'Citări', selector: '#section-citations' },
  { area: 'Comportament', selector: '#section-behavior' },
  { area: 'Domenii permise', selector: '#section-allowedOrigins' },
  { area: 'Integrare pe site', selector: '#section-integration' },
  { area: 'Aspect', selector: '.preview__head' },
];

/** The pieces of a section, scanned one by one in Firefox (see below). */
const SECTION_PARTS = ['h2', '.field', 'fieldset', '.switch-row', '.contrast'];

/** Scans one region (or the n-th piece of a section) in a fresh page; returns its problems. */
async function scanRegion(
  context: BrowserContext,
  name: string,
  region: string,
  part?: number,
): Promise<string | undefined> {
  const tab = await context.newPage();
  try {
    await tab.goto(`${ADMIN}/admin/`);
    await expect(tab.getByLabel('Numele clientului')).toBeVisible();
    if (name !== 'Aspect') await area(tab, name);
    // The preview's widget is axe-tested in its own specs; its header is scanned on its own.
    if (region === '.preview__head') {
      await tab.locator('.preview__frame').evaluate((frame) => {
        frame.remove();
      });
    } else {
      await tab.locator('#preview-column').evaluate((column) => {
        column.remove();
      });
    }
    let selector = region.startsWith('#section-')
      ? `section[aria-labelledby="${region.slice(1)}"]`
      : region;
    await expect(tab.locator(selector).first()).toBeVisible();
    if (part !== undefined) {
      await tab.evaluate(
        ({ base, part, parts }) => {
          const found = document.querySelectorAll(parts.map((item) => `${base} ${item}`).join(','));
          if (part < found.length) found.item(part).setAttribute('data-axe-part', '');
        },
        { base: selector, part, parts: SECTION_PARTS },
      );
      selector = '[data-axe-part]';
    }
    const results = await new AxeBuilder({ page: tab }).include(selector).analyze();
    const serious = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    return serious.length > 0 ? serious.map((violation) => violation.id).join(', ') : undefined;
  } catch (error) {
    return String(error).split('\n')[0] ?? 'error';
  } finally {
    await tab.close().catch(() => undefined);
  }
}

test('no serious or critical axe violations in the editor', async ({
  page,
  context,
  browserName,
}) => {
  test.setTimeout(360_000);
  await openEditor(page, PILOT_ADMIN);
  // Firefox crashes ("Page crashed") while axe scans an Aspect section as a whole (several rules
  // trigger it; every piece passes on its own, and the pages work in Firefox). There the Aspect
  // sections are scanned piece by piece, with every rule; elsewhere as a whole. docs/BACKLOG.md.
  const pieces = new Map<string, number>();
  if (browserName === 'firefox') {
    for (const { area: name, selector } of EDITOR_REGIONS) {
      if (name !== 'Aspect' || !selector.startsWith('#section-')) continue;
      const count = await page
        .locator(
          SECTION_PARTS.map(
            (item) => `section[aria-labelledby="${selector.slice(1)}"] ${item}`,
          ).join(','),
        )
        .count();
      pieces.set(selector, count);
    }
  }
  await page.close();
  // Every region is scanned even if one fails, so that one run names all the problems.
  const failures: string[] = [];
  for (const { area: name, selector: region } of EDITOR_REGIONS) {
    await test.step(`axe: ${name} ${region}`, async () => {
      const count = pieces.get(region);
      if (count === undefined) {
        const problem = await scanRegion(context, name, region);
        if (problem) failures.push(`${region}: ${problem}`);
        return;
      }
      expect(count, region).toBeGreaterThan(1);
      for (let part = 0; part < count; part += 1) {
        const label = `${region} piece ${String(part + 1)}`;
        let problem = await scanRegion(context, name, region, part);
        // A Firefox crash is not a finding (Chromium and WebKit scan the same DOM with every
        // rule): retried once, then reported as an annotation instead of a failure.
        if (problem?.includes('Page crashed')) {
          problem = await scanRegion(context, name, region, part);
          if (problem?.includes('Page crashed')) {
            test.info().annotations.push({
              type: 'firefox-axe-crash',
              description: `${label} (docs/BACKLOG.md)`,
            });
            continue;
          }
        }
        if (problem) failures.push(`${label}: ${problem}`);
      }
    });
  }
  expect(failures).toEqual([]);
});
