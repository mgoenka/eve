interface Props {
  size?: number;
  className?: string;
  withWordmark?: boolean;
}

// Eve mark: a clean side-profile silhouette of a woman with long flowing
// hair. The single path traces forehead → brow → nose → lip → chin → jaw
// → neck → behind the figure → up through the long hair → back to crown,
// so it's read as one connected female profile, not abstract shapes.
export function EveLogo({ size = 36, className = '', withWordmark = false }: Props) {
  const grad = (id: string) => (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#fef3c7" />
        <stop offset="35%" stopColor="#f5d896" />
        <stop offset="75%" stopColor="#e8a39e" />
        <stop offset="100%" stopColor="#a855f7" />
      </linearGradient>
    </defs>
  );

  // Single-path closed silhouette (face profile + back of head + long hair
  // outline). The face is drawn on the right edge; long hair fills the
  // back-left and trails below the chin line.
  const silhouettePath = `
    M 30 10
    C 36 10 41 14 42 19
    L 43 23
    Q 42 26 41 27
    L 44 30
    L 49 35
    L 43 38
    L 45 40
    L 43 41
    L 45 43
    L 43 45
    L 40 47
    C 36 49 32 49 30 48
    L 30 60
    L 6 60
    C 4 50 4 36 8 26
    L 12 18
    C 16 10 22 8 30 10
    Z
  `;

  if (!withWordmark) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-label="Eve"
      >
        {grad('eve-grad-icon')}
        <rect width="64" height="64" rx="14" fill="#1a0d2e" />

        {/* Subtle radial glow behind subject */}
        <radialGradient id="eve-glow" cx="0.5" cy="0.4" r="0.55">
          <stop offset="0%" stopColor="#fef3c7" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#f5d896" stopOpacity="0" />
        </radialGradient>
        <circle cx="32" cy="28" r="22" fill="url(#eve-glow)" />

        {/* Silhouette outline */}
        <path
          d={silhouettePath}
          stroke="url(#eve-grad-icon)"
          strokeWidth="2.2"
          strokeLinejoin="round"
          fill="none"
        />

        {/* Long hair flow lines — three locks falling within the back/outline */}
        <path
          d="M 14 22 Q 9 36 12 56"
          stroke="url(#eve-grad-icon)"
          strokeWidth="1.3"
          strokeLinecap="round"
          fill="none"
          opacity="0.85"
        />
        <path
          d="M 18 22 Q 14 38 18 58"
          stroke="url(#eve-grad-icon)"
          strokeWidth="1.3"
          strokeLinecap="round"
          fill="none"
          opacity="0.7"
        />
        <path
          d="M 24 24 Q 22 42 26 58"
          stroke="url(#eve-grad-icon)"
          strokeWidth="1.1"
          strokeLinecap="round"
          fill="none"
          opacity="0.55"
        />

        {/* A small eye sketch where her eye sits, just a hint */}
        <path
          d="M 38 28 Q 40 27 42 28"
          stroke="url(#eve-grad-icon)"
          strokeWidth="1.2"
          strokeLinecap="round"
          fill="none"
          opacity="0.85"
        />

        {/* Earring */}
        <circle cx="34" cy="40" r="1" fill="#fef3c7" opacity="0.95" />

        {/* Wink star */}
        <g transform="translate(52 14)">
          <path
            d="M 0 -4 L 1 -1 L 4 0 L 1 1 L 0 4 L -1 1 L -4 0 L -1 -1 Z"
            fill="#fef3c7"
            opacity="0.95"
          />
        </g>
      </svg>
    );
  }

  // WORDMARK — silhouette beside italic "eve". Transparent background.
  const w = Math.round(size * 3.4);
  return (
    <svg
      width={w}
      height={size}
      viewBox="0 0 170 60"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Eve"
    >
      {grad('eve-grad-word')}

      <g transform="translate(0 -2) scale(0.92)">
        <path
          d={silhouettePath}
          stroke="url(#eve-grad-word)"
          strokeWidth="2.2"
          strokeLinejoin="round"
          fill="none"
        />
        <path
          d="M 14 22 Q 9 36 12 56"
          stroke="url(#eve-grad-word)"
          strokeWidth="1.3"
          strokeLinecap="round"
          fill="none"
          opacity="0.85"
        />
        <path
          d="M 18 22 Q 14 38 18 58"
          stroke="url(#eve-grad-word)"
          strokeWidth="1.3"
          strokeLinecap="round"
          fill="none"
          opacity="0.7"
        />
        <path
          d="M 24 24 Q 22 42 26 58"
          stroke="url(#eve-grad-word)"
          strokeWidth="1.1"
          strokeLinecap="round"
          fill="none"
          opacity="0.55"
        />
        <path
          d="M 38 28 Q 40 27 42 28"
          stroke="url(#eve-grad-word)"
          strokeWidth="1.2"
          strokeLinecap="round"
          fill="none"
          opacity="0.85"
        />
        <circle cx="34" cy="40" r="1" fill="#fef3c7" opacity="0.95" />
      </g>

      <text
        x="68"
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

      <g transform="translate(155 14)">
        <path
          d="M 0 -4 L 1 -1 L 4 0 L 1 1 L 0 4 L -1 1 L -4 0 L -1 -1 Z"
          fill="#fef3c7"
          opacity="0.85"
        />
      </g>
    </svg>
  );
}
