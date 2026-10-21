import { useId } from 'react';
import { cx } from './cx';

function blob(r: number): string {
  const points: string[] = [];
  const n = 144;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const wobble = Math.sin(t * 19) * 0.028 + Math.sin(t * 5 + 1.3) * 0.022 + Math.sin(t * 3 + 0.4) * 0.014;
    const rr = r * (1 + wobble);
    points.push(`${(50 + rr * Math.cos(t)).toFixed(2)} ${(50 + rr * Math.sin(t)).toFixed(2)}`);
  }
  return `M${points.join('L')}Z`;
}

const OUTER = blob(46);

const RING = {
  agreed: 'Signed · Sealed · Settled · ',
  ruled: 'Ruled by the referee · Fair is fair · ',
  sealed: 'Picks sealed · No peeking · No peeking · ',
};

const LABEL = {
  agreed: 'Sealed: both agents agreed',
  ruled: 'Sealed: ruled by the referee',
  sealed: 'Sealed',
};

interface SealProps {
  /** One or two monograms. */
  letters: [string] | [string, string];
  kind: 'agreed' | 'ruled' | 'sealed';
  size?: number;
  /** Press it onto the page (once, on mount). */
  stamp?: boolean;
  delay?: number;
  className?: string;
}

/** The wax seal on a finished truce: both monograms, pressed in. */
export function Seal({ letters, kind, size = 112, stamp, delay = 0, className }: SealProps) {
  const id = useId().replace(/:/g, '');
  const ring = RING[kind];
  return (
    <span
      className={cx('seal', stamp && 'seal--stamp', className)}
      style={{ width: size, height: size, ['--delay' as string]: `${delay}ms` }}
      role="img"
      aria-label={LABEL[kind]}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        <defs>
          <radialGradient id={`${id}-wax`} cx="36%" cy="30%" r="75%">
            <stop offset="0" style={{ stopColor: 'oklch(62% 0.17 31)' }} />
            <stop offset="0.55" style={{ stopColor: 'var(--seal)' }} />
            <stop offset="1" style={{ stopColor: 'var(--seal-press)' }} />
          </radialGradient>
          <path id={`${id}-ring`} d="M50 50m-37.5 0a37.5 37.5 0 1 1 75 0a37.5 37.5 0 1 1-75 0" />
        </defs>
        <path d={OUTER} fill={`url(#${id}-wax)`} />
        <circle cx="50" cy="50" r="31.5" fill="none" stroke="oklch(30% 0.12 29 / 0.35)" strokeWidth="1.2" transform="translate(0.5 0.7)" />
        <circle cx="50" cy="50" r="31.5" fill="none" stroke="oklch(98% 0.01 84 / 0.4)" strokeWidth="0.8" />
        <text className="seal__ring">
          <textPath href={`#${id}-ring`} startOffset="0">
            {ring.toUpperCase()}
          </textPath>
        </text>
        <text x="50" y="57" textAnchor="middle" className="seal__letters">
          {letters[0]}
          {letters[1] !== undefined && (
            <>
              <tspan className="seal__amp">&amp;</tspan>
              {letters[1]}
            </>
          )}
        </text>
      </svg>
    </span>
  );
}
