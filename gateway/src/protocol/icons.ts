/**
 * Built-in icon names (E4b.1 UX). The configuration schema, the protocol and the widget share
 * them; the widget maps each name to its SVG data (Lucide, ISC, bundled: widget/src/shared).
 */
export const LAUNCHER_ICON_NAMES = [
  'chat',
  'chat-dots',
  'help',
  'info',
  'headset',
  'landmark',
  'sparkles',
] as const;
export type LauncherIconName = (typeof LAUNCHER_ICON_NAMES)[number];

/** Generic assistant avatars (shown on the accent color). */
export const ASSISTANT_AVATAR_ICON_NAMES = ['bot', 'sparkles', 'landmark', 'headset'] as const;
export type AssistantAvatarIconName = (typeof ASSISTANT_AVATAR_ICON_NAMES)[number];

/** Generic visitor avatar. */
export const USER_AVATAR_ICON_NAMES = ['person'] as const;
export type UserAvatarIconName = (typeof USER_AVATAR_ICON_NAMES)[number];

export type AvatarIconName = AssistantAvatarIconName | UserAvatarIconName;
