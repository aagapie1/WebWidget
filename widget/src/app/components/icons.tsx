/** Decorative inline icons (no external assets, rule 8). Buttons carry the accessible name. */
interface IconProps {
  size?: number;
}

function Svg({ size = 20, children }: IconProps & { children: preact.ComponentChildren }) {
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
      {children}
    </svg>
  );
}

export const SendIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4z" />
  </Svg>
);

export const StopIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
  </Svg>
);

export const ChevronDownIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const NewChatIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </Svg>
);

export const AssistantIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="4" y="8" width="16" height="12" rx="4" />
    <path d="M12 4v4M9 14h.01M15 14h.01" />
  </Svg>
);
