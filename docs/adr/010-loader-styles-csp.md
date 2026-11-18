# ADR 010 — Loader styles without `style-src 'unsafe-inline'`

Date: 2026-11-18. Status: accepted. Implementation: **E5, mandatory before the first public
client**.

## Context

loader.js runs on the client's site and puts its styles in a `<style>` element inside its
Shadow DOM. A site with a strict Content-Security-Policy must then allow
`style-src 'unsafe-inline'` for the whole site. Public institutions often refuse that, and
"Integrare pe site" (E4b.1 UX) currently has to ask for it.

## Options

1. **CSS file served by the gateway** (`/w/loader.css`, `<link rel="stylesheet">` in the Shadow
   DOM). The site only allows the gateway in `style-src`. Costs one more request before the
   launcher is styled, and the file must be cached and versioned like loader.js.
2. **Constructable Stylesheets** (`new CSSStyleSheet()`, `replaceSync`, then
   `shadowRoot.adoptedStyleSheets`). These go through CSSOM, which `style-src` does not restrict:
   no extra request, and nothing to allow. Available in all current browsers (Safari from 16.4).

## Decision

- **Option 2**, with option 1 as the fallback where `adoptedStyleSheets` is missing. The CSS file
  is the same text, served by the gateway with the loader's cache rules.
- The variables per tenant (colors, offsets, sizes) stay CSSOM properties on the host element
  (`style.setProperty`), which CSP does not restrict either.
- "Integrare pe site" then lists `style-src <gateway>` (needed only for the fallback) instead of
  `'unsafe-inline'`. The note about `'unsafe-inline'` is removed.

## Verification (E5)

- An e2e test with a client page whose header sets `default-src 'self'`,
  `script-src <gateway>`, `style-src <gateway>`, `frame-src <gateway>` and
  `connect-src <gateway>`. The launcher must be styled and the window must open.
- It must run in Chromium, Firefox and WebKit, with no CSP violation in the console.
