import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { iconElement, LAUNCHER_ICONS } from '../../shared/icons/index.js';
import { Avatar } from './Avatar.js';

afterEach(cleanup);

describe('Avatar (E4b.1 UX)', () => {
  it('draws initials on the accent color, decorative only', () => {
    const { container } = render(<Avatar avatar={{ kind: 'initials', text: 'AP' }} size="small" />);
    const avatar = container.querySelector('.avatar');
    expect(avatar?.getAttribute('aria-hidden')).toBe('true');
    expect(avatar?.classList.contains('avatar--initials')).toBe(true);
    expect(avatar?.textContent).toBe('AP');
  });

  it('draws a bundled icon or an image, and nothing for none', () => {
    const icon = render(<Avatar avatar={{ kind: 'icon', name: 'landmark' }} size="large" />);
    expect(icon.container.querySelector('svg path, svg rect, svg circle')).not.toBeNull();
    icon.unmount();

    const image = render(
      <Avatar avatar={{ kind: 'image', url: '/w/t/x/0123456789-a.png' }} size="small" />,
    );
    expect(image.container.querySelector('img')?.getAttribute('src')).toBe(
      '/w/t/x/0123456789-a.png',
    );
    image.unmount();

    const none = render(<Avatar avatar={{ kind: 'none' }} size="small" />);
    expect(none.container.innerHTML).toBe('');
  });

  it('keeps the default icon when no avatar is configured', () => {
    const { container } = render(<Avatar size="small" />);
    expect(container.querySelector('.avatar--default svg')).not.toBeNull();
  });
});

describe('bundled icons (Lucide)', () => {
  it('builds decorative SVG elements without innerHTML', () => {
    const svg = iconElement(document, LAUNCHER_ICONS.headset, 28);
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('width')).toBe('28');
    expect(svg.childElementCount).toBeGreaterThan(0);
    for (const name of Object.keys(LAUNCHER_ICONS)) {
      expect(LAUNCHER_ICONS[name as keyof typeof LAUNCHER_ICONS].length).toBeGreaterThan(0);
    }
  });
});
