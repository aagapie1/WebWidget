# ADR 012 — Automatic colors, computed in the gateway

Date: 2026-11-19. Status: accepted (E4b.1 UX 9 and 10, option A of the P2 plan).

## Context

An administrator chooses one main color. Today the text on it, the links and the header's second
color keep fixed defaults, so a light or a green main color easily fails the WCAG AA contrast
checks, and the admin form shows twelve colors at once.

## Decision

- `theme.accentEnd`, `theme.onAccent` and `theme.link` are optional. When unset, the gateway
  derives them (`resolveTheme`, shared schema code):
  - `accentEnd`: the main color (a flat header); the default pair when no main color is set;
  - `onAccent`: white or black, whichever keeps more contrast against both header colors;
  - `link`: the main color, darkened in 5% steps until it reaches 4.5:1 against the background
    and the assistant bubble; the default link color when no main color is set.
- The admin interface computes the same values with the same function, and shows them as
  "Automat: #…", with "Fixează valoarea" (store it) and "Revino la automat" (remove it). The main
  color and the header's second color are shown at once; the others are under "Culori avansate",
  which opens by itself when one of them has an error.
- **New:** `launcher.color`, the launcher's own flat color (unset: the main color's gradient). It
  must reach 3:1 against a white page (WCAG 1.4.11). The icon on it is white or black, whichever
  contrasts more (any color reaches at least 4.58:1 with one of them). The loader receives
  `launcher.color` and `launcher.onColor` in `loader-config`.

## Consequences

- A tenant that sets only `accent` gets a flat header and links derived from it after deploy.
  None of the current tenant files is in that case (`demo-primarie` and the e2e tenants set their
  colors; `pilot` sets none and keeps the defaults).
- Values that are set always win, so an existing configuration never loses a choice.
