interface Props {
  size?: number;
  className?: string;
  withWordmark?: boolean;
}

// The Eve mark: a side-profile silhouette of a woman with long flowing hair.
// Outline only, drawn in the warm gold-rose-plum gradient. Reads as a
// quiet, painted figure. The wordmark version puts her next to "eve".
export function EveLogo({ size = 36, className = '', withWordmark = false }: Props) {
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
        <circle cx="32" cy="28" r="22" fill="url(#eve-glow-icon)" />

        {/*
          Side-profile, looking right. Outline only.
          Path traces:
          - top of forehead
          - bridge of nose, tip, philtrum
          - upper + lower lip
          - chin
          - neck down to the front collarbone
          - bottom-front edge dips off-frame
          - long hair flowing down the back from crown
          - back of head curving up to crown
        */}
        <path
          d="
            M 30 12
            C 23 12 19 17 19 24
            C 19 28 21 32 23 35
            L 26 38
            L 31 39
            L 38 39
            L 39 41
            L 39 44
            L 41 47
            L 44 50
            L 46 56
            L 8 56
            L 8 50
            C 9 42 10 36 12 30
            C 13 26 14 21 17 17
            C 19 14 23 12 30 12
            Z
          "
          stroke="url(#eve-grad-icon)"
          strokeWidth="2.2"
          strokeLinejoin="round"
          fill="none"
        />

        {/* Hair locks falling — three flowing curves down the back */}
        <path
          d="M 14 28 Q 10 38 13 50"
          stroke="url(#eve-grad-icon)"
          strokeWidth="1.4"
          strokeLinecap="round"
          fill="none"
          opacity="0.85"
        />
        <path
          d="M 18 26 Q 16 40 21 54"
          stroke="url(#eve-grad-icon)"
          strokeWidth="1.4"
          strokeLinecap="round"
          fill="none"
          opacity="0.7"
        />
        <path
          d="M 22 30 Q 24 42 28 56"
          stroke="url(#eve-grad-icon)"
          strokeWidth="1.2"
          strokeLinecap="round"
          fill="none"
          opacity="0.55"
        />

        {/* Eyelash hint — a tiny stroke where her eye would be */}
        <path
          d="M 30 26 Q 32 25 34 26"
          stroke="url(#eve-grad-icon)"
          strokeWidth="1.2"
          strokeLinecap="round"
          fill="none"
          opacity="0.7"
        />

        {/* Earring sparkle */}
        <circle cx="27" cy="32" r="1.1" fill="#fef3c7" opacity="0.95" />

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

  // WORDMARK — profile silhouette + italic "eve". Transparent background.
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

      {/* Profile silhouette, scaled to wordmark height */}
      <g transform="translate(2 4)">
        <path
          d="
            M 25 6
            C 19 6 16 10 16 17
            C 16 21 17 25 19 28
            L 21 31
            L 25 32
            L 31 32
            L 32 34
            L 32 36
            L 34 39
            L 36 42
            L 38 49
            L 5 49
            L 5 43
            C 6 35 7 30 9 25
            C 10 21 11 17 13 13
            C 15 10 18 6 25 6
            Z
          "
          stroke="url(#eve-grad-word)"
          strokeWidth="1.9"
          strokeLinejoin="round"
          fill="none"
        />
        <path
          d="M 11 22 Q 8 32 11 45"
          stroke="url(#eve-grad-word)"
          strokeWidth="1.2"
          strokeLinecap="round"
          fill="none"
          opacity="0.8"
        />
        <path
          d="M 15 21 Q 13 33 18 47"
          stroke="url(#eve-grad-word)"
          strokeWidth="1.2"
          strokeLinecap="round"
          fill="none"
          opacity="0.6"
        />
        <path
          d="M 25 21 Q 27 26 28 28"
          stroke="url(#eve-grad-word)"
          strokeWidth="1.1"
          strokeLinecap="round"
          fill="none"
          opacity="0.7"
        />
        <circle cx="22" cy="26" r="1" fill="#fef3c7" opacity="0.9" />
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
