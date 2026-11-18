import type { KeyValueStore } from '../admin/kv.js';

/**
 * "Verifică instalarea" (E4b.1 UX): the last time loader.js loaded the configuration on each
 * allowed site of a tenant. Stored in Redis (rule 9), per origin — sites, not visitors: no
 * personal data. Kept 90 days after the last load.
 */
const TTL_SECONDS = 90 * 24 * 60 * 60;
/** One write per site every 10 minutes at most (a page view must not cost a Redis write). */
const THROTTLE_MS = 10 * 60 * 1000;

const key = (tenant: string, origin: string): string => `install:${tenant}:${origin}`;

export async function recordInstall(
  store: KeyValueStore,
  tenant: string,
  origin: string,
  now: number = Date.now(),
): Promise<void> {
  const last = await store.get(key(tenant, origin));
  if (last && now - Date.parse(last) < THROTTLE_MS) return;
  await store.set(key(tenant, origin), new Date(now).toISOString(), TTL_SECONDS);
}

export interface Installation {
  origin: string;
  /** ISO time of the last load, or null when the widget was never seen there. */
  lastSeen: string | null;
}

export async function installations(
  store: KeyValueStore,
  tenant: string,
  origins: readonly string[],
): Promise<Installation[]> {
  return Promise.all(
    origins.map(async (origin) => ({
      origin,
      lastSeen: (await store.get(key(tenant, origin))) ?? null,
    })),
  );
}
