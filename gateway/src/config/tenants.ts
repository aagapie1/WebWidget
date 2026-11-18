import { createHash } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';
import { PRESENTATION_SECTIONS, tenantSchema, type TenantConfig } from './schema.js';

export { SCHEMA_VERSION, type TenantConfig } from './schema.js';

/** Configuration error. Messages never include secret values. */
export class TenantConfigError extends Error {
  override name = 'TenantConfigError';
}

type Env = Readonly<Record<string, string | undefined>>;

export const MAX_ASSET_BYTES = 200 * 1024;
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/** A tenant image from `config/tenants/<id>/assets/`, served by the gateway (ADR 007). */
export interface TenantAsset {
  name: string;
  /** Absolute path on disk. */
  file: string;
  contentType: string;
  /** Short content hash: part of the URL, so the file can be cached as immutable. */
  hash: string;
  /** Public path, e.g. `/w/t/pilot/3f2a9c1b-logo.png`. */
  url: string;
}

/** Runtime tenant: validated configuration + resolved Dify key + assets. Never sent to a client. */
export interface Tenant extends Omit<TenantConfig, 'difyApiKeyEnv'> {
  readonly difyApiKey: string;
  readonly assets: ReadonlyMap<string, TenantAsset>;
}

export type TenantRegistry = ReadonlyMap<string, Tenant>;

/** Outcome of validating one tenant file. */
export interface TenantValidation {
  /** Present when the core (id, Dify, origins…) is valid, possibly with default presentation. */
  tenant?: Tenant;
  /** Every problem found; non-empty means the file is not valid as written. */
  errors: string[];
}

export interface ValidateOptions {
  env: Env;
  fileName: string;
  /** Directory holding `<id>/assets/`; assets are only checked when given. */
  tenantsDir?: string;
  /**
   * `config:check` mode: does not need secrets. Missing `${VAR}` values get a placeholder and the
   * Dify key variable is not read.
   */
  checkOnly?: boolean;
}

const PLACEHOLDER = 'http://placeholder.invalid';

/** Replaces `${NAME}` in string values with environment variables. */
function interpolate(value: unknown, env: Env, errors: string[], checkOnly: boolean): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_match, name: string) => {
      const resolved = env[name];
      if (resolved === undefined || resolved === '') {
        if (!checkOnly) errors.push(`environment variable ${name} is not set`);
        return PLACEHOLDER;
      }
      return resolved;
    });
  }
  if (Array.isArray(value)) return value.map((item) => interpolate(item, env, errors, checkOnly));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, interpolate(item, env, errors, checkOnly)]),
    );
  }
  return value;
}

// Only paths and messages, never input values: they could contain secrets.
const describe = (issues: readonly z.core.$ZodIssue[]): string[] =>
  issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);

const sectionOf = (issue: z.core.$ZodIssue): string | undefined =>
  typeof issue.path[0] === 'string' ? issue.path[0] : undefined;

/**
 * Validates one tenant file. Presentation sections with errors fall back to their defaults so
 * that a tenant is never taken down by a bad color or text (ADR 007); core errors make the
 * tenant unavailable.
 */
export async function validateTenant(
  text: string,
  options: ValidateOptions,
): Promise<TenantValidation> {
  const { env, fileName, checkOnly = false } = options;
  const errors: string[] = [];
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (error) {
    return { errors: [`invalid YAML (${String(error)})`] };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: ['the file must contain a YAML object'] };
  }

  const input = interpolate(raw, env, errors, checkOnly) as Record<string, unknown>;
  let result = tenantSchema.safeParse(input);
  if (!result.success) {
    errors.push(...describe(result.error.issues));
    const broken = new Set(result.error.issues.map(sectionOf));
    const presentationOnly = [...broken].every(
      (section) =>
        section !== undefined && (PRESENTATION_SECTIONS as readonly string[]).includes(section),
    );
    if (!presentationOnly) return { errors };
    // Retry with the defaults for the broken presentation sections only.
    const fallback = Object.fromEntries(Object.entries(input).filter(([key]) => !broken.has(key)));
    result = tenantSchema.safeParse(fallback);
    if (!result.success) {
      errors.push(...describe(result.error.issues));
      return { errors };
    }
  }

  const { difyApiKeyEnv, ...config } = result.data;
  const expectedId = basename(fileName, extname(fileName));
  if (config.id !== expectedId) {
    errors.push(`id "${config.id}" must match the file name`);
    return { errors };
  }

  let difyApiKey = '';
  if (!checkOnly) {
    difyApiKey = env[difyApiKeyEnv] ?? '';
    if (!difyApiKey) {
      errors.push(`environment variable ${difyApiKeyEnv} is not set`);
      return { errors };
    }
  }

  const assets = options.tenantsDir
    ? await resolveAssets(config, join(options.tenantsDir, config.id, 'assets'), errors)
    : new Map<string, TenantAsset>();
  return { tenant: { ...config, difyApiKey, assets }, errors };
}

/** Checks referenced asset files; a missing or invalid one is dropped (and reported). */
async function resolveAssets(
  config: Omit<TenantConfig, 'difyApiKeyEnv'>,
  dir: string,
  errors: string[],
): Promise<Map<string, TenantAsset>> {
  const references: [string, string | undefined][] = [
    ['identity.logo', config.identity.logo],
    ['identity.assistantAvatar', config.identity.assistantAvatar],
    [
      'identity.userAvatar',
      config.identity.userAvatar === 'none' ? undefined : config.identity.userAvatar,
    ],
    [
      'launcher.icon',
      config.launcher.icon?.type === 'asset' ? config.launcher.icon.file : undefined,
    ],
  ];
  const assets = new Map<string, TenantAsset>();
  for (const [path, name] of references) {
    if (!name || assets.has(name)) continue;
    const file = join(dir, name);
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      if (info.size > MAX_ASSET_BYTES) {
        errors.push(`${path}: ${name} is larger than ${String(MAX_ASSET_BYTES / 1024)} KB`);
        continue;
      }
      const content = await readFile(file);
      const hash = createHash('sha256').update(content).digest('hex').slice(0, 10);
      assets.set(name, {
        name,
        file,
        contentType: CONTENT_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream',
        hash,
        url: `/w/t/${config.id}/${hash}-${name}`,
      });
    } catch {
      errors.push(`${path}: ${name} not found in config/tenants/${config.id}/assets/`);
    }
  }
  return assets;
}

/** Strict variant used by tests and tools: any problem throws. */
export async function parseTenant(
  text: string,
  env: Env,
  fileName: string,
  tenantsDir?: string,
): Promise<Tenant> {
  const result = await validateTenant(text, {
    env,
    fileName,
    ...(tenantsDir ? { tenantsDir } : {}),
  });
  if (result.errors.length > 0 || !result.tenant) {
    throw new TenantConfigError(`${fileName}: ${result.errors.join('; ')}`);
  }
  return result.tenant;
}

export interface TenantLogger {
  info(object: object, message: string): void;
  error(object: object, message: string): void;
}

const tenantFiles = async (dir: string) =>
  (await readdir(dir)).filter((name) => /\.ya?ml$/.test(name)).sort();

/**
 * Configuration source (ADR 007). E4: YAML files with hot reload. E4b will add a Postgres source
 * with the same contract: it fills and updates a registry that routes read on every request.
 */
export interface TenantSource {
  load(): Promise<Map<string, Tenant>>;
  /** Keeps `registry` up to date; returns a function that stops watching. */
  watch(registry: Map<string, Tenant>): () => void;
}

export class FileTenantSource implements TenantSource {
  constructor(
    private readonly dir: string,
    private readonly env: Env,
    private readonly log: TenantLogger,
  ) {}

  async load(): Promise<Map<string, Tenant>> {
    const tenants = new Map<string, Tenant>();
    for (const name of await tenantFiles(this.dir)) {
      const tenant = await this.#loadFile(name, undefined);
      if (!tenant) continue;
      if (tenants.has(tenant.id)) {
        this.log.error({ file: name }, `tenant config rejected: duplicate id "${tenant.id}"`);
        continue;
      }
      tenants.set(tenant.id, tenant);
    }
    if (tenants.size === 0) {
      throw new TenantConfigError(`No valid tenant configuration found in ${this.dir}`);
    }
    return tenants;
  }

  watch(registry: Map<string, Tenant>): () => void {
    const pending = new Map<string, NodeJS.Timeout>();
    let watcher: FSWatcher;
    try {
      // Recursive: asset changes in <id>/assets/ reload their tenant too.
      watcher = watch(this.dir, { recursive: true }, (_event, changed) => {
        if (!changed) return;
        const id = changed.split(/[\\/]/)[0]?.replace(/\.ya?ml$/, '');
        if (!id) return;
        clearTimeout(pending.get(id));
        // Editors write files in several steps: wait until it settles.
        pending.set(
          id,
          setTimeout(() => {
            pending.delete(id);
            void this.#reload(id, registry);
          }, 250),
        );
      });
    } catch (error) {
      this.log.error({ err: String(error) }, 'tenant config hot reload unavailable');
      return () => undefined;
    }
    return () => {
      watcher.close();
      for (const timer of pending.values()) clearTimeout(timer);
    };
  }

  async #reload(id: string, registry: Map<string, Tenant>): Promise<void> {
    const name = (await tenantFiles(this.dir)).find((file) => file.replace(/\.ya?ml$/, '') === id);
    if (!name) {
      if (registry.has(id))
        this.log.error(
          { tenant: id },
          'tenant config file removed; keeping the last valid configuration',
        );
      return;
    }
    const tenant = await this.#loadFile(name, registry.get(id));
    if (tenant) {
      registry.set(tenant.id, tenant);
      this.log.info({ tenant: tenant.id }, 'tenant config reloaded');
    }
  }

  /** Returns the tenant to use, or undefined; logs every problem. */
  async #loadFile(name: string, previous: Tenant | undefined): Promise<Tenant | undefined> {
    let text: string;
    try {
      text = await readFile(join(this.dir, name), 'utf8');
    } catch (error) {
      this.log.error({ file: name, err: String(error) }, 'tenant config unreadable');
      return previous;
    }
    const result = await validateTenant(text, {
      env: this.env,
      fileName: name,
      tenantsDir: this.dir,
    });
    if (result.errors.length === 0) return result.tenant;

    if (previous) {
      // Runtime change with errors: keep the last valid configuration.
      this.log.error(
        { file: name, errors: result.errors },
        'tenant config rejected; keeping the last valid configuration',
      );
      return previous;
    }
    if (result.tenant) {
      this.log.error(
        { file: name, errors: result.errors },
        'tenant config has errors; invalid sections use defaults',
      );
      return result.tenant;
    }
    this.log.error(
      { file: name, errors: result.errors },
      'tenant config rejected; tenant unavailable',
    );
    return undefined;
  }
}

/** Strict loader for tests: every file must be valid. */
export async function loadTenants(dir: string, env: Env): Promise<Map<string, Tenant>> {
  const tenants = new Map<string, Tenant>();
  for (const name of await tenantFiles(dir)) {
    const tenant = await parseTenant(await readFile(join(dir, name), 'utf8'), env, name, dir);
    if (tenants.has(tenant.id)) {
      throw new TenantConfigError(`${name}: duplicate tenant id "${tenant.id}"`);
    }
    tenants.set(tenant.id, tenant);
  }
  if (tenants.size === 0) {
    throw new TenantConfigError(`No tenant configuration found in ${dir}`);
  }
  return tenants;
}
