/**
 * Loader styles, scoped by the Shadow DOM. Same tokens as the chat app; per-tenant theming
 * arrives in E4 (custom properties are the extension point).
 */
export const LOADER_CSS = `
:host {
  --cw-accent: #3a36d0;
  --cw-accent-2: #1166c4;
  --cw-gradient: linear-gradient(135deg, var(--cw-accent) 0%, var(--cw-accent-2) 100%);
  --cw-on-accent: #ffffff;
  --cw-focus: #2c2aa8;
  --cw-offset: 24px;
  all: initial;
}
.launcher {
  position: fixed;
  right: var(--cw-offset);
  bottom: var(--cw-offset);
  z-index: 2147483000;
  width: 60px;
  height: 60px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--cw-on-accent);
  background: var(--cw-gradient);
  box-shadow: 0 8px 24px rgb(58 54 208 / 0.45), 0 2px 6px rgb(0 0 0 / 0.15);
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.launcher:hover {
  transform: translateY(-2px) scale(1.04);
  box-shadow: 0 12px 28px rgb(58 54 208 / 0.55), 0 2px 6px rgb(0 0 0 / 0.15);
}
.launcher:focus-visible {
  outline: 3px solid var(--cw-focus);
  outline-offset: 4px;
}
.launcher svg {
  transition: transform 0.2s ease;
}
.launcher[aria-expanded='true'] svg {
  transform: rotate(180deg);
}
.panel {
  position: fixed;
  right: var(--cw-offset);
  bottom: calc(var(--cw-offset) + 76px);
  z-index: 2147483000;
  width: 380px;
  height: min(640px, calc(100vh - 130px));
  border-radius: 20px;
  overflow: hidden;
  background: #ffffff;
  box-shadow: 0 24px 60px rgb(16 24 40 / 0.22), 0 6px 18px rgb(16 24 40 / 0.12);
  transform-origin: bottom right;
  animation: cw-open 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
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
@keyframes cw-open {
  from { opacity: 0; transform: translateY(12px) scale(0.97); }
  to { opacity: 1; transform: none; }
}
@media (max-width: 480px) {
  .panel {
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: 0;
  }
  /* Full-screen window: the launcher would cover the send button. The header's minimize button
     (and Escape) close it; the launcher comes back, focused, when the window is hidden. */
  .launcher[aria-expanded='true'] {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .launcher, .launcher svg, .panel { transition: none; animation: none; }
  .launcher:hover { transform: none; }
}
@media (forced-colors: active) {
  .launcher { border: 2px solid ButtonText; }
}
`;
