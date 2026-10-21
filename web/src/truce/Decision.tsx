import type { CardItem, LinkKind, PerSide, Slot } from '@contract';
import { useEffect, useState } from 'react';
import { api } from '@/api';
import { Badge, Button, ButtonLink, cx, ErrorNotice, Icon, InfoTip, LedgerMeter, PairNames, ScoreMeter, SectionHeader, Thumb, type IconName } from '@/ui';
import { eveningLabel } from '@/lib/format';
import { EXPLAIN } from '@/lib/glossary';
import { agentOf, nameOf, possessive } from '@/lib/people';
import { absolute, canShare, copyText, shareLink } from '@/lib/share';
import { gaveGround, isLastCall, SLOT_ICON, SLOT_LABEL, SLOTS, type FeedEntry, type TruceState } from '@/lib/truce';
import { useStartTruce } from '@/lib/useAction';
import { useFlash } from '@/lib/useFlash';
import { CheckinCard } from './CheckinCard';
import { useTruceCtx } from './context';
import { Hours } from './Hours';
import { Accepts } from './Moves';
import { Swaps } from './RefereeNote';
import { Serves } from './Serves';

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

const LINK_ICON: Record<LinkKind, IconName> = {
  imdb: 'film',
  letterboxd: 'film',
  netflix: 'play',
  spotify: 'music',
  maps: 'pin',
  website: 'link',
  menu: 'restaurant',
  phone: 'phone',
};

const delay = (ms: number) => ({ ['--delay' as string]: `${ms}ms` });

/** Where to act on a pick: watch, listen, find, book. */
function Links({ item }: { item: CardItem }) {
  if (!item.links.length) return null;
  return (
    <ul className="act-links" aria-label={`Links for ${item.name}`}>
      {item.links.map((l) => (
        <li key={l.url}>
          <a className="btn btn--outline btn--sm" href={l.url} {...(l.kind === 'phone' ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>
            <Icon name={LINK_ICON[l.kind]} size={16} />
            <span className="btn__label">{l.label}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function Pick({ item, index, animate }: { item: CardItem; index: number; animate: boolean }) {
  const { names, members } = useTruceCtx();
  const detail = DETAIL[item.slot](item).filter(Boolean).join(' · ');
  const area = item.slot === 'restaurant' ? item.facts.neighborhood : undefined;
  const address = item.slot === 'restaurant' ? (item.address ?? item.disambiguation) : null;
  return (
    <li className={cx('pick-row', animate && 'enter')} style={delay(120 + index * 90)}>
      <Thumb name={item.name} imageUrl={item.imageUrl} slot={item.slot} size="lg" />
      <div className="pick-row__text">
        <p className="pick-row__kind small muted">
          <Icon name={SLOT_ICON[item.slot]} size={16} />
          {SLOT_LABEL[item.slot]}
        </p>
        <h3 className="pick-row__name">{item.name}</h3>
        {detail && <p className="small muted">{detail}</p>}
        <Serves item={item} />
        {(area || address) && (
          <p className="pick-row__line small">
            <Icon name="pin" size={16} className="muted" />
            <span>
              {area}
              {area && address && address !== area && <span className="muted"> · </span>}
              {address && address !== area && <span className="muted">{address}</span>}
            </span>
          </p>
        )}
        <Hours hours={item.hours} />
        <p className="small muted num">Fit: {members.map((s) => `${nameOf(names, s)} ${item.scores[s] ?? 0}`).join(' · ')}</p>
        <Links item={item} />
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

/** "Add to calendar": the server builds the .ics; the mock makes one in the browser. Only for truces that know their evening. */
function CalendarLink({ truceId }: { truceId: string }) {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void api.calendarUrl(truceId).then((url) => alive && setHref(url));
    return () => {
      alive = false;
    };
  }, [truceId]);
  if (!href) return null;
  return (
    <a className="btn btn--outline" href={href} download="tonight.ics">
      <Icon name="calendar" size={20} />
      <span className="btn__label">Add to calendar</span>
    </a>
  );
}

/** The evening: three picks to act on, and what to do next. */
function EveningCard({ state, truceId, pairId, stamp }: { state: TruceState; truceId: string; pairId: string; stamp: boolean }) {
  const { names, members, location } = useTruceCtx();
  const again = useStartTruce(pairId);
  const result = state.result!;
  const items = SLOTS.map((s) => state.items[result.bundle[s]]).filter((x): x is CardItem => Boolean(x));
  const tonight = state.tonight;
  const owed = state.ledger?.after.owed ?? null;
  return (
    <section className={cx('card plan__card', stamp && 'plan--live')} aria-labelledby="plan-title">
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
          Tonight’s plan for <PairNames names={names} members={members} />
        </h2>
        <p className="small muted">{[location, tonight && eveningLabel(tonight.date, tonight.weekday)].filter(Boolean).join(' · ')}</p>
      </header>

      <ul className="plan__picks">
        {items.map((item, i) => (
          <Pick key={item.slot} item={item} index={i} animate={stamp} />
        ))}
      </ul>

      <div className="plan__actions">
        <Button variant="primary" icon="plus" busy={again.busy} onClick={() => void again.run()}>
          New truce
        </Button>
        {tonight && <CalendarLink truceId={truceId} />}
        <ShareButton text={`Our plan for tonight: ${items.map((i) => i.name).join(', ')}.`} />
        <ButtonLink variant="ghost" icon="home" href={`/p/${pairId}`}>
          Group page
        </ButtonLink>
      </div>
      <p className="small muted">
        New truce runs again with the same favourites{owed ? `, and ${agentOf(nameOf(names, owed))} gets a bit more say` : ''}.
      </p>
      {again.error && <ErrorNotice error={again.error} title="Couldn't start another truce" />}
    </section>
  );
}

const lastOf = <K extends FeedEntry['kind']>(feed: readonly FeedEntry[], kind: K) =>
  feed.findLast((e): e is Extract<FeedEntry, { kind: K }> => e.kind === kind);

/** How the evening was reached: everyone's yes or the referee's ruling, any polish, and how close each person got. */
function HowCard({ state, stamp }: { state: TruceState; stamp: boolean }) {
  const { names, members, turns } = useTruceCtx();
  const result = state.result!;
  const agreement = lastOf(state.feed, 'agreement');
  const declined = lastOf(state.feed, 'declined');
  const polish = lastOf(state.feed, 'polish');
  const gave = gaveGround(result.concession, members);
  return (
    <section className={cx('card decision__card', stamp && 'enter')} style={delay(420)} aria-labelledby="how-title">
      <SectionHeader icon={state.ruled ? 'gavel' : 'check-circle'} id="how-title" title="How you got here" />
      {state.ruled ? (
        <div className="decision__block">
          <p>
            No deal by the last call, so the referee picked the evening that does best by everyone.{' '}
            <InfoTip label="About Truce’s call">{EXPLAIN.ruling}</InfoTip>
          </p>
          {declined && <p className="small muted">{agentOf(nameOf(names, declined.event.side))} said no on the last call.</p>}
        </div>
      ) : (
        <div className="decision__block">
          <p>Your agents agreed {isLastCall(result.turnsUsed, turns) ? 'on the last call' : `on turn ${result.turnsUsed}`}.</p>
          {agreement && <Accepts acceptedBy={agreement.event.by} />}
        </div>
      )}
      {polish && (
        <div className="decision__block">
          <p>
            Then the referee made a small improvement. <InfoTip label="About the improvement">{EXPLAIN.polish}</InfoTip>
          </p>
          <Swaps event={polish.event} />
        </div>
      )}
      <div className="decision__block">
        <h3 className="plan__label">
          How close each of you got
          <InfoTip label="What how close means">{EXPLAIN.closeness}</InfoTip>
        </h3>
        <div className="plan__close">
          {members.map((side) => {
            const close = Math.round((1 - (result.concession[side] ?? 0)) * 100);
            const name = nameOf(names, side);
            return <ScoreMeter key={side} side={side} name={name} value={close} label={`${name}: ${close} of 100, where 100 is ${possessive(name)} best evening tonight`} />;
          })}
        </div>
        <p className="small muted">{gave ? `${nameOf(names, gave)} gave a little more ground tonight.` : 'You met in the middle tonight.'}</p>
      </div>
    </section>
  );
}

function LedgerCard({ ledger, stamp }: { ledger: NonNullable<TruceState['ledger']>; stamp: boolean }) {
  const { names, letters, members } = useTruceCtx();
  return (
    <section className={cx('card decision__card', stamp && 'enter')} style={delay(560)} aria-labelledby="ledger-title">
      <SectionHeader icon="scale" id="ledger-title" title="Fairness ledger" info={<InfoTip label="What the fairness ledger does">{EXPLAIN.ledger}</InfoTip>} />
      <LedgerMeter
        members={members}
        names={names}
        letters={letters}
        alpha={ledger.after.alpha}
        tilt={ledger.after.tilt}
        owed={ledger.after.owed}
        from={stamp ? ledger.before.alpha : undefined}
        delay={stamp ? 900 : 0}
      />
    </section>
  );
}

interface DecisionProps {
  state: TruceState;
  truceId: string;
  pairId: string;
  checkedIn: PerSide<boolean>;
  /** The decision just arrived live: animate it in. */
  stamp: boolean;
  /** Go back to following the truce live. */
  onFollow: () => void;
}

/**
 * Decision: the evening with its links, how it was reached, everyone's score,
 * where the ledger leans next time, and the check-in for afterwards.
 */
export function Decision({ state, truceId, pairId, checkedIn, stamp, onFollow }: DecisionProps) {
  const { names, letters, members } = useTruceCtx();
  if (!state.result) {
    if (state.error) return null;
    return (
      <div className="phase phase--decision">
        <section className="card decision__empty" aria-labelledby="pending-title">
          <SectionHeader icon="hourglass" id="pending-title" title="No decision yet" meta="It comes when every agent says yes, or when the referee rules after the last call." />
          <Button size="sm" iconEnd="arrow-right" onClick={onFollow}>
            Follow the talks
          </Button>
        </section>
      </div>
    );
  }
  return (
    <div className="phase phase--decision">
      <div className="decision__main">
        <EveningCard state={state} truceId={truceId} pairId={pairId} stamp={stamp} />
      </div>
      <div className="decision__side">
        <HowCard state={state} stamp={stamp} />
        {state.ledger && <LedgerCard ledger={state.ledger} stamp={stamp} />}
        <CheckinCard
          members={members}
          names={names}
          letters={letters}
          truceId={truceId}
          checkedIn={checkedIn}
          title="After the evening"
          meta="Each of you says how it really went."
          className={cx(stamp && 'enter')}
        />
      </div>
    </div>
  );
}
