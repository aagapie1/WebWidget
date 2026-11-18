/**
 * Built-in icons (E4b.1 UX): Lucide (ISC, see LICENSE-lucide.txt), bundled with the widget — no
 * request to a third party (rule 8). Only the icons named here end up in the bundles.
 */
import {
  Bot,
  CircleHelp,
  Headset,
  Info,
  Landmark,
  MessageCircle,
  MessageCircleMore,
  Sparkles,
  User,
} from 'lucide';
import type { AvatarIconName, LauncherIconName } from 'gateway/protocol';

/** SVG children as `[tag, attributes]` pairs (Lucide's format). */
export type IconNode = [tag: string, attributes: Record<string, string | number | undefined>][];

export const LAUNCHER_ICONS: Readonly<Record<LauncherIconName, IconNode>> = {
  chat: MessageCircle,
  'chat-dots': MessageCircleMore,
  help: CircleHelp,
  info: Info,
  headset: Headset,
  landmark: Landmark,
  sparkles: Sparkles,
};

export const AVATAR_ICONS: Readonly<Record<AvatarIconName, IconNode>> = {
  bot: Bot,
  sparkles: Sparkles,
  landmark: Landmark,
  headset: Headset,
  person: User,
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Builds a decorative SVG element (no innerHTML): the control carries the accessible name. */
export function iconElement(doc: Document, node: IconNode, size: number): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  const attributes: Record<string, string> = {
    viewBox: '0 0 24 24',
    width: String(size),
    height: String(size),
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  };
  for (const [name, value] of Object.entries(attributes)) svg.setAttribute(name, value);
  for (const [tag, childAttributes] of node) {
    const child = doc.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(childAttributes)) {
      if (value !== undefined) child.setAttribute(name, String(value));
    }
    svg.appendChild(child);
  }
  return svg;
}
