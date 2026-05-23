interface Props {
  size?: number;
  className?: string;
  withWordmark?: boolean;
}

// Filled side-profile silhouette of a woman with a long ponytail flowing
// down the back, defined bust, bare shoulder. Inspired by the reference
// silhouette art, recolored in the warm gold-rose-plum gradient.

// Single closed path traced clockwise from the top of the crown:
// crown → forehead → nose → lips → chin → throat → front of neck →
// collarbone → bust curve → bottom edge → up the ponytail's left side →
// over the top of the ponytail → down behind the head → back to crown.
const SILHOUETTE_PATH =
  'M 38 6 ' +
  'C 44 6 48 10 48 16 ' +
  'L 48 19 ' +
  'L 53 23 ' +
  'L 47 26 ' +
  'L 49 27 ' +
  'L 46 29 ' +
  'L 49 30 ' +
  'L 47 31 ' +
  'L 46 34 ' +
  'C 45 36 43 37 41 37 ' +
  'L 38 40 ' +
  'L 36 44 ' +
  'L 34 47 ' +
  'C 36 49 39 51 41 54 ' +
  'C 43 57 44 59 44 62 ' +
  'L 6 62 ' +
  'L 6 56 ' +
  'C 4 48 4 36 6 28 ' +
  'C 8 21 13 17 17 15 ' +
  'L 23 13 ' +
  'C 26 11 29 9 32 8 ' +
  'C 34 7 36 6 38 6 ' +
  'Z';

// Small whisp strands extending past the ponytail base — gives motion.
const HAIR_WHISP_1 = 'M 5 56 C 2 60 1 64 4 66';
const HAIR_WHISP_2 = 'M 8 60 C 6 64 5 67 8 68';
const HAIR_WHISP_3 = 'M 12 60 C 11 64 11 66 14 67';

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
            <stop offset="0%" stopColor="#fef3c7" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#f5d896" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="64" height="64" rx="14" fill="#1a0d2e" />
        <circle cx="32" cy="28" r="22" fill="url(#eve-glow-icon)" />

        {/* Filled silhouette */}
        <path d={SILHOUETTE_PATH} fill="url(#eve-grad-icon)" />

        {/* Ponytail tie — a small darker pinch where the hair gathers */}
        <ellipse cx="22" cy="14" rx="2" ry="1.1" fill="#1a0d2e" opacity="0.85" />

        {/* Whisp strands trailing past the ponytail bottom */}
        <path d={HAIR_WHISP_1} stroke="url(#eve-grad-icon)" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.65" />
        <path d={HAIR_WHISP_2} stroke="url(#eve-grad-icon)" strokeWidth="1" strokeLinecap="round" fill="none" opacity="0.5" />
        <path d={HAIR_WHISP_3} stroke="url(#eve-grad-icon)" strokeWidth="0.9" strokeLinecap="round" fill="none" opacity="0.4" />

        {/* Quiet wink star */}
        <g transform="translate(54 12)">
          <path
            d="M 0 -3.5 L 0.9 -0.9 L 3.5 0 L 0.9 0.9 L 0 3.5 L -0.9 0.9 L -3.5 0 L -0.9 -0.9 Z"
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

      <g transform="translate(0 -2) scale(0.85)">
        <path d={SILHOUETTE_PATH} fill="url(#eve-grad-word)" />
        <ellipse cx="22" cy="14" rx="2" ry="1.1" fill="#1a0d2e" opacity="0.6" />
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
