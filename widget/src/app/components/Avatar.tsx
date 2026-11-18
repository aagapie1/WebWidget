import { AssistantIcon } from './icons.js';

/** Tenant image URLs (served by the gateway, ADR 007). */
export interface Identity {
  logoUrl?: string | undefined;
  assistantAvatarUrl?: string | undefined;
  userAvatarUrl?: string | undefined;
}

/** Decorative avatar: the author is always named in text next to it. */
export function Avatar({ url, size }: { url?: string | undefined; size: 'small' | 'large' }) {
  return (
    <span class={`avatar avatar--${size}${url ? ' avatar--image' : ''}`} aria-hidden="true">
      {url ? (
        <img class="avatar__image" src={url} alt="" />
      ) : (
        <AssistantIcon size={size === 'large' ? 22 : 16} />
      )}
    </span>
  );
}
