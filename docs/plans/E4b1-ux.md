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

## P2 — simplification and design (detailed plan, after the layout change of 0743313)

Already done in the layout change: the sticky status bar (state, contrast indicator, "Renunță",
"Publică"), the preview column at real size scaled to fit, the side panel under 1280 px, and
the names on two columns.

**[SCHEMA]** marks configuration changes. **[DECIDE]** marks a choice to confirm before
implementing.

### 8. Structure and look inspired by the Dify console (no code, icons or branding copied)

- **One header:** the logo and name of the client's assistant (not the code "pilot"), the tenant
  switcher for super-admin, the user and the language. The status bar (state, contrast,
  "Renunță", "Publică") stays sticky right below it.
- **Left sidebar** with an icon and a name per area:
  - Aspect: identity, launcher, window and colors;
  - Texte și întrebări;
  - Mesaj proactiv;
  - Citări;
  - Comportament;
  - Domenii permise;
  - Integrare pe site.

  One area is shown at a time, so there is less scrolling; the URL keeps the area (`#aspect`…).
  The sidebar marks:
  - a dot on areas with unpublished changes (sections that differ from the published version);
  - a red marker with the number of errors.

  Keyboard: the sidebar is a list of links; the current one has `aria-current="page"`.

- **Optional features as rows:** icon, title, one sentence of description, and a switch
  (`role="switch"`). This covers the proactive message, questions after the answer and
  fragments in citations. The settings of a feature open under its row only when it is on.
- **Visual:**
  - very light grey background, white cards with rounded corners and a subtle shadow;
  - compact controls and a single accent color, AA contrast checked with axe;
  - **Inter** (SIL OFL license, woff2 file served from `/admin/assets`, license in the repo).
    It is used only by the admin interface; the widget is unchanged.

### 9. Colors

- **Default view:**
  - "Culoarea principală" plus an optional "A doua culoare a antetului (gradient)".
  - The text on the main color, the links and the buttons are computed automatically: white or
    black text, whichever has more contrast; links darkened until they reach 4.5:1 on white.
- **"Culori avansate"** (folded): the other colors. "Resetează" appears only when a value differs
  from the computed or default one.
- The contrast error appears next to the affected pair; the link from the status bar (already
  there) leads to it.
- **[SCHEMA] [DECIDE]** where the automatic colors are computed:
  - **A — in the gateway** (shared schema code). Colors that are not set are derived from the
    main color at load time.
    - Cost: tenants that set only `accent` change their links/text after deploy (today they get
      the fixed defaults).
    - Benefit: always consistent, and the same code in the admin interface and the gateway.
  - **B — in the admin interface:** when the main color changes, it writes the derived colors
    into the draft (except the ones changed by hand in "Culori avansate").
    - Cost: what was derived and what was chosen by hand is not stored; to remember it, the
      draft would need an extra field.

  **Recommendation: A**, with an entry in the release notes; existing tenants keep their
  explicit colors.

### 10. Every element configured in one place

- **[SCHEMA]** `launcher.color` (optional; default `theme.accent`).
  - Checked for 3:1 against white (the button on a page) and for 4.5:1 for its icon.
  - The loader receives it in `loader-config`.
- The launcher color moves into "Buton de pornire"; "Culoare principală" applies only to the
  window.

### 11. Texts

- Română / English as tabs (a `tablist` with arrow keys) instead of two blocks.
- Under each image, where it appears: "Logo: în antetul ferestrei", "Avatarul asistentului:
  lângă răspunsuri", "Avatarul utilizatorului: lângă întrebările vizitatorului".

### 12. Language for civil servants

- The 4 phrasings from the feedback, plus a pass over all the texts. No "Dify", "cookie",
  "model" or "CSP" in labels; technical details only where needed, in the integration
  checklist.

### 13. Citations

- **Documents to choose from:** the app key has no access to the Dify Knowledge API (that needs
  a separate dataset key). Proposal:
  - the gateway records the names of the cited documents (from the answers, in the
    normalization) per tenant in Redis. These are document names, not personal data; 90 days.
  - A search field offers them; the administrator writes only the displayed title.
  - **[DECIDE]** whether a knowledge-base key per tenant is also wanted (server configuration,
    like the Dify key) for the full list.
- "Afișează fragmentul" stays off by default, as it already is.

### 14. Allowed domains

- A list with "Adaugă" and "Elimină" on each row, validated on each row (bare domain, no path).
- **[SCHEMA]** `https` is mandatory, except `http://localhost` / `127.0.0.1`.
  - Checked in the gateway: validation only, existing YAML files stay valid if they comply.
  - The e2e and dev tenants use localhost.
- Confirmation on removal: "asistentul se va opri pe <domeniu>".
- `widget-editor` no longer sees the section (today it is read-only). The server already refuses
  changes from an editor (tested).

### 15. "Numele clientului"

- Only `super-admin` can edit it: read-only text for the others, and the server refuses a change
  from another role (403, like the domains). Tests on the API and in e2e.

### P2 order (one commit per item, with tests; screenshots in docs/review/admin updated)

1. 12 and 11 (texts and tabs: small, low risk).
2. 15 and 14 (rights and domains: server + interface).
3. 10 and 9 (colors: after decision A/B).
4. 13 (citations: after the knowledge-base key decision).
5. 8 (sidebar, header, rows with switches, Inter), last: it moves all the content around.

## Order of work

P1 in four commits, each with its tests:

- (a) schema, protocol and widget (icons, avatars, questions, preview mode);
- (b) preview: sample conversation, states, following the edited section;
- (c) admin interface: status, discard, values, dependent fields, icon/avatar grid, questions,
  integration (with installation detection);
- (d) e2e for the new flows and the widget bundle budgets.
