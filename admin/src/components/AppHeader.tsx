import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Role } from '../api.js';
import { useI18n, type Locale } from '../i18n.js';
import { ChevronDown, Landmark } from '../icons.js';
import { initials } from '../model.js';
import { NodeIcon } from './OptionGrid.js';

interface AppHeaderProps {
  /** The client's assistant (not the tenant code). */
  assistantName: string;
  clientName: string;
  /** Admin URL of the client's logo, when there is one. */
  logoUrl?: string | undefined;
  user?: { name: string; role: Role; org: string } | undefined;
  /** Super-admin only: switch between clients. */
  tenants?: readonly string[] | undefined;
  tenant?: string | undefined;
  onTenant?: ((tenant: string) => void) | undefined;
  onLocale: (locale: Locale) => void;
  onLogout?: (() => void) | undefined;
}

/** Header: the client's assistant on the left; language and the user menu on the right. */
export function AppHeader(props: AppHeaderProps) {
  const { t, locale } = useI18n();
  return (
    <header class="app-header">
      <div class="brand">
        <span class="brand__logo" aria-hidden="true">
          {props.logoUrl ? (
            <img src={props.logoUrl} alt="" />
          ) : (
            <NodeIcon node={Landmark} size={18} />
          )}
        </span>
        <span class="brand__text">
          <span class="brand__name">{props.assistantName}</span>
          {props.clientName && (
            <span class="brand__sub">
              {props.clientName} · {t.ux.adminSuffix}
            </span>
          )}
        </span>
      </div>
      <span class="app-header__spacer" />
      {props.tenants && props.tenants.length > 1 && props.onTenant && (
        <span class="app-header__tenant">
          <select
            aria-label={t.ux.tenantLabel}
            value={props.tenant}
            onChange={(event) => {
              props.onTenant?.(event.currentTarget.value);
            }}
          >
            {props.tenants.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </span>
      )}
      <div class="lang" role="group" aria-label={t.language}>
        {(['ro', 'en'] as const).map((value) => (
          <button
            key={value}
            type="button"
            lang={value}
            aria-pressed={locale === value}
            onClick={() => {
              props.onLocale(value);
            }}
          >
            {/* The accessible name starts with the visible code (label in name, WCAG 2.5.3). */}
            {value.toUpperCase()}
            <span class="visually-hidden">{value === 'ro' ? ' – Română' : ' – English'}</span>
          </button>
        ))}
      </div>
      {props.user && props.onLogout && <UserMenu user={props.user} onLogout={props.onLogout} />}
    </header>
  );
}

/** User menu: initials → name, role, organisation, Deconectare. Escape and outside click close it. */
export function UserMenu({
  user,
  onLogout,
}: {
  user: { name: string; role: Role; org: string };
  onLogout: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // Layout effect: the listeners must be there as soon as the menu is drawn.
  useLayoutEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    // Escape closes the menu wherever the focus is (it may have moved to the page).
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      if (root.current?.contains(document.activeElement)) button.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div class="user-menu" ref={root}>
      <button
        ref={button}
        type="button"
        class="user-menu__button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="user-menu-panel"
        aria-label={`${t.ux.userMenu}: ${user.name}`}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <span class="user-menu__avatar" aria-hidden="true">
          {initials(user.name)}
        </span>
        <NodeIcon node={ChevronDown} size={14} />
      </button>
      {open && (
        <div id="user-menu-panel" class="user-menu__panel">
          <dl>
            <dt>{t.ux.userLabel}</dt>
            <dd>{user.name}</dd>
            <dt>{t.ux.roleLabel}</dt>
            <dd>{t.role[user.role]}</dd>
            <dt>{t.ux.orgLabel}</dt>
            <dd>{user.org}</dd>
          </dl>
          <button type="button" class="user-menu__logout" onClick={onLogout}>
            {t.logout}
          </button>
        </div>
      )}
    </div>
  );
}
