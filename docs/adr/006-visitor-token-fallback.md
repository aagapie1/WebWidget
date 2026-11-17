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
- The iframe keeps the token in memory **and in ** (key
  ), decided by the product owner on 2026-11-17. Only this signed
  identifier is stored, never conversation content (CLAUDE.md: no history on the device). The
  storage is per tab, partitioned per embedding site, and cleared when the tab closes. If storage
  is unavailable the token stays in memory.
- Same-origin requests only (the iframe and the API share the gateway origin); no CORS change.

## Consequences

- Browsers that keep the partitioned cookie (Chromium, Firefox): unchanged, history survives
  reloads and new visits for .
- Browsers that block it (Safari/WebKit): conversations, history across reloads and answers
  received while away work **within the same tab**; a new tab or a later visit starts a new
  anonymous visitor. The e2e suite runs the reload tests on WebKit too.
- A script running inside the iframe could read the token (unlike an HttpOnly cookie). The
  iframe only renders sanitized content (rule 2, strict CSP), and the token gives access only to
  that anonymous visitor's conversations.
