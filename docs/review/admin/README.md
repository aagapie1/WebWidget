# Admin interface — review screenshots

Captured on the e2e test tenant ("Pilot e2e", no client data; its logo is a generated test image)
with:

```
E2E_ADMIN=1 REVIEW=1 pnpm --filter e2e exec playwright test admin-review --project chromium
```

P2 frame (header with the client's brand and user menu, status bar, sidebar of areas, form, preview
on a sample page). One area is shown at a time. Controls: [controls.md](controls.md).

| File                                                         | What it shows                                                                                                                                                   |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `login-org-known.png`                                        | Sign-in with a known organisation (`?org=pilot`): its name, the redirect sentence, one button, "Altă organizație?"; test organisations below (development only) |
| `login-fallback.png`                                         | Unknown organisation in the link: the code field, with the reason                                                                                               |
| `keycloak-pilot-ro.png`                                      | Keycloak sign-in, theme `widget-admin`: Romanian, the realm's name and logo (from the realm attribute)                                                          |
| `1280x720-identitate.png`, `1440x900-…`, `1920x1080-…`       | Aspect → Identitate; the preview window is open                                                                                                                 |
| `1280x720-culori.png`, `1440x900-culori.png`, `1920x1080-…`  | Aspect → Culori: main colors, automatic values, "Culori avansate" folded                                                                                        |
| `1280x720-integrare.png`, `1440x900-integrare.png`, `1920x…` | Integrare pe site: code, checklist with ✓ / ⚠, installation check                                                                                               |
| `1280x720-launcher.png`                                      | Editing the launcher: the window closes, the launcher stays in view                                                                                             |
| `1280x720-phone.png`                                         | Phone frame 390x844, scaled to fit                                                                                                                              |
| `1100x800-panel-closed.png`, `1100x800-panel-open.png`       | Below 1280 px: the preview is a side panel, opened with "Previzualizare"                                                                                        |
| `1024x768-culori.png`, `1024x768-preview-open.png`           | Tablet, landscape: sidebar and form; the preview panel open                                                                                                     |
| `768x1024-identitate.png`                                    | Tablet, portrait: the areas as a horizontal row, faded where more follow                                                                                        |
| `controls.png`                                               | The controls reference: header, status bar, a list with secondary and quiet buttons                                                                             |

The test also checks, at each size and view, that the preview ends inside the window.
