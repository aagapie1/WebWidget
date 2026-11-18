/** WCAG 2.1 relative luminance and contrast ratio for `#rrggbb` colors. */
export function contrastRatio(foreground: string, background: string): number {
  const l1 = luminance(foreground);
  const l2 = luminance(background);
  const [light, dark] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (light + 0.05) / (dark + 0.05);
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const WHITE = '#ffffff';
const BLACK = '#000000';

/**
 * White or black, whichever keeps the most contrast against every given background (text and
 * icons on the accent colors). Any single color reaches at least 4.58:1 with one of the two.
 */
export function textOn(backgrounds: readonly string[]): string {
  const worst = (color: string) =>
    Math.min(...backgrounds.map((background) => contrastRatio(color, background)));
  return worst(WHITE) >= worst(BLACK) ? WHITE : BLACK;
}

/**
 * The color itself if it reaches `minimum` against every background, otherwise the same hue
 * darkened in 5% steps until it does (links from the accent color). Black as the last resort.
 */
export function readableOn(color: string, backgrounds: readonly string[], minimum = 4.5): string {
  const enough = (candidate: string) =>
    backgrounds.every((background) => contrastRatio(candidate, background) >= minimum);
  const value = Number.parseInt(color.slice(1), 16);
  const channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  for (let step = 0; step <= 20; step += 1) {
    const factor = 1 - step * 0.05;
    const candidate = `#${channels
      .map((channel) =>
        Math.round(channel * factor)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`;
    if (enough(candidate)) return candidate;
  }
  return BLACK;
}
