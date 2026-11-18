import { h } from 'preact';
import type { WidgetAvatar } from 'gateway/protocol';
import { AVATAR_ICONS, type IconNode } from '../../shared/icons/index.js';
import { AssistantIcon } from './icons.js';

/** Tenant identity as sent by the gateway (images are served by the gateway, ADR 007). */
export interface Identity {
  logoUrl?: string | undefined;
  assistantAvatar?: WidgetAvatar | undefined;
  userAvatar?: WidgetAvatar | undefined;
}

/** A bundled icon (Lucide data) rendered with Preact. */
export function NodeIcon({ node, size }: { node: IconNode; size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {node.map(([tag, attributes], index) => h(tag, { key: index, ...attributes }))}
    </svg>
  );
}

/**
 * Decorative avatar: the author is always named in text next to it. Image, built-in icon or
 * initials (on the accent color); nothing for `none`. Without a setting: the default icon.
 */
export function Avatar({
  avatar,
  size,
}: {
  avatar?: WidgetAvatar | undefined;
  size: 'small' | 'large';
}) {
  if (avatar?.kind === 'none') return null;
  const iconSize = size === 'large' ? 22 : 16;
  const kind = avatar?.kind ?? 'default';
  return (
    <span class={`avatar avatar--${size} avatar--${kind}`} aria-hidden="true">
      {avatar?.kind === 'image' && <img class="avatar__image" src={avatar.url} alt="" />}
      {avatar?.kind === 'icon' && <NodeIcon node={AVATAR_ICONS[avatar.name]} size={iconSize} />}
      {avatar?.kind === 'initials' && <span class="avatar__initials">{avatar.text}</span>}
      {!avatar && <AssistantIcon size={iconSize} />}
    </span>
  );
}
