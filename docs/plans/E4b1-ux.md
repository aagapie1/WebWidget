# E4b.1 — admin interface UX (P1, P2)

Plan for the feedback on the admin interface. P1 is needed for the demo and comes first; P2 follows
after review. P3 (login, Keycloak theme, final checks) comes after step 6.

**[SCHEMA]** marks configuration schema changes. All of them are new optional fields or new
optional forms of existing fields. `schemaVersion` stays 1, and existing YAML files and published
versions stay valid.

## P1 — needed for the demo (done: 760fdce, 7980f17 and the admin commit after them)

### 1. A preview that shows the effect of changes

- **Gateway:** `widget-config` of a preview tenant adds `preview: true`.
- **Widget app:** in preview it does not load the visitor's history. It shows a sample
  conversation: welcome message, suggested questions, one question, and an answer with a link, a
  citation and the rating buttons. Real questions still work; they are marked `preview-` (ADR
  008).
- **Loader:** with `data-preview` it opens the window when it loads. It also accepts a
  `cw-preview` message from the page that embeds it (same origin as the gateway, `event.source`
  = parent, Zod schema). The message says what to show:
  - `launcher`: window closed;
  - `proactive`: the bubble shown at once, without the delay;
  - `window`: window open.
- **`/admin/preview`:** a small script of its own (no inline code). It passes these messages from
  the admin interface to the loader.
- **Admin interface:**
  - the preview follows the section being edited: Launcher → `launcher`, Proactive message →
    `proactive`, everything else → `window`;
  - it reloads after each autosave (shorter debounce), keeping the chosen state;
  - the preview frame takes the panel's height and stays visible without scrolling;
  - desktop / phone switch.

### 2. Clear publishing state

- Status bar:
  - "Publicat ultima dată: <date, time> de <name>";
  - "Ciornă: salvată la <time>" / "Se salvează…" / "Modificări nesalvate", as a polite live
    region.
- "Publică" is disabled when the draft does not differ from the published version. Confirmation
  lists the changed sections (already there).
- "Renunță la modificări": confirmation dialog, then `DELETE` draft, then the published version
  is reloaded.

### 3. Values vs. suggestions

- Number fields show the effective value in normal text. The default appears only in the help
  text ("Implicit: 24").

### 4. Dependent fields only when they make sense

- The icon upload appears only with "Imagine încărcată".
- The proactive message settings appear only when it is enabled.

### 5. Icons and default avatars

- **[SCHEMA]** `launcher.icon` builtin `name`: `chat` (as today), `chat-dots`, `help`, `info`,
  `headset`, `landmark`, `sparkles`.
- **[SCHEMA]** `identity.assistantAvatar`:
  - `{ type: 'initials' }` (default when absent);
  - `{ type: 'builtin', name: 'bot' | 'sparkles' | 'landmark' | 'headset' }`;
  - `{ type: 'asset', file }`, where a bare file name still means `asset`;
  - `{ type: 'none' }`.
- **[SCHEMA]** `identity.userAvatar`:
  - `{ type: 'none' }` (default; the string `'none'` stays valid);
  - `{ type: 'initials' }`: shows "Tu" / "You", since the visitor is anonymous;
  - `{ type: 'builtin', name: 'person' }` (generic silhouette);
  - `{ type: 'asset', file }`.
- **Icons:** Lucide (ISC). Only the SVG data of the icons used, in a shared module (bundled, no
  network access, rule 8). License in `widget/src/shared/icons/LICENSE-lucide.txt`, plus an ADR
  note for the new dependency. Budgets are checked at build.
- **Protocol:**
  - `loader-config.launcher.icon` = `{ name }` or `{ url }`;
  - `widget-config.identity` describes each avatar as `{ kind: 'initials' | 'icon' | 'image' |
'none', … }`.
- **Admin interface:** a visual grid of icons (radio group, keyboard accessible) with the
  selected one highlighted, and the same for avatars.

### 6. Suggested starter questions

- **[SCHEMA]** `texts.<lang>.suggestedQuestions`: list of 1–5 questions, each 1–200 characters
  (optional).
- **Gateway:**
  - `widget-config` uses the tenant's list when it exists, otherwise the one from Dify;
  - new endpoint `GET /admin/api/tenants/:id/assistant-defaults` returns the welcome message and
    the questions from Dify `/parameters`.
- **Admin interface:**
  - a section per language: editable list (at most 5, 3 recommended), up/down buttons plus drag,
    delete;
  - when the list is empty, the assistant's questions are shown in grey, with "Preia și
    editează".

### 7. Site integration

- **Admin interface:**
  - the code ready to copy (gateway address from the server configuration, the tenant) and a
    "Copiază" button with confirmation;
  - where it goes, the optional attributes (default language) and a live-updated snippet;
  - the checklist: allowed domains (link to the section) and the CSP for sites that have one
    (`script-src`, `frame-src`, `connect-src` = gateway address), generated.
- **"Verifică instalarea":**
  - `loader-config` records in Redis the last load per allowed origin (not for previews), as key
    `install:<tenant>:<origin>` with a 90-day TTL;
  - `GET /admin/api/tenants/:id/installations` returns them for the allowed origins;
  - the screen shows "Widget detectat pe … la …" or "Încă nu a fost detectat".
- No separate CSS: the look comes from the configuration.

## P2 — simplification and design (after P1 review)

8. **Layout like the Dify console** (no copied code, icons or branding):
   - left sidebar with an icon and a name per area: Aspect, Texte și întrebări, Mesaj proactiv,
     Citări, Comportament, Domenii permise, Integrare pe site;
   - a marker on areas with unpublished changes or errors;
   - header with the assistant's name and logo, and the status plus "Publică" on the right;
   - preview as a fixed panel on the right;
   - light grey background, white cards, Inter (bundled locally), one accent color.
9. **Colors:**
   - the default view shows the main color and an optional second color; the rest are computed
     automatically, with white or black text chosen by contrast;
   - the other colors go into a folded "Culori avansate" section;
   - a "Resetează" button appears only when the value differs from the default;
   - the contrast error appears next to the affected pair, with a link to it from the status
     panel.
   - **[SCHEMA]** none: the derived colors are written into `theme` when saving.
10. **Every element in one place:** the launcher color moves to "Buton de pornire".
    - **[SCHEMA]** `launcher.color` (optional, default `theme.accent`), checked for 3:1 contrast
      against white.
11. **Texts:** Română / English tabs; under each image, where it appears.
12. **Plain language:** the wording from the feedback.
13. **Citations:**
    - documents to choose from: the knowledge base via the Dify Knowledge API if the key allows
      it, otherwise the recent citations recorded by the gateway;
    - the administrator types only the display title;
    - "fragment" stays off by default.
14. **Allowed domains:**
    - a list with "Adaugă" / "Elimină" and validation on every line (https outside development);
    - removing a domain asks for confirmation;
    - the section is hidden from `widget-editor`.
15. **"Numele clientului":** only `super-admin` can edit it (checked on the server too).

## Order of work

P1 in four commits, each with its tests:

- (a) schema, protocol and widget (icons, avatars, questions, preview mode);
- (b) preview: sample conversation, states, following the edited section;
- (c) admin interface: status, discard, values, dependent fields, icon/avatar grid, questions,
  integration (with installation detection);
- (d) e2e for the new flows and the widget bundle budgets.
