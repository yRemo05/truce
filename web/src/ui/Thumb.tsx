import type { Slot } from '@contract';
import { useState } from 'react';
import { SLOT_ICON } from '@/lib/truce';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

interface ThumbProps {
  name: string;
  imageUrl: string | null;
  slot: Slot;
  size?: 'sm' | 'lg';
  /** The stand-in glyph when there's no picture; the slot's own by default. */
  glyph?: IconName;
  className?: string;
}

/** An item's picture, or a typeset stand-in when Qloo has none (many places and artists don't). */
export function Thumb({ name, imageUrl, slot, size = 'sm', glyph, className }: ThumbProps) {
  const [failed, setFailed] = useState(false);
  const showImage = imageUrl && !failed;
  const initial = Array.from(name.replace(/^the\s+/i, '').trim())[0]?.toLocaleUpperCase() ?? '';
  return (
    <span className={cx('thumb', `thumb--${size}`, !showImage && 'thumb--blank', className)} aria-hidden="true">
      {showImage ? (
        <img src={imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <>
          {size === 'lg' && <span className="thumb__initial">{initial}</span>}
          <Icon name={glyph ?? SLOT_ICON[slot]} size={size === 'lg' ? 20 : 16} className="thumb__glyph" />
        </>
      )}
    </span>
  );
}
