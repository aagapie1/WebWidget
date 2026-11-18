# Admin interface — review screenshots

Captured on the e2e test tenant ("Pilot e2e", no client data) with:

```
E2E_ADMIN=1 REVIEW=1 pnpm --filter e2e exec playwright test admin-review --project chromium
```

| File                             | What it shows                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `1280x720.png`                   | Top of the page: sticky status bar, form ~58%, preview column (scaled, with %)  |
| `1280x720-scrolled-launcher.png` | Scrolled into the form while editing the launcher: bar and preview stay in view |
| `1280x720-phone.png`             | Phone frame 390x844, scaled to fit                                              |
| `1440x900.png`                   | Form ~55% / preview ~45%                                                        |
| `1920x1080.png`                  | Preview at real size (100%)                                                     |
| `1100x800-panel-closed.png`      | Below 1280 px: the preview is a side panel, opened with "Previzualizare"        |
| `1100x800-panel-open.png`        | The side panel open                                                             |

The test also checks, at each size, that the preview ends inside the window.
