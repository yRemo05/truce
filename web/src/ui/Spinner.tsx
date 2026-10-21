export function Spinner({ size = 20, label }: { size?: 16 | 20 | 24; label?: string }) {
  return (
    <svg
      className="spinner"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.5" />
      <path d="M10 3a7 7 0 0 1 7 7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
