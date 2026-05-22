interface Props {
  size?: number;
  className?: string;
  withWordmark?: boolean;
}

// The Eve mark: an italic "e" kissed by a small star
// Designed to read at favicon size and scale up cleanly
export function EveLogo({ size = 36, className = '', withWordmark = false }: Props) {
  const w = withWordmark ? Math.round(size * 3.0) : size;
  const h = size;

  if (!withWordmark) {
    // ICON-ONLY (favicon-style square)
    return (
      <svg
        width={w}
        height={h}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-label="Eve"
      >
        <defs>
          <linearGradient id="eve-grad-icon" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fef3c7" />
            <stop offset="35%" stopColor="#f5d896" />
            <stop offset="75%" stopColor="#e8a39e" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
          <radialGradient id="eve-glow-icon" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#fef3c7" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#f5d896" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="64" height="64" rx="14" fill="#1a0d2e" />
        <circle cx="32" cy="32" r="24" fill="url(#eve-glow-icon)" />
        <text
          x="32"
          y="48"
          textAnchor="middle"
          fontFamily="'Cormorant Garamond', 'Georgia', serif"
          fontSize="48"
          fontStyle="italic"
          fontWeight="600"
          fill="url(#eve-grad-icon)"
          letterSpacing="-0.02em"
        >
          e
        </text>
        <g transform="translate(48 18)">
          <path
            d="M 0 -5 L 1.3 -1.3 L 5 0 L 1.3 1.3 L 0 5 L -1.3 1.3 L -5 0 L -1.3 -1.3 Z"
            fill="#fef3c7"
          />
        </g>
        <g transform="translate(15 52)" opacity="0.7">
          <path
            d="M 0 -2.4 L 0.6 -0.6 L 2.4 0 L 0.6 0.6 L 0 2.4 L -0.6 0.6 L -2.4 0 L -0.6 -0.6 Z"
            fill="#e8a39e"
          />
        </g>
      </svg>
    );
  }

  // WORDMARK ("eve" with sparkle)
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 180 60"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Eve"
    >
      <defs>
        <linearGradient id="eve-grad-word" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fef3c7" />
          <stop offset="35%" stopColor="#f5d896" />
          <stop offset="75%" stopColor="#e8a39e" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
        <radialGradient id="eve-glow-word" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#fef3c7" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#f5d896" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="50" cy="30" rx="45" ry="22" fill="url(#eve-glow-word)" />
      <text
        x="6"
        y="46"
        fontFamily="'Cormorant Garamond', 'Georgia', serif"
        fontSize="50"
        fontStyle="italic"
        fontWeight="600"
        fill="url(#eve-grad-word)"
        letterSpacing="-0.02em"
      >
        eve
      </text>
      <g transform="translate(94 13)">
        <path
          d="M 0 -5 L 1.3 -1.3 L 5 0 L 1.3 1.3 L 0 5 L -1.3 1.3 L -5 0 L -1.3 -1.3 Z"
          fill="#fef3c7"
        />
      </g>
      <g transform="translate(102 28)" opacity="0.65">
        <path
          d="M 0 -2.6 L 0.7 -0.7 L 2.6 0 L 0.7 0.7 L 0 2.6 L -0.7 0.7 L -2.6 0 L -0.7 -0.7 Z"
          fill="#e8a39e"
        />
      </g>
    </svg>
  );
}
