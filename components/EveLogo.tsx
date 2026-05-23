interface Props {
  size?: number;
  className?: string;
  withWordmark?: boolean;
}

// Side profile of a woman with long flowing hair, drawn in outline only.
// Path traces forehead → nose → lips → chin → neck → shoulder, then sweeps
// up the back of the head with hair extending to the bottom of the frame.
// All in the warm gold-rose-plum gradient stroke.
const SILHOUETTE_PATH =
  // Top of head, forehead, nose, lips, chin, jaw, neck, shoulder, hair, back of head
  'M 32 8 C 38 8 44 12 45 19 L 45 21 L 51 25 L 45 27 L 46 29 L 48 30 L 45 32 L 44 34 C 43 37 41 39 38 41 L 37 45 L 37 50 L 32 56 L 10 56 L 8 48 C 6 38 8 26 12 18 C 14 12 22 8 32 8 Z';

const HAIR_WAVE_1 = 'M 10 22 Q 4 36 9 56';
const HAIR_WAVE_2 = 'M 14 18 Q 12 36 16 56';
const HAIR_WAVE_3 = 'M 20 14 Q 22 36 26 56';

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

        {/* Hair waves down the back */}
        <path d={HAIR_WAVE_1} stroke="url(#eve-grad-icon)" strokeWidth="1.4" strokeLinecap="round" fill="none" opacity="0.85" />
        <path d={HAIR_WAVE_2} stroke="url(#eve-grad-icon)" strokeWidth="1.3" strokeLinecap="round" fill="none" opacity="0.65" />
        <path d={HAIR_WAVE_3} stroke="url(#eve-grad-icon)" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.45" />

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
        <path d={HAIR_WAVE_1} stroke="url(#eve-grad-word)" strokeWidth="1.3" strokeLinecap="round" fill="none" opacity="0.8" />
        <path d={HAIR_WAVE_2} stroke="url(#eve-grad-word)" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.6" />
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
