import type { CSSProperties } from 'react';

/** A placeholder block shaped like the content it stands in for. */
export function Skeleton({ w, h, round, delay }: { w?: number | string; h: number | string; round?: boolean; delay?: number }) {
  const style = { width: w ?? '100%', height: h, '--delay': delay ? `${delay}ms` : undefined } as CSSProperties;
  return <span className={round ? 'skeleton skeleton--round' : 'skeleton'} style={style} aria-hidden="true" />;
}
