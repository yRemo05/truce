import type { Slot } from '@contract';
import { useState } from 'react';
import { cx, Icon } from '@/ui';
import { SLOT_ICON } from '@/lib/truce';

const KIND: Record<Slot, string> = { film: 'Poster for', restaurant: 'Photo of', music: 'Picture of' };

interface ArtProps {
  name: string;
  imageUrl: string | null;
  slot: Slot;
  /** The intrinsic size the box reserves (its aspect ratio), so nothing shifts as the picture arrives. */
  width: number;
  height: number;
  /** Above the fold: fetch at once. Everything else waits until it's near. */
  eager?: boolean;
  className?: string;
}

/**
 * A pick's poster, photo or press picture at a fixed aspect ratio, cropped to
 * fill. With no picture, or one that fails, the app's typeset stand-in (as in
 * Thumb): the initial and the slot's glyph, so there's never a broken image.
 */
export function Art({ name, imageUrl, slot, width, height, eager = false, className }: ArtProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const shown = imageUrl && failed !== imageUrl;
  const initial = Array.from(name.replace(/^the\s+/i, '').trim())[0]?.toLocaleUpperCase() ?? '';
  return (
    <span className={cx('l-art', !shown && 'l-art--blank', className)} style={{ aspectRatio: `${width} / ${height}` }}>
      {shown ? (
        <img
          src={imageUrl}
          alt={`${KIND[slot]} ${name}`}
          width={width}
          height={height}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(imageUrl)}
        />
      ) : (
        <span className="l-art__stand-in" aria-hidden="true">
          <span className="l-art__initial">{initial}</span>
          <Icon name={SLOT_ICON[slot]} size={16} className="l-art__glyph" />
        </span>
      )}
    </span>
  );
}
