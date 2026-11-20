# ADR 010 — Loader styles without `style-src 'unsafe-inline'`

Date: 2026-11-18. Status: accepted, **implemented in E5 A1 (2026-11-20)**.

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

## Implementation (E5 A1)

- `widget/src/loader/stylesheet.ts`: `attachStyles()` adopts a constructed sheet with
  `LOADER_CSS`. Where `adoptedStyleSheets` or `CSSStyleSheet` is missing, or filling the sheet
  throws, it prepends `<link rel="stylesheet" href="<gateway>/w/loader.css?v=<version>">` to the
  Shadow DOM. The loader no longer creates a `<style>` element.
- **One source:** the loader build writes `dist/loader.css` from the same `LOADER_CSS`. The `?v=`
  value is a short FNV-1a hash of that text, computed by the loader at run time. A changed text
  gets a new URL, so a cached old file is never applied, and the build needs no hashed file name.
  The gateway serves `/w/loader.css` like `loader.js` (5-minute cache,
  `Cross-Origin-Resource-Policy: cross-origin`, `nosniff`).
- Per-tenant values stay CSSOM properties on the host (`style.setProperty`), as decided above.
  The strict-CSP test confirms they raise no violation. No markup in the loader or the chat app
  carries a `style` attribute, and the sanitizer drops `style` from model output.
- The chat iframe already had `style-src 'self'` without `'unsafe-inline'`. The same test checks
  it for violations.
- "Integrare pe site" lists `script-src`, `style-src`, `frame-src`, `connect-src` and `img-src`
  for the gateway, and says that `'unsafe-inline'` is not needed.
- `loader.js`: 14.1 KB gzip (13.9 before; budget 15).
- Not changed: the admin preview page (`/admin/preview`, our own page, not a client site) keeps
  `style-src 'unsafe-inline'` for the layout of its sample page.

## Verification done

- e2e `e2e/tests/strict-csp.spec.ts` on `/strict.html`, with the brand tenant (image launcher icon,
  its own colors, launcher on the left, 400 px window, proactive message). The test builds the
  page's policy from `cspFor()` (`admin/src/csp.ts`), the same list "Integrare pe site" shows:
  1. `default-src 'none'` + that list (+ `base-uri`, `form-action` `'none'`);
  2. the most restrictive variant: `default-src 'self'` + exactly that list, nothing else.

  For each policy, two style paths: a constructed sheet (one adopted sheet, no `<style>`, no
  `<link>`), and the file fallback, forced by removing `adoptedStyleSheets` from the page
  (`/w/loader.css?v=…` loads with 200; one `<link>`, no `<style>`). That makes 4 tests per browser.

- Each test asserts, explicitly:
  - The CSP header received equals the policy. Its directives are exactly the expected ones,
    `style-src` and `script-src` are only the gateway, and it contains neither `'unsafe-inline'`
    nor `'unsafe-eval'`.
  - The launcher has the loader styles applied: fixed, round, in the tenant's accent, on the left.
    Its image icon is loaded and sized (34 px, `contain`).
  - The proactive message appears after its delay, as a fixed, styled card with a 32 px close
    button.
  - The window opens fixed at the tenant's 400 px width. The chat answers, and the visitor's
    bubble has the tenant's color (the iframe's CSS and theme applied).
  - No CSP violation is reported, whether through `securitypolicyviolation` in the page and in the
    chat iframe or through the console.

- The test pages set their favicon to a gateway URL. Browsers request a favicon by themselves
  (Firefox did, and CI reported the page's own `/favicon.ico` blocked), and the page's own icon
  would need an `img-src 'self'` that is not in the list.
- Results: all 4 pass in Chromium and WebKit locally, and in the three CI browsers.
- Controls: an inline `<style>` added to the strict page is reported by the same watcher
  (`style-src-elem`, in Chromium and WebKit). With the previous loader (a `<style>` element) all 4
  tests fail.
- Unit tests: `widget/src/loader/stylesheet.test.ts` covers both paths and the versioned URL;
  `gateway/test/widget-serving.test.ts` covers the file's headers.
