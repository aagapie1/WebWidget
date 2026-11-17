/**
 * Loader styles, scoped by the Shadow DOM. Neutral theme with AA contrast; per-tenant theming
 * arrives in E4 (custom properties are already the extension point).
 */
export const LOADER_CSS = `
:host {
  --cw-accent: #0b5cad;
  --cw-accent-contrast: #ffffff;
  --cw-focus: #ffbf47;
  --cw-offset: 20px;
  all: initial;
}
.launcher {
  position: fixed;
  right: var(--cw-offset);
  bottom: var(--cw-offset);
  z-index: 2147483000;
  width: 56px;
  height: 56px;
  border: 0;
  border-radius: 50%;
  background: var(--cw-accent);
  color: var(--cw-accent-contrast);
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.25);
  cursor: pointer;
  display: grid;
  place-items: center;
  padding: 0;
}
.launcher:focus-visible {
  outline: 3px solid var(--cw-focus);
  outline-offset: 3px;
}
.panel {
  position: fixed;
  right: var(--cw-offset);
  bottom: calc(var(--cw-offset) + 68px);
  z-index: 2147483000;
  width: 380px;
  height: min(600px, calc(100vh - 120px));
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 8px 28px rgb(0 0 0 / 0.28);
  background: #ffffff;
}
.panel[hidden] {
  display: none;
}
.frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}
@media (max-width: 480px) {
  .panel {
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: 0;
  }
}
@media (forced-colors: active) {
  .launcher {
    border: 2px solid ButtonText;
  }
}
`;
