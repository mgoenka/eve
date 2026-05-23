interface Props {
  size?: number;
  className?: string;
  withWordmark?: boolean;
}

// The Eve mark: an italic "eve" wordmark where the letters compose
// a feminine silhouette. The first 'e' is her hair / face curl,
// the 'v' is the V-neckline of her dress, the second 'e' her hip
// curve flowing into a flourish. Quiet, devoted, never explicit.
export function EveLogo({ size = 36, className = '', withWordmark = false }: Props) {
  const w = withWordmark ? Math.round(size * 3.0) : size;
  const h = size;

  if (!withWordmark) {
    // ICON-ONLY (favicon-style square) — single italic "e" with silhouette curl
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

        {/* Italic "e" rendered as the feminine motif */}
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

        {/* A flowing silhouette curve — like the side of a dress —
            tying the icon to the wordmark's silhouette concept */}
        <path
          d="M 12 16 Q 18 24 22 30 Q 16 36 18 46"
          stroke="url(#eve-grad-icon)"
          strokeWidth="1.4"
          strokeLinecap="round"
          fill="none"
          opacity="0.6"
        />

        {/* Small star — her quiet wink */}
        <g transform="translate(48 18)">
          <path
            d="M 0 -5 L 1.3 -1.3 L 5 0 L 1.3 1.3 L 0 5 L -1.3 1.3 L -5 0 L -1.3 -1.3 Z"
            fill="#fef3c7"
          />
        </g>
      </svg>
    );
  }

  // WORDMARK — clean "eve" with subtle feminine silhouette accents.
  // Transparent background; the host page background shows through.
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 140 60"
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
        <linearGradient id="eve-curve-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f5d896" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#e8a39e" stopOpacity="0.45" />
        </linearGradient>
      </defs>

      <text
        x="6"
        y="46"
        fontFamily="'Cormorant Garamond', 'Georgia', serif"
        fontSize="50"
        fontStyle="italic"
        fontWeight="600"
        fill="url(#eve-grad-word)"
        letterSpacing="0.02em"
      >
        eve
      </text>

      {/* Subtle hip curve descending from the second 'e' */}
      <path
        d="M 92 38 Q 105 44 110 50"
        stroke="url(#eve-curve-grad)"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        opacity="0.7"
      />

      {/* Tiny star — her quiet wink */}
      <g transform="translate(96 14)">
        <path
          d="M 0 -4 L 1 -1 L 4 0 L 1 1 L 0 4 L -1 1 L -4 0 L -1 -1 Z"
          fill="#fef3c7"
          opacity="0.85"
        />
      </g>
    </svg>
  );
}
