import type { KeyValueStore } from '../admin/kv.js';

/**
 * Documents cited recently by a tenant's assistant (E4b.1 UX 13): the admin offers their file
 * names when it maps file names to displayed titles. Document names only, no questions or
 * answers: no personal data. Stored in Redis (rule 9), one key per tenant, kept 90 days after
 * the last citation.
 */
const TTL_SECONDS = 90 * 24 * 60 * 60;
const MAX_AGE_MS = TTL_SECONDS * 1000;
/** A name already seen in the last day is not written again (an answer must not cost a write). */
const REFRESH_MS = 24 * 60 * 60 * 1000;
/** The most recent ones are kept. */
const MAX_DOCUMENTS = 300;

const key = (tenant: string): string => `cited:${tenant}`;

/** Admin preview tenants (`<tenant>--p-<token>`) count for their tenant. */
export const baseTenant = (tenant: string): string => tenant.split('--p-')[0] ?? tenant;

async function read(store: KeyValueStore, tenant: string): Promise<Record<string, string>> {
  const raw = await store.get(key(tenant));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
}

export async function recordCited(
  store: KeyValueStore,
  tenant: string,
  names: readonly string[],
  now: number = Date.now(),
): Promise<void> {
  if (names.length === 0) return;
  const id = baseTenant(tenant);
  const seen = await read(store, id);
  const fresh = names.filter((name) => {
    const last = seen[name];
    return !last || now - Date.parse(last) >= REFRESH_MS;
  });
  if (fresh.length === 0) return;
  const at = new Date(now).toISOString();
  for (const name of fresh) seen[name] = at;
  const kept = Object.entries(seen)
    .filter(([, last]) => now - Date.parse(last) < MAX_AGE_MS)
    .sort(([, a], [, b]) => b.localeCompare(a))
    .slice(0, MAX_DOCUMENTS);
  await store.set(key(id), JSON.stringify(Object.fromEntries(kept)), TTL_SECONDS);
}

export interface CitedDocument {
  name: string;
  /** ISO time of the last citation (to the day: refreshed at most once a day). */
  lastSeen: string;
}

/** Most recent first. */
export async function citedDocuments(
  store: KeyValueStore,
  tenant: string,
  now: number = Date.now(),
): Promise<CitedDocument[]> {
  return Object.entries(await read(store, baseTenant(tenant)))
    .filter(([, last]) => now - Date.parse(last) < MAX_AGE_MS)
    .sort(([, a], [, b]) => b.localeCompare(a))
    .map(([name, lastSeen]) => ({ name, lastSeen }));
}
