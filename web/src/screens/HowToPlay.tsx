/*
 * How you'll play (/p/:pairId/play) — step 2 of 3.
 *
 * Inventory: one choice (same phone / send a link), the pair link when sending,
 * then one primary action: start the first person's picks.
 * Viewport budget: both options and the action above the fold at both sizes.
 * Grid: the two options side by side in columns 1–8 (stacked on a phone),
 * the setup steps in 9–12. Icons: phone, link, eye-off (privacy), arrow-right.
 */
import { useState } from 'react';
import { useLocation } from 'wouter';
import { Button, CopyLink, cx, ErrorNotice, Icon, Page, Skeleton } from '@/ui';
import { withPass } from '@/lib/flow';
import { possessive } from '@/lib/people';
import { absolute } from '@/lib/share';
import { usePair } from '@/lib/usePair';
import { NotFound } from './NotFound';
import { Steps } from './Steps';

type Way = 'pass' | 'link';

export function HowToPlay({ pairId }: { pairId: string }) {
  const [, navigate] = useLocation();
  const { pair, error, reload } = usePair(pairId);
  const [way, setWay] = useState<Way>('pass');

  if (error?.status === 404) return <NotFound what="pair" />;
  const names = pair?.names;
  const link = absolute(`/p/${pairId}`);

  const options: { value: Way; icon: 'phone' | 'link'; title: string; text: string }[] = [
    {
      value: 'pass',
      icon: 'phone',
      title: 'Same phone',
      text: names ? `${names.a} picks, then passes the phone to ${names.b}. Each side stays hidden from the other.` : '',
    },
    {
      value: 'link',
      icon: 'link',
      title: 'Send a link',
      text: names ? `Each of you picks on your own phone. ${names.b} gets a link.` : '',
    },
  ];

  return (
    <Page title="How you'll play" className="setup">
      <div className="grid setup__grid">
        <div className="setup__form">
          <h1 className="display-l">How you&rsquo;ll play</h1>
          <p className="lede">Each of you tells Truce what you love. Nobody sees the other&rsquo;s picks.</p>

          {error && <ErrorNotice error={error} title="Couldn't load this pair" onRetry={reload} />}

          <fieldset className="ways">
            <legend className="visually-hidden">How you&rsquo;ll play</legend>
            {options.map((o) => (
              <label key={o.value} className={cx('way', way === o.value && 'is-on')}>
                <input type="radio" name="way" className="visually-hidden" checked={way === o.value} onChange={() => setWay(o.value)} />
                <span className="way__icon">
                  <Icon name={o.icon} size={24} />
                </span>
                <span className="way__title">{o.title}</span>
                <span className="way__text small muted">{o.text || <Skeleton h="2.5rem" />}</span>
                <span className="way__check" aria-hidden="true">
                  <Icon name="check" size={16} />
                </span>
              </label>
            ))}
          </fieldset>

          {way === 'link' && names && (
            <div className="setup__link">
              <p className="small">
                <strong>Send {names.b} this link.</strong> Open it again yourself any time to see who&rsquo;s ready.
              </p>
              <CopyLink url={link} shareTitle="Our truce" shareText={`${names.a} started a truce for tonight. Add your picks:`} />
            </div>
          )}

          <div className="setup__submit">
            <Button
              variant="primary"
              iconEnd="arrow-right"
              disabled={!names}
              onClick={() => navigate(withPass(`/p/${pairId}/a`, way === 'pass'))}
            >
              {names ? `Start ${possessive(names.a)} picks` : 'Start the picks'}
            </Button>
          </div>
        </div>

        <aside className="setup__aside">
          <Steps current={2} />
        </aside>
      </div>
    </Page>
  );
}
