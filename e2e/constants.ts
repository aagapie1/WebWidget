/** Origins used by the end-to-end tests (see servers.mjs and tenants/e2e.yaml). */
export const GATEWAY = 'http://localhost:3101';
export const SITE = 'http://127.0.0.1:5180';
export const FORBIDDEN_SITE = 'http://127.0.0.1:5181';
export const DIFY = 'http://127.0.0.1:4010';
export const DIFY_KEY = 'app-e2e-secret-key-never-in-browser';

/**
 * Admin interface e2e (E4b.1): a second gateway with Postgres, Redis and the development
 * Keycloak (`pnpm services:up` locally, service containers in CI). Off unless E2E_ADMIN=1.
 */
export const ADMIN_E2E = process.env.E2E_ADMIN === '1';
export const ADMIN = 'http://localhost:3200';
