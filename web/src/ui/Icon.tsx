/**
 * Truce's one icon set: drawn on a 20 px grid, 1.5 px stroke, round caps and
 * joins, rendered from a single inline sprite. Sizes are 16, 20 or 24.
 */
const PATHS = {
  plus: 'M10 4.5v11M4.5 10h11',
  'arrow-right': 'M4 10h12M11.5 5.5 16 10l-4.5 4.5',
  'arrow-left': 'M16 10H4M8.5 5.5 4 10l4.5 4.5',
  'arrow-down': 'M10 4v12M5.5 11.5 10 16l4.5-4.5',
  check: 'M4.5 10.5 8 14l7.5-8',
  'check-circle': 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM7 10.2l2.1 2.1 4-4.4',
  pencil: 'M12.8 4.2a1.6 1.6 0 0 1 2.3 0l.7.7a1.6 1.6 0 0 1 0 2.3L7.5 15.5 4 16l.5-3.5 8.3-8.3ZM11.5 5.5l3 3',
  x: 'M5.5 5.5l9 9M14.5 5.5l-9 9',
  search: 'M9 14.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM13 13l3.5 3.5',
  film: 'M3.5 4.5h13v11h-13zM6.5 4.5v11M13.5 4.5v11M3.5 8h3M3.5 12h3M13.5 8h3M13.5 12h3',
  restaurant: 'M5.5 3v4.5a2 2 0 0 0 4 0V3M7.5 3v14M14.5 17V3c-1.8 1-2.8 3.4-2.8 6.6 0 .8.6 1.4 1.4 1.4h1.4',
  music: 'M8 14.5V4.8l8-1.6v9.6M8 14.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM16 12.8a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM8 8l8-1.6',
  heart: 'M10 16.2S3.5 12.4 3.5 7.9A3.3 3.3 0 0 1 10 6.6a3.3 3.3 0 0 1 6.5 1.3c0 4.5-6.5 8.3-6.5 8.3Z',
  users: 'M7.5 9.5a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2ZM2.8 16.2c.3-2.6 2.2-4.3 4.7-4.3s4.4 1.7 4.7 4.3M13.6 9a2.2 2.2 0 1 0 0-4.4M14.5 12.1c1.6.3 2.6 1.7 2.8 3.6',
  phone: 'M6.5 2.5h7a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1ZM9 15h2',
  link: 'M8.6 11.4l2.8-2.8M10.5 6.4l1-1a2.9 2.9 0 0 1 4.1 4.1l-1 1M9.5 13.6l-1 1a2.9 2.9 0 0 1-4.1-4.1l1-1',
  share: 'M10 12.5V3M6.5 6.5 10 3l3.5 3.5M5 10H4v6.5h12V10h-1',
  copy: 'M7.5 7.5h8.5V16H7.5zM12.5 7.5V4H4v8.5h3.5',
  pin: 'M10 17s5.2-4.6 5.2-8.6a5.2 5.2 0 0 0-10.4 0C4.8 12.4 10 17 10 17ZM10 10.3a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8Z',
  calendar: 'M3.5 5h13v11.5h-13zM3.5 8.5h13M7 3v3.5M13 3v3.5',
  bridge: 'M2.5 14h15M4 14v-3M16 14v-3M2.5 11c2.6-2.9 4.8-4 7.5-4s4.9 1.1 7.5 4M10 7v7M7 8v6M13 8v6',
  gavel: 'M11.3 3.2l5.5 5.5M8.9 5.6l5.5 5.5M10.1 4.4l-1.2 1.2 5.5 5.5 1.2-1.2M11.6 8.4 4 16M3 17.5h7',
  scale: 'M10 3.5V16M6.5 16.5h7M4 6h12M4 6l-2 5h4L4 6ZM16 6l-2 5h4l-2-5ZM2 11a2 2 0 0 0 4 0M14 11a2 2 0 0 0 4 0',
  eye: 'M2.5 10S5.2 4.8 10 4.8s7.5 5.2 7.5 5.2-2.7 5.2-7.5 5.2S2.5 10 2.5 10ZM10 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z',
  'eye-off': 'M4 4l12 12M8.4 5c.5-.1 1-.2 1.6-.2 4.8 0 7.5 5.2 7.5 5.2s-.7 1.4-2.1 2.8M5.5 6.6C3.6 8 2.5 10 2.5 10s2.7 5.2 7.5 5.2c1.2 0 2.3-.3 3.2-.8M8.5 8.5a2.2 2.2 0 0 0 3 3',
  info: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM10 9.2v4.6M10 6.6v.1',
  warning: 'M10 3.5l7.5 13h-15L10 3.5ZM10 8.5v3.5M10 14.3v.1',
  error: 'M7.1 3h5.8L17 7.1v5.8L12.9 17H7.1L3 12.9V7.1L7.1 3ZM10 6.6v4.2M10 13.3v.1',
  retry: 'M15.8 10.8A5.9 5.9 0 1 1 14.2 5.8M15.5 3v3.4h-3.4',
  play: 'M6.5 4.8v10.4L15 10 6.5 4.8Z',
  'chevron-down': 'M5.5 8 10 12.5 14.5 8',
  'chevron-right': 'M8 5.5 12.5 10 8 14.5',
  home: 'M3.5 9.2 10 3.8l6.5 5.4v7.3h-4.3v-4.3H7.8v4.3H3.5V9.2Z',
  sliders: 'M4 6.5h6.5M14.5 6.5H16M4 13.5h1.5M9.5 13.5H16M12.5 8.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM7.5 15.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  exchange: 'M4 7h11.5M12.5 4 15.5 7l-3 3M16 13H4.5M7.5 10l-3 3 3 3',
  'fast-forward': 'M3.5 5.5 9.5 10l-6 4.5v-9ZM10 5.5l6 4.5-6 4.5v-9Z',
  quote: 'M4 4.5h12v8.5h-6l-3.5 3v-3H4V4.5Z',
  data: 'M4 16h12M6 13V9M10 13V5M14 13v-2.5',
  'wifi-off': 'M3 3l14 14M5.6 10.7a6.5 6.5 0 0 1 3.1-1.6M2.8 7.8A10 10 0 0 1 6 5.9M11.8 9.3a6.5 6.5 0 0 1 2.6 1.4M9.5 5.1a10 10 0 0 1 7.7 2.7M8.2 13.6a2.6 2.6 0 0 1 3.6 0',
} as const;

export type IconName = keyof typeof PATHS;

export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      {Object.entries(PATHS).map(([name, d]) => (
        <symbol key={name} id={`i-${name}`} viewBox="0 0 20 20">
          <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
      ))}
    </svg>
  );
}

interface IconProps {
  name: IconName;
  size?: 16 | 20 | 24;
  /** Give a label only when the icon carries meaning on its own. */
  label?: string;
  className?: string;
}

export function Icon({ name, size = 20, label, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className ? `icon ${className}` : 'icon'}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <use href={`#i-${name}`} />
    </svg>
  );
}
