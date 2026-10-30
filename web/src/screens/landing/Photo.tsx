import type { CSSProperties, ReactNode } from 'react';
import { cx } from '@/ui';

interface PhotoProps {
  /** A self-hosted photo under public/img (credited in public/img/CREDITS.md). */
  src: string;
  /** Intrinsic size: the box keeps this ratio, so nothing shifts as it arrives. */
  width: number;
  height: number;
  /** A short caption laid over the bottom edge. */
  caption?: ReactNode;
  /** Stagger for the reveal, in ms. */
  delay?: number;
  className?: string;
}

/**
 * A decorative landing photo: lazy, empty alt (the text beside it carries the
 * meaning), cropped to a fixed ratio, revealed with a wipe as it comes on
 * screen (data-reveal="wipe", see landing.css).
 */
export function Photo({ src, width, height, caption, delay = 0, className }: PhotoProps) {
  return (
    <div className={cx('l-photo', className)} data-reveal="wipe" style={{ '--d': `${delay}ms` } as CSSProperties}>
      <span className="l-photo__frame" style={{ aspectRatio: `${width} / ${height}` }}>
        <img src={src} alt="" width={width} height={height} loading="lazy" decoding="async" />
      </span>
      {caption && <span className="l-photo__cap">{caption}</span>}
    </div>
  );
}
