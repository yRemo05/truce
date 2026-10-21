import type { CardItem, Slot } from '@contract';
import { Badge, Button, ButtonLink, cx, ErrorNotice, Icon, InfoTip, LedgerMeter, PairNames, ScoreMeter, Thumb } from '@/ui';
import { longDate } from '@/lib/format';
import { EXPLAIN } from '@/lib/glossary';
import { agentOf, possessive, SIDES } from '@/lib/people';
import { absolute, canShare, copyText, shareLink } from '@/lib/share';
import { gaveGround, isLastCall, SLOT_ICON, SLOT_LABEL, SLOTS, type TruceState } from '@/lib/truce';
import { useStartTruce } from '@/lib/useAction';
import { useFlash } from '@/lib/useFlash';
import { useTruceCtx } from './context';
import { placeLine } from './Evening';

/** The first few items of a comma-separated Qloo list. */
const firstOf = (list: string | undefined, n = 2) =>
  list
    ?.split(',')
    .slice(0, n)
    .map((s) => s.trim())
    .join(', ');

/** The line under each pick's name. */
const DETAIL: Record<Slot, (item: CardItem) => (string | null | undefined)[]> = {
  film: (i) => [i.disambiguation, firstOf(i.facts.genres), i.facts.minutes && `${i.facts.minutes} min`],
  restaurant: (i) => [i.facts.cuisineType, i.facts.price],
  music: (i) => [firstOf(i.facts.genres) ?? i.disambiguation],
};

function Pick({ item, index, animate }: { item: CardItem; index: number; animate: boolean }) {
  const { names } = useTruceCtx();
  const detail = DETAIL[item.slot](item).filter(Boolean).join(' · ');
  const place = item.slot === 'restaurant' ? placeLine(item) : null;
  const address = place && item.disambiguation !== place ? item.disambiguation : null;
  return (
    <li className={cx('pick-row', animate && 'enter')} style={{ ['--delay' as string]: `${120 + index * 90}ms` }}>
      <Thumb name={item.name} imageUrl={item.imageUrl} slot={item.slot} size="lg" />
      <div className="pick-row__text">
        <p className="pick-row__kind small muted">
          <Icon name={SLOT_ICON[item.slot]} size={16} />
          {SLOT_LABEL[item.slot]}
        </p>
        <h3 className="pick-row__name">{item.name}</h3>
        {detail && <p className="small muted">{detail}</p>}
        {place && (
          <p className="pick-row__place small">
            <Icon name="pin" size={16} />
            <span>
              {place}
              {address && <span className="muted"> · {address}</span>}
            </span>
          </p>
        )}
        <p className="small muted num">
          Fit: {names.a} {item.scores.a} · {names.b} {item.scores.b}
        </p>
      </div>
    </li>
  );
}

function ShareButton({ text }: { text: string }) {
  const [state, setState] = useFlash<'idle' | 'copied' | 'failed'>('idle');
  const share = async () => {
    const url = absolute(window.location.pathname);
    if (canShare() && (await shareLink({ title: 'Our plan for tonight', text, url }))) return;
    setState((await copyText(url)) ? 'copied' : 'failed');
  };
  return (
    <>
      <Button variant="outline" icon={state === 'copied' ? 'check' : 'share'} onClick={share}>
        {state === 'copied' ? 'Link copied' : state === 'failed' ? 'Copy the address bar' : 'Share'}
      </Button>
      <span className="visually-hidden" role="status">
        {state === 'copied' ? 'Link copied.' : state === 'failed' ? 'Copying failed. Copy the address from the address bar.' : ''}
      </span>
    </>
  );
}

export function Plan({ state, pairId, date, stamp }: { state: TruceState; pairId: string; date: string | null; stamp: boolean }) {
  const { names, letters, turns } = useTruceCtx();
  const again = useStartTruce(pairId);
  const result = state.result!;
  const items = SLOTS.map((s) => state.items[result.bundle[s]]).filter((x): x is CardItem => Boolean(x));
  const gave = gaveGround(result.concession);
  const how = state.ruled
    ? 'Your agents didn’t agree, so the referee picked the fairest evening.'
    : `Your agents agreed ${isLastCall(result.turnsUsed, turns) ? 'on the last call' : `on turn ${result.turnsUsed}`}${result.polished ? ', and the referee made a small improvement' : ''}.`;

  return (
    <section className={cx('plan', stamp && 'plan--live')} aria-labelledby="plan-title">
      <div className="card plan__card">
        <header className="plan__head">
          <div className="plan__verdict">
            {state.ruled ? (
              <>
                <Badge variant="secondary" icon="gavel">
                  Truce’s call
                </Badge>
                <InfoTip label="About Truce’s call">{EXPLAIN.ruling}</InfoTip>
              </>
            ) : (
              <Badge variant="success" icon="check-circle">
                You chose this together
              </Badge>
            )}
          </div>
          <h2 id="plan-title" className="h2">
            Tonight’s plan for <PairNames names={names} />
          </h2>
          <p className="muted">{how}</p>
          {date && <p className="small muted">{longDate(date)}</p>}
        </header>

        <ul className="plan__picks">
          {items.map((item, i) => (
            <Pick key={item.slot} item={item} index={i} animate={stamp} />
          ))}
        </ul>

        <div className="plan__grid">
          <div className={cx('plan__block', stamp && 'enter')} style={{ ['--delay' as string]: '420ms' }}>
            <h3 className="plan__label">
              How close each of you got
              <InfoTip label="What how close means">{EXPLAIN.closeness}</InfoTip>
            </h3>
            <div className="plan__close">
              {SIDES.map((side) => {
                const close = Math.round((1 - result.concession[side]) * 100);
                return (
                  <ScoreMeter
                    key={side}
                    side={side}
                    name={names[side]}
                    value={close}
                    label={`${names[side]}: ${close} of 100, where 100 is ${possessive(names[side])} best evening tonight`}
                  />
                );
              })}
            </div>
            <p className="small muted">{gave ? `${names[gave]} gave a little more ground tonight.` : 'You met in the middle tonight.'}</p>
          </div>

          {state.ledger && (
            <div className={cx('plan__block', stamp && 'enter')} style={{ ['--delay' as string]: '560ms' }}>
              <h3 className="plan__label">
                Fairness ledger
                <InfoTip label="What the fairness ledger does">
                  {EXPLAIN.ledger}
                </InfoTip>
              </h3>
              <LedgerMeter
                names={names}
                letters={letters}
                alphaA={state.ledger.after.alphaA}
                tilt={state.ledger.after.tilt}
                owed={state.ledger.after.owed}
                from={stamp ? state.ledger.before.alphaA : undefined}
                delay={stamp ? 900 : 0}
              />
            </div>
          )}
        </div>

        <div className="plan__actions">
          <Button variant="primary" icon="plus" busy={again.busy} onClick={() => void again.run()}>
            New truce
          </Button>
          <ShareButton text={`Our plan for tonight: ${items.map((i) => i.name).join(', ')}.`} />
          <ButtonLink variant="ghost" icon="home" href={`/p/${pairId}`}>
            Pair page
          </ButtonLink>
        </div>
        <p className="small muted">
          New truce runs again with the same favourites
          {state.ledger?.after.owed ? `, and ${agentOf(names[state.ledger.after.owed])} gets a bit more say` : ''}.
        </p>
        {again.error && <ErrorNotice error={again.error} title="Couldn't start another truce" />}
      </div>
    </section>
  );
}
