# ADR 004 — Widget architecture and interaction decisions (E2)

Status: accepted (E2) · 2026-11-17

## Serving and development

- The gateway serves `/w/loader.js`, `/w/app` and `/api/*` from one origin. The chat iframe and
  the API share that origin: no CORS, first-party fetches from the iframe.
- `/w/app?tenant=<id>&parent=<origin>`: `parent` must be one of the tenant's `allowedOrigins`
  (403 otherwise). The response sets `Content-Security-Policy` with `frame-ancestors` = the
  tenant's `allowedOrigins`, `default-src 'self'`, `img-src 'self' data:`, `connect-src 'self'`.
- Development mirrors production: `vite build --watch` writes `widget/dist`, the gateway serves it
  on `:3000`, and the demo "client site" is a separate origin (`:5173/demo.html`).

## Loader ↔ iframe

- `loader.js` is plain TypeScript (no Preact) rendered in a Shadow DOM: launcher button and the
  iframe container.
- `postMessage` in both directions: the receiver checks `event.origin` (loader: the gateway origin
  taken from its own `src`; iframe: the validated `parent`) and validates the payload with a Zod
  schema. Messages are sent with an explicit `targetOrigin`, never `*`.

## Preloading the iframe

- The hidden iframe is created when the page is idle (`requestIdleCallback`, at most ~2 s after
  load) or earlier on intent: pointer over, keyboard focus or touch on the launcher.
- Reason: browsers reliably move focus into a cross-origin iframe only during the user's click,
  and only if the frame is already loaded. Focusing it after an async load left the input
  "focused but inactive" in WebKit, and extra `contentWindow.focus()` calls made Chromium flaky.
  Preloading also makes the window open instantly.
- Cost: every page view loads the app bundle (cached, immutable) and `/api/widget-config` (Dify
  `/parameters` cached 5 minutes per replica). No cookie is set until the first message.
- If the user opens the chat before the preload finishes, focus is moved on `ready` as a best
  effort.

## Window behaviour

- One window control: **minimize** (chevron down, “Minimizează fereastra”). It only hides the
  window and keeps the conversation. An earlier `X` button was removed: it did the same thing and
  suggested that it would end the conversation.
- A new conversation starts only from an explicit **“Conversație nouă”** button in the header. In
  E3 it becomes **“Închide conversația”**, followed by the feedback form.
- **Escape** minimizes the window and returns focus to the launcher button.
- The window is not modal: no focus trap. The host page stays usable while the chat is open.
- The conversation lives in the iframe's memory in E2; history across reloads arrives in E3 (from
  the gateway, never `localStorage`).

## Accessibility of streamed answers

- The message list has **no** `aria-live`: screen readers would read every delta.
- The message being generated has `aria-busy="true"`.
- When the answer completes (`end`, stop or error), its full text is announced **once** through a
  separate, visually hidden `aria-live="polite"` region.

## Markdown

- `marked` → DOMPurify, re-rendered at most once per animation frame while streaming.
- Links get `target="_blank"` and `rel="noopener noreferrer"`; `javascript:` and other unsafe
  URLs are removed.
- **Images are removed**: a model-provided image URL would make the browser contact a third party
  (CLAUDE.md rule 8).

## Bundle size

- The shared protocol is written with `zod/mini` so the loader (< 15 KB gzip) and the app
  (< 120 KB gzip) stay within budget. Sizes are checked at build time.

## Unchanged from E1

- `/api/chat` always sends `auto_generate_name: false` to Dify; the strict request schema rejects
  any attempt from the browser to set it.
