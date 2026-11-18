import * as client from 'openid-client';
import type { AdminRealm } from './auth-config.js';

export interface AuthorizationRequest {
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}

export interface CodeExchangeChecks {
  codeVerifier: string;
  state: string;
  nonce: string;
}

export interface ExchangeResult {
  /** Validated ID token claims (signature, iss, aud, exp, nonce checked by openid-client). */
  claims: Record<string, unknown>;
  idToken: string | undefined;
}

/** The OIDC operations the admin login needs; replaceable in tests. */
export interface OidcClient {
  authorizationUrl(realm: AdminRealm, request: AuthorizationRequest): Promise<URL>;
  exchange(
    realm: AdminRealm,
    callbackUrl: URL,
    checks: CodeExchangeChecks,
  ): Promise<ExchangeResult>;
  endSessionUrl(
    realm: AdminRealm,
    params: { idToken: string | undefined; postLogoutRedirectUri: string },
  ): Promise<URL | undefined>;
}

/**
 * Authorization code flow with PKCE (S256), state and nonce, as a confidential client
 * (BFF, ADR 008). Discovery is cached per realm; a failed discovery is retried on the next login.
 */
export class OpenIdClient implements OidcClient {
  readonly #configs = new Map<string, Promise<client.Configuration>>();

  /** `allowHttp`: development only (local Keycloak on http://localhost). */
  constructor(private readonly allowHttp: boolean) {}

  #config(realm: AdminRealm): Promise<client.Configuration> {
    let pending = this.#configs.get(realm.org);
    if (!pending) {
      const insecure = this.allowHttp && realm.issuer.startsWith('http:');
      pending = client.discovery(
        new URL(realm.issuer),
        realm.clientId,
        { client_secret: realm.clientSecret },
        client.ClientSecretBasic(realm.clientSecret),
        // Development only: the local Keycloak runs on http://localhost (never in production).
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        insecure ? { execute: [client.allowInsecureRequests] } : undefined,
      );
      pending.catch(() => this.#configs.delete(realm.org));
      this.#configs.set(realm.org, pending);
    }
    return pending;
  }

  async authorizationUrl(realm: AdminRealm, request: AuthorizationRequest): Promise<URL> {
    const config = await this.#config(realm);
    return client.buildAuthorizationUrl(config, {
      redirect_uri: request.redirectUri,
      scope: 'openid profile',
      code_challenge: request.codeChallenge,
      code_challenge_method: 'S256',
      state: request.state,
      nonce: request.nonce,
    });
  }

  async exchange(
    realm: AdminRealm,
    callbackUrl: URL,
    checks: CodeExchangeChecks,
  ): Promise<ExchangeResult> {
    const config = await this.#config(realm);
    const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: checks.codeVerifier,
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims) throw new Error('no ID token in the token response');
    return { claims: { ...claims }, idToken: tokens.id_token };
  }

  async endSessionUrl(
    realm: AdminRealm,
    params: { idToken: string | undefined; postLogoutRedirectUri: string },
  ): Promise<URL | undefined> {
    const config = await this.#config(realm);
    if (!config.serverMetadata().end_session_endpoint) return undefined;
    return client.buildEndSessionUrl(config, {
      post_logout_redirect_uri: params.postLogoutRedirectUri,
      client_id: realm.clientId,
      ...(params.idToken ? { id_token_hint: params.idToken } : {}),
    });
  }
}

export const pkce = {
  verifier: (): string => client.randomPKCECodeVerifier(),
  challenge: (verifier: string): Promise<string> => client.calculatePKCECodeChallenge(verifier),
};
