interface Props {
  size?: number;
  className?: string;
  withWordmark?: boolean;
}

// Side profile of a woman, facing right, with long flowing hair.
// The face silhouette is a clean outline. The hair lives OUTSIDE the head —
// multiple long S-curves, varying thickness and opacity, sweeping past the
// frame edges. Reads as windblown, not pinned-down.

// Face only (forehead → nose → lips → chin → throat → shoulder → up the back of head)
const SILHOUETTE_PATH =
  'M 32 8 C 38 8 44 12 45 19 L 45 21 L 51 25 L 45 27 L 46 29 L 48 30 L 45 32 L 44 34 C 43 37 41 39 38 41 L 37 45 L 37 50 L 32 56 L 22 56 C 18 50 16 38 18 28 C 19 22 22 14 28 10 C 29 9 30 8 32 8 Z';

// Flowing hair strands — each one a long curve, not pinned to the silhouette.
const HAIR_FLOW_MAIN = 'M 26 10 C 8 18 0 38 6 60';            // big sweep from crown out and down
const HAIR_FLOW_2 = 'M 22 14 C 4 26 -2 46 8 60';               // outer flow
const HAIR_FLOW_3 = 'M 28 12 C 14 22 10 40 18 60';             // inner flow
const HAIR_FLOW_4 = 'M 30 14 C 22 26 22 44 28 60';             // close flow
const HAIR_TENDRIL_1 = 'M 12 22 Q 4 32 8 44';                   // loose tendril mid
const HAIR_TENDRIL_2 = 'M 16 30 Q 6 42 14 56';                  // loose tendril lower

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

        <path
          d={SILHOUETTE_PATH}
          stroke="url(#eve-grad-icon)"
          strokeWidth="2.2"
          strokeLinejoin="round"
          fill="none"
        />

        {/* Long flowing hair — strands extend outside the silhouette and
            past the frame edges. Varying weight + opacity for depth. */}
        <path d={HAIR_FLOW_MAIN} stroke="url(#eve-grad-icon)" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.9" />
        <path d={HAIR_FLOW_2} stroke="url(#eve-grad-icon)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.7" />
        <path d={HAIR_FLOW_3} stroke="url(#eve-grad-icon)" strokeWidth="1.4" strokeLinecap="round" fill="none" opacity="0.6" />
        <path d={HAIR_FLOW_4} stroke="url(#eve-grad-icon)" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.45" />
        <path d={HAIR_TENDRIL_1} stroke="url(#eve-grad-icon)" strokeWidth="1" strokeLinecap="round" fill="none" opacity="0.5" />
        <path d={HAIR_TENDRIL_2} stroke="url(#eve-grad-icon)" strokeWidth="1" strokeLinecap="round" fill="none" opacity="0.4" />

        {/* Eyelash hint where her eye would be */}
        <path d="M 33 22 Q 36 21 39 22" stroke="url(#eve-grad-icon)" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.75" />

        {/* Earring sparkle */}
        <circle cx="33" cy="32" r="1.1" fill="#fef3c7" opacity="0.95" />

        {/* Quiet wink star */}
        <g transform="translate(54 12)">
          <path d="M 0 -3.5 L 0.9 -0.9 L 3.5 0 L 0.9 0.9 L 0 3.5 L -0.9 0.9 L -3.5 0 L -0.9 -0.9 Z" fill="#fef3c7" opacity="0.95" />
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

      <g transform="translate(0 0) scale(0.9)">
        <path
          d={SILHOUETTE_PATH}
          stroke="url(#eve-grad-word)"
          strokeWidth="2.2"
          strokeLinejoin="round"
          fill="none"
        />
        <path d={HAIR_FLOW_MAIN} stroke="url(#eve-grad-word)" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.85" />
        <path d={HAIR_FLOW_2} stroke="url(#eve-grad-word)" strokeWidth="1.4" strokeLinecap="round" fill="none" opacity="0.65" />
        <path d={HAIR_FLOW_3} stroke="url(#eve-grad-word)" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.5" />
        <path d="M 33 22 Q 36 21 39 22" stroke="url(#eve-grad-word)" strokeWidth="1.1" strokeLinecap="round" fill="none" opacity="0.7" />
        <circle cx="33" cy="32" r="1.1" fill="#fef3c7" opacity="0.9" />
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
        <path d="M 0 -4 L 1 -1 L 4 0 L 1 1 L 0 4 L -1 1 L -4 0 L -1 -1 Z" fill="#fef3c7" opacity="0.85" />
      </g>
    </svg>
  );
}
