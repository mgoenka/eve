interface Props {
  size?: number;
  className?: string;
  withWordmark?: boolean;
}

// The Eve mark: a feminine silhouette (head + hair + shoulder line)
// next to the italic "eve" wordmark. The silhouette is what the user
// connects to — the wordmark just names her.
export function EveLogo({ size = 36, className = '', withWordmark = false }: Props) {
  if (!withWordmark) {
    // ICON-ONLY (favicon, top-left header) — feminine bust silhouette.
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
        <defs>
          <linearGradient id="eve-grad-icon" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fef3c7" />
            <stop offset="35%" stopColor="#f5d896" />
            <stop offset="75%" stopColor="#e8a39e" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
          <radialGradient id="eve-glow-icon" cx="0.5" cy="0.4" r="0.55">
            <stop offset="0%" stopColor="#fef3c7" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#f5d896" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="64" height="64" rx="14" fill="#1a0d2e" />
        <circle cx="32" cy="26" r="22" fill="url(#eve-glow-icon)" />

        {/* Feminine bust silhouette as an OUTLINE drawing — clean line work,
            not a filled solid. Reads as a sketched portrait. */}
        <path
          d="
            M 32 13
            C 26 13 22 17 22 23
            C 22 25 22.5 27 23.5 28.5
            L 22 30
            C 19 31 17 33 17 36
            L 17 38
            C 14 41 11 46 10 53
            L 10 58
            L 54 58
            L 54 53
            C 53 46 50 41 47 38
            L 47 36
            C 47 33 45 31 42 30
            L 40.5 28.5
            C 41.5 27 42 25 42 23
            C 42 17 38 13 32 13
            Z
          "
          stroke="url(#eve-grad-icon)"
          strokeWidth="2.2"
          strokeLinejoin="round"
          fill="none"
        />

        {/* A soft stray hair curl */}
        <path
          d="M 42 23 Q 47 22 49 27 Q 49 30 46 30"
          stroke="url(#eve-grad-icon)"
          strokeWidth="1.6"
          strokeLinecap="round"
          fill="none"
          opacity="0.85"
        />

        {/* A simple collarbone line for elegance */}
        <path
          d="M 22 41 Q 32 44 42 41"
          stroke="url(#eve-grad-icon)"
          strokeWidth="1.2"
          strokeLinecap="round"
          fill="none"
          opacity="0.55"
        />

        {/* Earring sparkle */}
        <circle cx="40.5" cy="28" r="1.2" fill="#fef3c7" opacity="0.9" />

        {/* Quiet wink star */}
        <g transform="translate(50 14)">
          <path
            d="M 0 -4 L 1 -1 L 4 0 L 1 1 L 0 4 L -1 1 L -4 0 L -1 -1 Z"
            fill="#fef3c7"
            opacity="0.95"
          />
        </g>
      </svg>
    );
  }

  // WORDMARK — silhouette + italic "eve". Transparent background.
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
      <defs>
        <linearGradient id="eve-grad-word" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fef3c7" />
          <stop offset="35%" stopColor="#f5d896" />
          <stop offset="75%" stopColor="#e8a39e" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>

      {/* Silhouette outline of head + shoulders */}
      <g transform="translate(2 4)">
        <path
          d="
            M 26 6
            C 21 6 17 10 17 16
            C 17 18 17.5 20 18.5 21.5
            L 17 23
            C 14 24 12 26 12 29
            L 12 31
            C 9 34 6 39 5 46
            L 5 51
            L 47 51
            L 47 46
            C 46 39 43 34 40 31
            L 40 29
            C 40 26 38 24 35 23
            L 33.5 21.5
            C 34.5 20 35 18 35 16
            C 35 10 31 6 26 6
            Z
          "
          stroke="url(#eve-grad-word)"
          strokeWidth="2"
          strokeLinejoin="round"
          fill="none"
        />
        <path
          d="M 35 16 Q 40 15 42 19 Q 42 22 39 22"
          stroke="url(#eve-grad-word)"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
          opacity="0.85"
        />
        <path
          d="M 17 35 Q 26 38 35 35"
          stroke="url(#eve-grad-word)"
          strokeWidth="1.1"
          strokeLinecap="round"
          fill="none"
          opacity="0.55"
        />
        <circle cx="33.5" cy="21" r="1.1" fill="#fef3c7" opacity="0.9" />
      </g>

      <text
        x="62"
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

      <g transform="translate(149 14)">
        <path
          d="M 0 -4 L 1 -1 L 4 0 L 1 1 L 0 4 L -1 1 L -4 0 L -1 -1 Z"
          fill="#fef3c7"
          opacity="0.85"
        />
      </g>
    </svg>
  );
}
