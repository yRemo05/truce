import type { Slot } from '@contract';
import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { SLOT_ICON, SLOT_LABEL } from '@/lib/truce';
import { cx } from './cx';
import { Icon } from './Icon';
import { Thumb } from './Thumb';

/** What the picture is, for a screen reader: a film's poster, a place's photo, an artist's picture. */
const ALT: Record<Slot, (name: string) => string> = {
  film: (n) => `Poster for ${n}`,
  restaurant: (n) => `Photo of ${n}`,
  music: (n) => `Picture of ${n}`,
};

interface PosterProps {
  slot: Slot;
  name: string;
  imageUrl: string | null;
  /** The whole tile opens this, when given. */
  href?: string;
  /** Short lines under the name, one each (who loved it, when). */
  meta?: ReactNode[];
  /** Show the slot's glyph and word above the name. */
  showSlot?: boolean;
  className?: string;
}

/**
 * A pick led by its picture (a poster, a photo, an artist), at 3:4, with its
 * name under it. Without a picture, the slot's typeset stand-in.
 */
export function Poster({ slot, name, imageUrl, href, meta, showSlot = true, className }: PosterProps) {
  const body = (
    <>
      <Thumb size="fill" slot={slot} name={name} imageUrl={imageUrl} alt={ALT[slot](name)} />
      <span className="poster__caption">
        {showSlot && (
          <span className="poster__slot">
            <Icon name={SLOT_ICON[slot]} size={16} />
            {SLOT_LABEL[slot]}
          </span>
        )}
        <span className="poster__name">{name}</span>
        {meta && meta.length > 0 && (
          <span className="poster__meta">
            {meta.map((line, i) => (
              <span key={i}>{line}</span>
            ))}
          </span>
        )}
      </span>
    </>
  );
  return href ? (
    <Link href={href} className={cx('poster poster--link', className)}>
      {body}
    </Link>
  ) : (
    <span className={cx('poster', className)}>{body}</span>
  );
}
