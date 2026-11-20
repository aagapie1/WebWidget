/**
 * Content-Security-Policy additions for client sites that have one, as "Integrare pe site" shows
 * them. No 'unsafe-inline': the loader styles itself through CSSOM, and `style-src` lets older
 * browsers load the same CSS as a file (ADR 010). Plain TypeScript (no JSX): the e2e strict-CSP
 * test builds its client page from this same list.
 */
export function cspFor(gatewayOrigin: string): string[] {
  return [
    `script-src ${gatewayOrigin}`,
    `style-src ${gatewayOrigin}`,
    `frame-src ${gatewayOrigin}`,
    `connect-src ${gatewayOrigin}`,
    `img-src ${gatewayOrigin}`,
  ];
}
