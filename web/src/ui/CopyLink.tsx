import { useState } from 'react';
import { canShare, shareLink } from '@/lib/share';
import { Button } from './Button';
import { CopyButton } from './CopyButton';
import { Icon } from './Icon';

/** A link to hand over: shown in full, one tap to copy, the share sheet where there is one. */
export function CopyLink({ url, shareTitle, shareText }: { url: string; shareTitle: string; shareText: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="copylink">
      <div className="copylink__url">
        <Icon name="link" size={16} />
        <span className="copylink__text">{url.replace(/^https?:\/\//, '')}</span>
      </div>
      <div className="copylink__actions">
        <CopyButton text={url} onFail={() => setFailed(true)} />
        {canShare() && (
          <Button size="sm" icon="share" onClick={() => void shareLink({ title: shareTitle, text: shareText, url })}>
            Share
          </Button>
        )}
      </div>
      {failed && <p className="copylink__fail small">Copying didn&rsquo;t work here. Press and hold the link to copy it.</p>}
    </div>
  );
}
