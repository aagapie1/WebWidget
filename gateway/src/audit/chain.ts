import { createHash } from 'node:crypto';

/**
 * Canonical JSON for hashing (E5 B9): object keys sorted, `null` and `undefined` left out, no
 * whitespace. The same record read back from Postgres (jsonb reorders keys) gives the same text.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== null && item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** `SHA-256(prev_hash ‖ "\n" ‖ canonical record)`, hex. The first record of a chain has prev "". */
export function chainHash(previous: string, record: unknown): string {
  return createHash('sha256')
    .update(`${previous}\n${canonicalJson(record)}`)
    .digest('hex');
}
