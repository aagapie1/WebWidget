# ADR 009 — Built-in icons and avatars (Lucide)

Date: 2026-11-18. Status: accepted (E4b.1 UX, P1).

## Context

The admin interface offers a set of launcher icons and generic avatars, chosen visually. Rule 8
forbids fetching anything from third parties in the browser, so the icons must be bundled.

## Decision

- **Lucide** (`lucide`, ISC license; copy in `widget/src/shared/icons/LICENSE-lucide.txt`).
  - Only the named icons are imported (`sideEffects: false`), from one module:
    `widget/src/shared/icons`. The loader, the chat app and the admin interface all use it.
  - Elements are built with `createElementNS` (no `innerHTML`).
  - Launcher icons:
    - `chat`: the existing launcher icon, unchanged and drawn by the loader;
    - `chat-dots`, `help`, `info`, `headset`, `landmark`, `sparkles`.
  - Avatar icons: `bot`, `sparkles`, `landmark`, `headset` (assistant); `person` (visitor).
  - The names live in `gateway/src/protocol/icons.ts`, shared by the schema, the protocol and the
    widget.
- **Schema (version 1, optional fields only):**
  - `launcher.icon` builtin takes the new names;
  - `identity.assistantAvatar` / `identity.userAvatar` are
    `{ type: 'asset' | 'builtin' | 'initials' | 'none' }`. The old forms stay valid: a bare file
    name is an image, and `userAvatar: none` means no avatar.
  - Without an assistant avatar, the initials of the assistant name are shown on the accent
    color. This is the new default; before, it was a generic robot icon.
  - The visitor's "initials" are "Tu" / "You", since visitors are anonymous.
- **Protocol:**
  - `widget-config.identity` describes each avatar as `{ kind: 'image' | 'icon' | 'initials' |
'none' }`. An image that is missing at runtime falls back to the initials.
  - `loader-config.launcher.icon` carries a built-in name.

## Consequences

- Bundle cost: loader.js 12.9 → 13.6 KB gzip (budget 15 KB); chat app 52.5 → 53.3 KB (budget
  120 KB).
- Adding an icon means importing it in the shared module and adding its name to the protocol.
