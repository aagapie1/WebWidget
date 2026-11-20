/**
 * Which parts of a tenant configuration the admin interface edits (spec §5.1). The server fields
 * (identity of the tenant and its Dify connection) are managed by the platform (E4b.2, §5.6):
 * never sent to the admin interface and never taken from it.
 */
export const SERVER_FIELDS = [
  'schemaVersion',
  'id',
  'enabled',
  'difyBaseUrl',
  'difyApiKeyEnv',
] as const;

export type ConfigObject = Record<string, unknown>;

export const isObject = (value: unknown): value is ConfigObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** The editable view of a stored configuration. */
export function editableView(config: unknown): ConfigObject {
  if (!isObject(config)) return {};
  return Object.fromEntries(
    Object.entries(config).filter(([key]) => !(SERVER_FIELDS as readonly string[]).includes(key)),
  );
}

/** A stored configuration: the edited fields plus the server fields of the base version. */
export function mergeServerFields(edited: ConfigObject, base: unknown): ConfigObject {
  const server = isObject(base)
    ? Object.fromEntries(
        Object.entries(base).filter(([key]) => (SERVER_FIELDS as readonly string[]).includes(key)),
      )
    : {};
  return { ...editableView(edited), ...server };
}

export interface Change {
  path: string;
  before?: unknown;
  after?: unknown;
}

const MAX_CHANGES = 200;

/** Leaf differences between two configurations (arrays compared as a whole), for the audit log. */
export function diff(before: unknown, after: unknown, path = '', changes: Change[] = []): Change[] {
  if (changes.length >= MAX_CHANGES) return changes;
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      diff(before[key], after[key], path ? `${path}.${key}` : key, changes);
    }
    return changes;
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    changes.push({
      path: path || '(root)',
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
    });
  }
  return changes;
}

/** The allowed origins of a configuration, as stored (for the widget-admin-only rule). */
export function originsOf(config: unknown): unknown {
  return isObject(config) ? config.allowedOrigins : undefined;
}

/** The client's name (super-admin only). */
export function nameOf(config: unknown): unknown {
  return isObject(config) ? config.name : undefined;
}

/** The audit log's retention setting (super-admin only, E5 B9). */
export function auditSettingsOf(config: unknown): unknown {
  return isObject(config) ? config.audit : undefined;
}
