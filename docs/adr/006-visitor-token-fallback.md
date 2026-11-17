# ADR 006 — Visitor token when the browser blocks iframe cookies

Status: accepted (E3) · 2026-11-17 · amends ADR 002

## Problem

WebKit (Safari) did not keep the visitor cookie set inside the chat iframe (third-party
context), not even the `Partitioned` one — confirmed by the e2e tests in CI. Every request then
got a new visitor id, so Dify answered "conversation not found" from the second question on:
multi-turn conversations broke, closing feedback was refused, history was empty.

## Decision

- When the gateway issues a visitor id it also returns the same signed value in the
  `X-Visitor-Token` response header. Requests may carry it back in `X-Visitor-Token`; the cookie
  wins when both are present. Forged or malformed values are ignored (same signature check).
- The iframe keeps the token **in memory only** (`GatewayTransport`), never in `localStorage` or
  `sessionStorage`. A conversation works for as long as the page stays open in every browser.
- Same-origin requests only (the iframe and the API share the gateway origin); no CORS change.

## Consequences

- Browsers that keep the partitioned cookie (Chromium, Firefox): unchanged, history survives
  reloads for `visitorCookieDays`.
- Browsers that block it (Safari/WebKit): conversations work within the page; history across
  reloads and "answers received while away" are **not** available. The e2e tests that need a
  reload are skipped on WebKit with this reason.
- A script running inside the iframe could read the token (unlike an HttpOnly cookie). The
  iframe only renders sanitized content (rule 2, strict CSP), and the token gives access only to
  that anonymous visitor's conversations.

## Open question (for the product owner)

Keeping the token in `sessionStorage` would restore history across reloads in the same Safari
tab (storage is partitioned per embedding site and cleared when the tab closes). It is an
identifier, not conversation content, but CLAUDE.md asks not to keep conversation data on the
device. Not done until decided.
