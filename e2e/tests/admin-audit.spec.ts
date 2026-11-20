import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { serious } from '../axe.js';
import { ADMIN, ADMIN_E2E } from '../constants.js';

/**
 * The audit log screen (E5 B9): filters, export, and the isolation between clients, against
 * the development Keycloak realms and the e2e database. Test users from deploy/keycloak/README.md
 * (development only).
 */
test.skip(!ADMIN_E2E, 'needs E2E_ADMIN=1 with Postgres, Redis and Keycloak running');
test.describe.configure({ mode: 'serial' });

interface User {
  org: string;
  username: string;
  password: string;
}
const PILOT_ADMIN: User = {
  org: 'pilot',
  username: 'pilot-admin',
  password: 'dev-pilot-admin-Pass1',
};
const PILOT_EDITOR: User = {
  org: 'pilot',
  username: 'pilot-editor',
  password: 'dev-pilot-editor-Pass1',
};
const DEMO_ADMIN: User = {
  org: 'demo-primarie',
  username: 'demo-admin',
  password: 'dev-demo-admin-Pass1',
};
const PLATFORM: User = {
  org: 'platform',
  username: 'platform-admin',
  password: 'dev-platform-admin-Pass1',
};

async function signIn(page: Page, who: User): Promise<void> {
  await page.goto(`${ADMIN}/admin/?org=${who.org}`);
  await page.getByRole('button', { name: 'Continuă spre autentificare' }).click();
  await page.locator('#username').fill(who.username);
  await page.locator('#password').fill(who.password);
  await page.locator('#kc-login').click();
  await page.waitForURL(`${ADMIN}/admin/**`);
  await expect(page.getByLabel('Numele clientului')).toBeVisible();
}

/** Calls the admin API from the page (session cookie + CSRF token), like the interface does. */
async function api(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
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
      const text = await response.text();
      let json: unknown = text;
      try {
        json = JSON.parse(text);
      } catch {
        // not JSON
      }
      return { status: response.status, json };
    },
    { method, path, body },
  );
}

interface AuditEvent {
  chain: string;
  tenant: string;
  action: string;
  result: string;
  actor: { name?: string; org?: string };
  details: Record<string, unknown>;
}
const auditPage = async (page: Page, query = '') =>
  (await api(page, 'GET', `/admin/api/audit?limit=200${query}`)) as {
    status: number;
    json: { chain: string; events: AuditEvent[] };
  };

async function openAudit(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Zone de configurare' })
    .getByRole('link', { name: 'Jurnal de audit', exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Jurnal de audit' })).toBeVisible();
}

const rows = (page: Page) => page.locator('.audit__table tbody tr');

/** A draft change with a value the filters and the detail can find again. */
async function saveMarkedDraft(page: Page, marker: string): Promise<void> {
  const state = (await api(page, 'GET', '/admin/api/tenants/pilot/config')).json as {
    published: { version: number; config: Record<string, unknown> };
    draft: { revision: number; config: Record<string, unknown> } | null;
  };
  const config = structuredClone(state.draft?.config ?? state.published.config);
  const texts = (config.texts ?? {}) as Record<string, Record<string, unknown>>;
  config.texts = { ...texts, ro: { ...texts.ro, welcome: `Bun venit ${marker}` } };
  const saved = await api(page, 'PUT', '/admin/api/tenants/pilot/config/draft', {
    config,
    baseVersion: state.published.version,
    draftRevision: state.draft?.revision ?? null,
  });
  expect(saved.status).toBe(200);
}

test('filters: period, action, result and search narrow the log; the detail shows the diff', async ({
  page,
}) => {
  await signIn(page, PILOT_ADMIN);
  const marker = `audit-${String(Date.now())}`;
  await saveMarkedDraft(page, marker);
  // A refused attempt on another client: recorded as "Acces refuzat" in this client's log.
  expect((await api(page, 'GET', '/admin/api/tenants/demo-primarie/config')).status).toBe(403);

  await openAudit(page);
  await expect(rows(page).first()).toBeVisible();
  // The opening itself is the newest record.
  await expect(rows(page).first()).toContainText('Vizualizare jurnal');

  // Result: only refusals.
  await page.getByLabel('Rezultat').selectOption({ label: 'Refuzat' });
  await page.getByRole('button', { name: 'Aplică filtrele' }).click();
  await expect(rows(page).first()).toContainText('Acces refuzat');
  for (const text of await rows(page).allTextContents()) expect(text).toContain('Refuzat');

  // Action group + search: the draft with the marker, and nothing else.
  await page.getByRole('button', { name: 'Șterge filtrele' }).click();
  await page.getByLabel('Acțiune').selectOption({ label: 'Ciornă' });
  await page.getByLabel('Căutare în detalii').fill(marker);
  await page.getByRole('button', { name: 'Aplică filtrele' }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Salvare ciornă');

  await rows(page)
    .first()
    .getByRole('button', { name: /^Detalii:/ })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('row', { name: /^texts/ })).toContainText(`Bun venit ${marker}`);
  await expect(dialog).toContainText('Ana Admin');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // The period: a day in the future has nothing; today (Romanian time) has the draft.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(
    new Date(),
  );
  await page.getByLabel('De la data').fill('2099-01-01');
  await page.getByRole('button', { name: 'Aplică filtrele' }).click();
  await expect(page.locator('.audit__empty')).toHaveText('Niciun eveniment pentru aceste filtre.');
  await page.getByLabel('De la data').fill(today);
  await page.getByLabel('Până la data (inclusiv)').fill(today);
  await page.getByRole('button', { name: 'Aplică filtrele' }).click();
  await expect(rows(page)).toHaveCount(1);

  await api(page, 'DELETE', '/admin/api/tenants/pilot/config/draft');

  // No serious or critical accessibility problem on the screen (filters, table). Last: in
  // Firefox axe may crash the page (see e2e/axe.ts).
  expect(await serious(page, '.audit')).toEqual([]);
});

test('export: CSV and JSON with the filters, a header and the hashes; the export is recorded', async ({
  page,
}) => {
  await signIn(page, PILOT_ADMIN);
  await openAudit(page);
  await page.getByLabel('Acțiune').selectOption({ label: 'Autentificare și sesiuni' });
  await page.getByRole('button', { name: 'Aplică filtrele' }).click();
  await expect(rows(page).first()).toContainText('Autentificare');

  const csvDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export CSV' }).click();
  const csvFile = await csvDownload;
  expect(csvFile.suggestedFilename()).toMatch(/^jurnal-audit-pilot-.*\.csv$/);
  const csv = await readFile(await csvFile.path(), 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain('# generat de: Ana Admin');
  expect(csv).toContain('# filtre: {"action":"auth.*"}');
  const lines = csv.trim().split(/\r\n/);
  expect(lines).toContain(
    'seq,at_utc,at_romania,action,section,result,reason,version,sensitive,actor_name,actor_email,' +
      'actor_role,actor_org,actor_source,actor_subject,ip,user_agent,session_hash,request_id,' +
      'details,prev_hash,hash',
  );
  // seq, UTC time, then the Romanian time (quoted: it has a comma), then the action.
  const records = lines.filter((line) => /^\d+,/.test(line));
  expect(records.length).toBeGreaterThan(0);
  for (const record of records) expect(record).toMatch(/^\d+,[^,]+,"[^"]+",auth\.[a-z_]+,/);

  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export JSON' }).click();
  const json = JSON.parse(await readFile(await (await jsonDownload).path(), 'utf8')) as {
    header: { chain: string; generatedBy: { name: string }; filters: unknown; lastHash: string };
    events: { record: { action: string; chain: string }; hash: string }[];
  };
  expect(json.header.chain).toBe('pilot');
  expect(json.header.generatedBy.name).toBe('Ana Admin');
  expect(json.header.filters).toEqual({ action: 'auth.*' });
  expect(json.events.length).toBeGreaterThan(0);
  expect(json.events.every((event) => event.record.chain === 'pilot')).toBe(true);
  expect(json.header.lastHash).toBe(json.events.at(-1)?.hash);

  // Both exports are in the log, with who took them.
  const exports = (await auditPage(page, '&action=audit.export')).json.events;
  expect(exports.slice(0, 2).map((event) => event.details.format)).toEqual(['json', 'csv']);
  expect(exports[0]?.actor.name).toBe('Ana Admin');
});

test('isolation: each client sees only its own log; editors none; super-admin all', async ({
  page,
  browser,
}) => {
  // Demo's administrator: only demo-primarie records, and pilot's log is refused (and recorded).
  await signIn(page, DEMO_ADMIN);
  const own = await auditPage(page);
  expect(own.status).toBe(200);
  expect(own.json.chain).toBe('demo-primarie');
  expect(own.json.events.length).toBeGreaterThan(0);
  expect(own.json.events.every((event) => event.chain === 'demo-primarie')).toBe(true);
  expect((await auditPage(page, '&chain=pilot')).status).toBe(403);
  expect((await auditPage(page, '&chain=platform')).status).toBe(403);
  const exported = await api(page, 'GET', '/admin/api/audit/export?chain=pilot&format=json');
  expect(exported.status).toBe(403);
  // The screen has no log chooser for a client administrator.
  await openAudit(page);
  await expect(page.getByLabel('Jurnalul')).toHaveCount(0);
  await expect(rows(page).first()).toBeVisible();
  // Pilot's draft changes (the first test's marker) are not searchable from demo.
  await page.getByLabel('Căutare în detalii').fill('Bun venit audit-');
  await page.getByRole('button', { name: 'Aplică filtrele' }).click();
  await expect(page.locator('.audit__empty')).toHaveText('Niciun eveniment pentru aceste filtre.');
  expect(
    (await auditPage(page, `&q=${encodeURIComponent('Bun venit audit-')}`)).json.events,
  ).toEqual([]);

  // Pilot's editor: no audit area, and the API refuses.
  const editorContext = await browser.newContext();
  const editor = await editorContext.newPage();
  await signIn(editor, PILOT_EDITOR);
  await expect(
    editor
      .getByRole('navigation', { name: 'Zone de configurare' })
      .getByRole('link', { name: 'Jurnal de audit' }),
  ).toHaveCount(0);
  expect((await auditPage(editor)).status).toBe(403);
  await editorContext.close();

  // The platform super-admin: any client's log and the platform log.
  const platformContext = await browser.newContext();
  const platform = await platformContext.newPage();
  await signIn(platform, PLATFORM);
  await openAudit(platform);
  await platform.getByLabel('Jurnalul').selectOption('demo-primarie');
  await expect(rows(platform).first()).toBeVisible();
  // Demo's refused attempt on pilot's log is in demo's log.
  await platform.getByLabel('Rezultat').selectOption({ label: 'Refuzat' });
  await platform.getByRole('button', { name: 'Aplică filtrele' }).click();
  await expect(rows(platform).first()).toContainText('Acces refuzat');
  const pilot = await auditPage(platform, '&chain=pilot');
  expect(pilot.json.events.every((event) => event.chain === 'pilot')).toBe(true);
  const platformLog = await auditPage(platform, '&chain=platform');
  expect(platformLog.status).toBe(200);
  expect(platformLog.json.events.every((event) => event.chain === 'platform')).toBe(true);
  await platformContext.close();
});

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('an unused image is deleted after confirmation, and the deletion is in the log (K6)', async ({
  page,
}) => {
  await signIn(page, PILOT_ADMIN);
  // Uploaded but not chosen anywhere: no version and no draft uses it.
  const file = await page.evaluate(async (base64) => {
    const session = (await fetch('/admin/api/session').then((r) => r.json())) as {
      csrfToken: string;
    };
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const response = await fetch('/admin/api/tenants/pilot/assets?name=de-sters.png', {
      method: 'POST',
      headers: { 'x-csrf-token': session.csrfToken, 'content-type': 'image/png' },
      body: bytes,
    });
    return ((await response.json()) as { file: string }).file;
  }, PNG_BASE64);
  await page.reload();

  const library = page.getByRole('region', { name: 'Imagini încărcate' });
  const item = library.getByRole('listitem').filter({ hasText: file });
  await expect(item).toContainText('Nefolosită');
  await item.getByRole('button', { name: `Șterge imaginea ${file}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Ștergi imaginea?' });
  await dialog.getByRole('button', { name: 'Șterge imaginea' }).click();
  await expect(library.getByRole('status')).toHaveText(`Imaginea ${file} a fost ștearsă.`);
  await expect(item).toHaveCount(0);

  await openAudit(page);
  await page.getByLabel('Acțiune').selectOption({ label: 'Imagini' });
  await page.getByRole('button', { name: 'Aplică filtrele' }).click();
  await expect(rows(page).first()).toContainText('Ștergere imagine');
  await rows(page)
    .first()
    .getByRole('button', { name: /^Detalii:/ })
    .click();
  await expect(page.getByRole('dialog')).toContainText(file);
});
