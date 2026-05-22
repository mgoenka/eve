import React from 'react';

interface Props {
  size?: number;
  className?: string;
  withWordmark?: boolean;
}

// The Eve mark: an italic 'e' kissed by a small star — playful, intimate, slightly naughty.
// Designed to read at favicon size and scale up cleanly.
export function EveLogo({ size = 36, className = '', withWordmark = false }: Props) {
  const w = withWordmark ? size * 3.4 : size;
  const h = size;

  return (
    <svg
      width={w}
      height={h}
      viewBox={withWordmark ? '0 0 200 60' : '0 0 60 60'}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Eve"
    >
      <defs>
        <linearGradient id="eve-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fef3c7" />
          <stop offset="35%" stopColor="#f5d896" />
          <stop offset="75%" stopColor="#e8a39e" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
        <radialGradient id="eve-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#fef3c7" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#f5d896" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Soft warm glow behind the mark */}
      <circle cx="30" cy="30" r="26" fill="url(#eve-glow)" />

      {/* Italic "e" — built from arcs for a hand-drawn Cormorant feel */}
      <g transform="translate(30 30)">
        {/* outer ring of the e */}
        <path
          d="M -14 -1 A 14 14 0 1 1 13 6 L 6 4 A 9 9 0 1 0 -9 -1 Z"
          fill="url(#eve-grad)"
        />
        {/* horizontal bar of the e (the part that says 'e') */}
        <path
          d="M -10 -1 L 11 -1 A 1 1 0 0 1 11 1 L -10 1 Z"
          fill="url(#eve-grad)"
        />
        {/* italic flourish at the tail of the e */}
        <path
          d="M 11 6 Q 16 8 18 12"
          stroke="url(#eve-grad)"
          strokeWidth="2.6"
          strokeLinecap="round"
          fill="none"
        />
      </g>

      {/* Small four-point star — the wink */}
      <g transform="translate(46 16)">
        <path
          d="M 0 -5 L 1.3 -1.3 L 5 0 L 1.3 1.3 L 0 5 L -1.3 1.3 L -5 0 L -1.3 -1.3 Z"
          fill="#fef3c7"
        />
      </g>
      {/* Tiny accent sparkle */}
      <g transform="translate(13 50)" opacity="0.7">
        <path
          d="M 0 -2.4 L 0.6 -0.6 L 2.4 0 L 0.6 0.6 L 0 2.4 L -0.6 0.6 L -2.4 0 L -0.6 -0.6 Z"
          fill="#e8a39e"
        />
      </g>

      {/* Wordmark "ve" continuing the script when withWordmark */}
      {withWordmark && (
        <g transform="translate(60 0)">
          <text
            x="0"
            y="42"
            fontFamily="'Cormorant Garamond', serif"
            fontSize="44"
            fontStyle="italic"
            fontWeight="600"
            fill="url(#eve-grad)"
            letterSpacing="-0.02em"
          >
            ve
          </text>
        </g>
      )}
    </svg>
  );
}
