import { canShare, copyText, shareLink } from '@/lib/share';
import { useFlash } from '@/lib/useFlash';
import { Button } from './Button';
import { Icon } from './Icon';

/** A link to hand over: shown in full, one tap to copy, the share sheet where there is one. */
export function CopyLink({ url, shareTitle, shareText }: { url: string; shareTitle: string; shareText: string }) {
  const [state, setState] = useFlash<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => setState((await copyText(url)) ? 'copied' : 'failed');

  return (
    <div className="copylink">
      <div className="copylink__url">
        <Icon name="link" size={16} />
        <span className="copylink__text">{url.replace(/^https?:\/\//, '')}</span>
      </div>
      <div className="copylink__actions">
        <Button size="sm" icon={state === 'copied' ? 'check' : 'copy'} onClick={copy}>
          {state === 'copied' ? 'Copied' : 'Copy link'}
        </Button>
        {canShare() && (
          <Button size="sm" icon="share" onClick={() => void shareLink({ title: shareTitle, text: shareText, url })}>
            Share
          </Button>
        )}
      </div>
      <span className="visually-hidden" role="status">
        {state === 'copied' ? 'Link copied.' : state === 'failed' ? 'Copying failed. Select the link and copy it by hand.' : ''}
      </span>
      {state === 'failed' && <p className="copylink__fail small">Copying didn&rsquo;t work here. Press and hold the link to copy it.</p>}
    </div>
  );
}
