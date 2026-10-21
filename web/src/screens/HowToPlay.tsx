/*
 * How you'll play (/p/:pairId/play) — step 2 of 3.
 *
 * Inventory: one choice (same phone / send a link), the group link when sending,
 * then one primary action: start the first person's picks.
 * Viewport budget: both options and the action above the fold at both sizes.
 * Grid: the two options side by side (stacked on a phone).
 * Icons: phone, link, arrow-right.
 */
import { useState } from 'react';
import { useLocation } from 'wouter';
import { Button, CopyLink, cx, ErrorNotice, Icon, Page, Skeleton } from '@/ui';
import { withPass } from '@/lib/flow';
import { listNames, nameOf, possessive } from '@/lib/people';
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
  const link = absolute(`/p/${pairId}`);
  const first = pair ? nameOf(pair.names, pair.members[0]!) : '';
  const others = pair ? listNames(pair.members.slice(1).map((s) => nameOf(pair.names, s))) : '';
  const couple = pair?.members.length === 2;

  const options: { value: Way; icon: 'phone' | 'link'; title: string; text: string }[] = [
    {
      value: 'pass',
      icon: 'phone',
      title: 'Same phone',
      text: pair ? `${first} picks, then passes the phone to ${couple ? others : `${others}, in turn`}. Each person’s picks stay hidden.` : '',
    },
    {
      value: 'link',
      icon: 'link',
      title: 'Send a link',
      text: pair ? `Everyone picks on their own phone. ${others} ${couple ? 'gets' : 'get'} a link.` : '',
    },
  ];

  return (
    <Page title="How you'll play" className="setup">
      <div className="setup__inner">
        <div className="card setup__card">
          <Steps current={2} />
          <header className="setup__head">
            <h1 className="h2">How will you play?</h1>
            <p className="muted">Each of you picks your favourites. Nobody sees anyone else&rsquo;s.</p>
          </header>

          {error && <ErrorNotice error={error} title="Couldn't load this truce" onRetry={reload} />}

          <fieldset className="ways">
            <legend className="visually-hidden">How you&rsquo;ll play</legend>
            {options.map((o) => (
              <label key={o.value} className={cx('way', way === o.value && 'is-on')}>
                <input type="radio" name="way" className="visually-hidden" checked={way === o.value} onChange={() => setWay(o.value)} />
                <span className="way__icon">
                  <Icon name={o.icon} size={20} />
                </span>
                <span className="way__title">{o.title}</span>
                <span className="way__text small muted">{o.text || <Skeleton h="2.5rem" />}</span>
                <span className="way__check" aria-hidden="true">
                  <Icon name="check" size={16} />
                </span>
              </label>
            ))}
          </fieldset>

          {way === 'link' && pair && (
            <div className="setup__link">
              <p className="small">
                Send this to {couple ? others : 'the group'}. Each of you opens it and taps your name.
              </p>
              <CopyLink url={link} shareTitle="Our truce" shareText={`${first} started a truce for tonight. Add your picks:`} />
            </div>
          )}

          <div className="setup__submit">
            <Button
              variant="primary"
              iconEnd="arrow-right"
              disabled={!pair}
              onClick={() => pair && navigate(withPass(`/p/${pairId}/${pair.members[0]}`, way === 'pass'))}
            >
              {pair ? `Continue to ${possessive(first)} favourites` : 'Continue'}
            </Button>
          </div>
        </div>
      </div>
    </Page>
  );
}
