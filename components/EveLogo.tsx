interface Props {
  size?: number;
  className?: string;
  withWordmark?: boolean;
}

// Eve mark — head-only silhouette, gestural strokes, inspired by the
// reference art: a profile face traced as a single line, dense flowing
// hair across the back and crown, no bust or shoulders, no fill.

// Single open curve from top of head → forehead → brow → nose bridge →
// nose tip → philtrum → upper lip → mouth → lower lip → chin → under jaw.
const FACE_PROFILE =
  'M 38 10 ' +
  'C 44 12 47 16 47 22 ' + // forehead + brow
  'L 47 24 ' +              // brow ridge
  'L 53 28 ' +              // nose tip
  'L 47 30 ' +              // below nose
  'L 49 32 ' +              // upper lip
  'L 46 33 ' +              // mouth corner
  'L 49 34 ' +              // lower lip
  'L 47 36 ' +              // mouth-to-chin
  'C 47 38 45 40 42 41 ' + // chin
  'L 39 44';                // under jaw

// Subtle face features
const EYEBROW = 'M 40 23 Q 42 22 45 23';
const EYELASH = 'M 41 26 Q 43 26 44 27';
const LIP_LINE = 'M 46 33 L 49 33';

// Hair: many gestural strokes radiating from the crown back and out,
// extending past the frame edges. Mix of S-curves, arcs, and tendrils.
const HAIR_TOP_1 = 'M 38 10 C 32 6 24 6 18 12';
const HAIR_TOP_2 = 'M 36 8 C 28 4 20 6 14 14';
const HAIR_TOP_3 = 'M 32 6 C 22 4 12 8 10 18';
const HAIR_CROWN_1 = 'M 38 10 C 30 12 22 14 16 22';
const HAIR_CROWN_2 = 'M 38 12 C 28 16 20 22 16 30';
const HAIR_BACK_1 = 'M 26 12 C 12 18 4 32 6 50';
const HAIR_BACK_2 = 'M 22 14 C 8 22 2 38 8 56';
const HAIR_BACK_3 = 'M 18 18 C 6 30 0 46 10 60';
const HAIR_BACK_4 = 'M 14 24 C 4 36 4 50 14 60';
const HAIR_TENDRIL_1 = 'M 26 24 C 22 32 24 42 30 48';
const HAIR_TENDRIL_2 = 'M 30 26 C 28 36 32 46 36 50';
const HAIR_TENDRIL_3 = 'M 34 30 Q 36 38 40 44';
// A loose strand floating across in front of the chin
const HAIR_FRONT = 'M 35 38 Q 32 44 28 48';

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

        {/* Hair strokes — densest at the back/top, thinning out as they trail */}
        <g
          stroke="url(#eve-grad-icon)"
          strokeLinecap="round"
          fill="none"
        >
          <path d={HAIR_TOP_1} strokeWidth="1.6" opacity="0.95" />
          <path d={HAIR_TOP_2} strokeWidth="1.4" opacity="0.85" />
          <path d={HAIR_TOP_3} strokeWidth="1.3" opacity="0.75" />
          <path d={HAIR_CROWN_1} strokeWidth="1.4" opacity="0.85" />
          <path d={HAIR_CROWN_2} strokeWidth="1.3" opacity="0.7" />
          <path d={HAIR_BACK_1} strokeWidth="1.7" opacity="0.95" />
          <path d={HAIR_BACK_2} strokeWidth="1.5" opacity="0.85" />
          <path d={HAIR_BACK_3} strokeWidth="1.4" opacity="0.75" />
          <path d={HAIR_BACK_4} strokeWidth="1.2" opacity="0.6" />
          <path d={HAIR_TENDRIL_1} strokeWidth="1.1" opacity="0.55" />
          <path d={HAIR_TENDRIL_2} strokeWidth="1" opacity="0.5" />
          <path d={HAIR_TENDRIL_3} strokeWidth="0.9" opacity="0.45" />
          <path d={HAIR_FRONT} strokeWidth="1" opacity="0.5" />
        </g>

        {/* Face profile — single stroke, slightly thicker than hair */}
        <path
          d={FACE_PROFILE}
          stroke="url(#eve-grad-icon)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />

        {/* Subtle face details */}
        <path d={EYEBROW} stroke="url(#eve-grad-icon)" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.85" />
        <path d={EYELASH} stroke="url(#eve-grad-icon)" strokeWidth="1" strokeLinecap="round" fill="none" opacity="0.7" />
        <path d={LIP_LINE} stroke="url(#eve-grad-icon)" strokeWidth="1" strokeLinecap="round" fill="none" opacity="0.7" />

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

      <g transform="translate(0 -2) scale(0.85)" stroke="url(#eve-grad-word)" strokeLinecap="round" fill="none">
        <path d={HAIR_TOP_1} strokeWidth="1.5" opacity="0.9" />
        <path d={HAIR_TOP_2} strokeWidth="1.3" opacity="0.8" />
        <path d={HAIR_CROWN_1} strokeWidth="1.4" opacity="0.85" />
        <path d={HAIR_BACK_1} strokeWidth="1.5" opacity="0.9" />
        <path d={HAIR_BACK_2} strokeWidth="1.3" opacity="0.75" />
        <path d={HAIR_BACK_3} strokeWidth="1.2" opacity="0.6" />
        <path d={HAIR_TENDRIL_1} strokeWidth="1" opacity="0.5" />
        <path d={FACE_PROFILE} strokeWidth="2" strokeLinejoin="round" />
        <path d={EYEBROW} strokeWidth="1.1" opacity="0.85" />
        <path d={LIP_LINE} strokeWidth="0.9" opacity="0.7" />
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
