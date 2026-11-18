/**
 * Loader styles, scoped by the Shadow DOM. The tenant's colors, position and window size arrive
 * as custom properties set on the host element (ADR 007).
 */
export const LOADER_CSS = `
:host {
  --cw-accent: #3a36d0;
  --cw-accent-2: #1166c4;
  --cw-on-accent: #ffffff;
  --cw-gradient: linear-gradient(135deg, var(--cw-accent) 0%, var(--cw-accent-2) 100%);
  --cw-focus: #2c2aa8;
  --cw-offset-x: 24px;
  --cw-offset-y: 24px;
  --cw-width: 380px;
  --cw-height: 640px;
  all: initial;
}
.launcher {
  position: fixed;
  right: var(--cw-offset-x);
  bottom: var(--cw-offset-y);
  z-index: 2147483000;
  width: 60px;
  height: 60px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--cw-on-launcher, var(--cw-on-accent));
  background: var(--cw-launcher, var(--cw-gradient));
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.25), 0 2px 6px rgb(0 0 0 / 0.15);
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.launcher:hover {
  transform: translateY(-2px) scale(1.04);
  box-shadow: 0 12px 28px rgb(0 0 0 / 0.3), 0 2px 6px rgb(0 0 0 / 0.15);
}
.launcher:focus-visible {
  outline: 3px solid var(--cw-focus);
  outline-offset: 4px;
}
.launcher__icon {
  display: grid;
  place-items: center;
}
.launcher[aria-expanded='true'] .launcher__icon--open,
.launcher[aria-expanded='false'] .launcher__icon--close {
  display: none;
}
.launcher__image {
  width: 34px;
  height: 34px;
  object-fit: contain;
  display: block;
}
.panel {
  position: fixed;
  right: var(--cw-offset-x);
  bottom: calc(var(--cw-offset-y) + 76px);
  z-index: 2147483000;
  width: var(--cw-width);
  height: min(var(--cw-height), calc(100vh - 130px));
  max-width: calc(100vw - 2 * var(--cw-offset-x));
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
.proactive {
  position: fixed;
  right: var(--cw-offset-x);
  bottom: calc(var(--cw-offset-y) + 72px);
  z-index: 2147483000;
  max-width: min(300px, calc(100vw - 2 * var(--cw-offset-x)));
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 4px;
  border-radius: 16px;
  background: #ffffff;
  color: #1b1f2a;
  box-shadow: 0 10px 30px rgb(16 24 40 / 0.2), 0 2px 6px rgb(16 24 40 / 0.1);
  font: 15px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  animation: cw-pop 0.25s ease-out;
}
.proactive__text {
  flex: 1;
  padding: 10px 6px 10px 12px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.proactive__close {
  flex: none;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #4f5868;
  cursor: pointer;
}
.proactive__text:hover,
.proactive__close:hover {
  background: #f0f2f8;
}
.proactive__text:focus-visible,
.proactive__close:focus-visible {
  outline: 3px solid var(--cw-focus);
  outline-offset: 1px;
}
:host(.is-left) .launcher,
:host(.is-left) .proactive,
:host(.window-left) .panel {
  right: auto;
  left: var(--cw-offset-x);
}
:host(.window-left) .panel {
  transform-origin: bottom left;
}
@keyframes cw-open {
  from { opacity: 0; transform: translateY(12px) scale(0.97); }
  to { opacity: 1; transform: none; }
}
@keyframes cw-pop {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}
@media (max-width: 480px) {
  .panel,
  :host(.window-left) .panel {
    inset: 0;
    width: 100%;
    height: 100%;
    max-width: none;
    border-radius: 0;
  }
  /* Full-screen window: the launcher would cover the send button. The header's minimize button
     (and Escape) close it; the launcher comes back, focused, when the window is hidden. */
  .launcher[aria-expanded='true'] {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .launcher, .panel, .proactive { transition: none; animation: none; }
  .launcher:hover { transform: none; }
}
@media (forced-colors: active) {
  .launcher, .proactive { border: 2px solid ButtonText; }
}
`;
