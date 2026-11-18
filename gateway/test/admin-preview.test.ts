import { describe, expect, it } from 'vitest';
import { PREVIEW_ID, redactPreview, TenantsWithPreviews } from '../src/admin/preview.js';
import { logTenant, type Tenant } from '../src/config/tenants.js';
import { difyUser } from '../src/dify/client.js';
import { tenantIdSchema } from '../src/protocol/index.js';
import { testTenant } from './helpers.js';

const token = '0123456789abcdef0123456789abcdef';
const previewId = `pilot--p-${token}`;
const preview: Tenant = { ...testTenant, id: previewId, preview: { tenantId: 'pilot' } };

describe('admin preview (ADR 008)', () => {
  it('uses ids the widget already accepts as tenant ids', () => {
    expect(PREVIEW_ID.exec(previewId)?.slice(1)).toEqual(['pilot', token]);
    expect(tenantIdSchema.safeParse(`${'a'.repeat(64)}--p-${token}`).success).toBe(true);
    expect(PREVIEW_ID.test(`pilot--p-${token.toUpperCase()}`)).toBe(false);
    expect(PREVIEW_ID.test('pilot')).toBe(false);
  });

  it('marks preview traffic for Dify and in logs, without logging the token', () => {
    expect(difyUser(preview, 'v-1')).toBe('preview-v-1');
    expect(difyUser(testTenant, 'v-1')).toBe('v-1');
    expect(logTenant(preview)).toEqual({ tenant: 'pilot', preview: true });
    expect(logTenant(testTenant)).toEqual({ tenant: testTenant.id });
    expect(redactPreview(`/api/loader-config?tenant=${previewId}&locale=ro`)).toBe(
      '/api/loader-config?tenant=pilot--p-[redacted]&locale=ro',
    );
  });

  it('serves published tenants first and forgets previews that no longer resolve', () => {
    const view = new TenantsWithPreviews(new Map([[testTenant.id, testTenant]]));
    expect(view.get(testTenant.id)).toBe(testTenant);
    expect(view.get(previewId)).toBeUndefined();
    view.remember(previewId, preview);
    expect(view.get(previewId)).toBe(preview);
    // Previews are not listed as tenants.
    expect([...view.keys()]).toEqual([testTenant.id]);
    view.remember(previewId, undefined);
    expect(view.get(previewId)).toBeUndefined();
  });
});
