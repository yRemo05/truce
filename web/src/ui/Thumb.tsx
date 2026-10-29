import type { Slot } from '@contract';
import { useState } from 'react';
import { SLOT_ICON } from '@/lib/truce';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

interface ThumbProps {
  name: string;
  imageUrl: string | null;
  slot: Slot;
  /** sm and lg are fixed squares; fill takes its parent's width at a poster's 3:4. */
  size?: 'sm' | 'lg' | 'fill';
  /** The stand-in glyph when there's no picture; the slot's own by default. */
  glyph?: IconName;
  /**
   * What the picture shows ("Poster for Moonlight"), when it stands on its
   * own. Without it the picture is decorative: the name sits beside it.
   */
  alt?: string;
  className?: string;
}

/** Intrinsic sizes, so a lazy picture holds its box before it loads. */
const PIXELS = { sm: [40, 40], lg: [80, 80], fill: [300, 400] } as const;

/** An item's picture, or a typeset stand-in when Qloo has none (many places and artists don't). */
export function Thumb({ name, imageUrl, slot, size = 'sm', glyph, alt, className }: ThumbProps) {
  const [failed, setFailed] = useState(false);
  const showImage = imageUrl && !failed;
  const initial = Array.from(name.replace(/^the\s+/i, '').trim())[0]?.toLocaleUpperCase() ?? '';
  const [width, height] = PIXELS[size];
  const big = size !== 'sm';
  return (
    <span
      className={cx('thumb', `thumb--${size}`, !showImage && 'thumb--blank', className)}
      {...(alt ? (showImage ? {} : { role: 'img', 'aria-label': alt }) : { 'aria-hidden': true })}
    >
      {showImage ? (
        <img src={imageUrl} alt={alt ?? ''} width={width} height={height} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <>
          {big && <span className="thumb__initial">{initial}</span>}
          <Icon name={glyph ?? SLOT_ICON[slot]} size={big ? 20 : 16} className="thumb__glyph" />
        </>
      )}
    </span>
  );
}
