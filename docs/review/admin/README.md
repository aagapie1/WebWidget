# Admin interface — review screenshots

Captured on the e2e test tenant ("Pilot e2e", no client data) with:

```
E2E_ADMIN=1 REVIEW=1 pnpm --filter e2e exec playwright test admin-review --project chromium
```

P2 frame (header with the client's brand and user menu, status bar, sidebar of areas, form, preview
on a sample page). One area is shown at a time.

| File                                                         | What it shows                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `1280x720-identitate.png`, `1440x900-…`, `1920x1080-…`       | Aspect → Identitate; the preview window is open                          |
| `1280x720-culori.png`, `1440x900-culori.png`, `1920x1080-…`  | Aspect → Culori (sub-link: scrolls to the section, under the status bar) |
| `1280x720-integrare.png`, `1440x900-integrare.png`, `1920x…` | Integrare pe site: code, checklist with ✓ / ⚠, installation check        |
| `1280x720-launcher.png`                                      | Editing the launcher: the window closes, the launcher stays in view      |
| `1280x720-phone.png`                                         | Phone frame 390x844, scaled to fit                                       |
| `1100x800-panel-closed.png`, `1100x800-panel-open.png`       | Below 1280 px: the preview is a side panel, opened with "Previzualizare" |

The test also checks, at each size and view, that the preview ends inside the window.
