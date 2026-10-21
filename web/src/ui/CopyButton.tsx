import { copyText } from '@/lib/share';
import { useFlash } from '@/lib/useFlash';
import { Button } from './Button';
import { cx } from './cx';

interface CopyButtonProps {
  text: string;
  /** The visible label; "Copied" replaces it for a moment after a copy. */
  label?: string;
  /** What screen readers hear, when the label alone is ambiguous ("Copy Ecrin's link"). */
  description?: string;
  /** Hide the label on narrow screens, keeping the icon. */
  compact?: boolean;
  onFail?: () => void;
}

/** One tap to copy, with a moment of "Copied" and a spoken confirmation. */
export function CopyButton({ text, label = 'Copy link', description, compact, onFail }: CopyButtonProps) {
  const [state, setState] = useFlash<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    const ok = await copyText(text);
    setState(ok ? 'copied' : 'failed');
    if (!ok) onFail?.();
  };
  return (
    <>
      <Button size="sm" icon={state === 'copied' ? 'check' : 'copy'} className={cx(compact && 'btn--compact')} aria-label={description} onClick={copy}>
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Couldn’t copy' : label}
      </Button>
      <span className="visually-hidden" role="status">
        {state === 'copied' ? 'Link copied.' : state === 'failed' ? 'Copying failed.' : ''}
      </span>
    </>
  );
}
