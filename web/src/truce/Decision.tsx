/*
 * Decision, with swaps (owner-approved, 2026-10-22).
 *
 * Inventory, by priority:
 *   primary   — the evening as it stands after any swaps: one full-width row per item, with what it
 *               is, everyone's fit, where and when, and its links
 *   primary   — an open request, on top: who asked and why, the question, the answers, the tally and
 *               the countdown, Withdraw for the asker
 *   secondary — each row's Swap (a sheet: who's asking, why, what happens next); plan tonight again
 *               (New truce once the evening is settled), calendar, share, group page
 *   secondary — how it was reached, then every swap since in plain words; the ledger; the check-in
 *   rare      — why swapping is off: a vote waiting, someone checked in, the evening passed
 *
 * Viewport budget: at 1440×900 the vote card sits on top of the plan (7 columns), so it reads as a
 * change to that plan; how / swaps / ledger / check-in on the right (5). At 390×844 one column: the
 * vote card, then the plan; its first row and Swap are above the fold.
 * Grid: rows are thumb | what (name, details, fit, serves) | where (address, hours, links) on a wide
 * card, Swap at each row's top right; on a phone "where" sits under "what" in the same column.
 * Icons: exchange (swap), retry (plan again), users (asks the group), gavel (the referee picks),
 * hourglass / check-circle / calendar (why swapping is off), check / x (answers), film / restaurant /
 * music (keep), arrow-right (from → to), ban (taste swap used).
 */
import type { CardItem, PerSide, Side, SwapLock, SwapsView } from '@contract';
import { useEffect, useState } from 'react';
import { api } from '@/api';
import { Badge, Button, ButtonLink, cx, ErrorNotice, Icon, InfoTip, LedgerMeter, PairNames, ScoreMeter, SectionHeader, Skeleton, type IconName } from '@/ui';
import { eveningLabel } from '@/lib/format';
import { EXPLAIN } from '@/lib/glossary';
import { agentOf, nameOf, possessive } from '@/lib/people';
import { absolute, canShare, copyText, shareLink } from '@/lib/share';
import { openOf, outcomeLine, wasSwapped } from '@/lib/swaps';
import { gaveGround, isLastCall, SLOT_NOUN, SLOTS, type FeedEntry, type TruceState } from '@/lib/truce';
import { useStartTruce } from '@/lib/useAction';
import { useFlash } from '@/lib/useFlash';
import type { Swaps } from '@/lib/useSwaps';
import { CheckinCard } from './CheckinCard';
import { useTruceCtx } from './context';
import { Accepts } from './Moves';
import { PlanRow } from './PlanRow';
import { PolishSwaps } from './RefereeNote';
import { SwapHistory } from './SwapHistory';
import { SwapSheet, type Ask } from './SwapSheet';
import { VoteCard } from './SwapVote';

const delay = (ms: number) => ({ ['--delay' as string]: `${ms}ms` });

/** Why swapping is off, under the plan's heading; the other locks show nothing here. */
const LOCKED: Partial<Record<SwapLock, { icon: IconName; text: string }>> = {
  open: { icon: 'hourglass', text: 'A request is waiting for votes.' },
  checked_in: { icon: 'check-circle', text: 'Someone checked in, so this evening is settled.' },
  past: { icon: 'calendar', text: 'This evening has passed.' },
  superseded: { icon: 'calendar', text: 'The group has planned a newer evening since, so this one stays as it was.' },
};

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
function CalendarLink({ truceId, version }: { truceId: string; version: string }) {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void api.calendarUrl(truceId).then((url) => alive && setHref(url));
    return () => {
      alive = false;
    };
  }, [truceId, version]);
  if (!href) return null;
  return (
    <a className="btn btn--outline" href={href} download="tonight.ics">
      <Icon name="calendar" size={20} />
      <span className="btn__label">Add to calendar</span>
    </a>
  );
}

interface EveningProps {
  state: TruceState;
  truceId: string;
  pairId: string;
  stamp: boolean;
  swaps: Swaps;
  /** Who the ledger favours next time, with the evening as it stands. */
  owed: Side | null;
  onAsk: (ask: Ask) => void;
}

/** The evening: one row per item to act on, each with its Swap, and what to do next. */
function EveningCard({ state, truceId, pairId, stamp, swaps, owed, onAsk }: EveningProps) {
  const { names, members, location } = useTruceCtx();
  const again = useStartTruce(pairId);
  const { view, loadError } = swaps;
  const result = state.result!;
  const bundle = view?.bundle ?? result.bundle;
  const items = SLOTS.map((s) => state.items[bundle[s]]).filter((x): x is CardItem => Boolean(x));
  const tonight = state.tonight;
  const open = openOf(view);
  const lock = view?.lock ?? null;
  // Swapping and planning again are offered on an evening that takes requests, or is waiting on one.
  const takes = view !== null && (lock === null || lock === 'open');
  const locked = lock ? LOCKED[lock] : undefined;

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
        {locked && (
          <p className="icon-line small muted">
            <Icon name={locked.icon} size={16} />
            {locked.text}
          </p>
        )}
      </header>

      <ul className="plan__rows">
        {items.map((item, i) => {
          const swapped = item.id !== result.bundle[item.slot];
          return (
            <PlanRow
              key={item.id}
              item={item}
              explain={i === 0}
              className={cx((stamp || swapped) && 'enter')}
              style={delay(stamp ? 120 + i * 90 : 0)}
              status={
                <>
                  {swapped && (
                    <Badge variant="success" icon="exchange">
                      Swapped
                    </Badge>
                  )}
                  {open?.slot === item.slot && (
                    <Badge variant="warning" icon="hourglass">
                      Vote open
                    </Badge>
                  )}
                </>
              }
              action={
                takes && (
                  <Button size="sm" variant="ghost" icon="exchange" disabled={lock === 'open'} aria-label={`Swap the ${SLOT_NOUN[item.slot]}`} onClick={() => onAsk({ kind: 'swap', slot: item.slot })}>
                    Swap
                  </Button>
                )
              }
            />
          );
        })}
      </ul>

      <div className="plan__actions">
        {view === null && loadError === null ? (
          <Skeleton w="11.5rem" h="var(--control-h)" />
        ) : takes ? (
          <Button variant="secondary" icon="retry" disabled={lock === 'open'} onClick={() => onAsk({ kind: 'replan' })}>
            Plan tonight again
          </Button>
        ) : (
          <Button variant="primary" icon="plus" busy={again.busy} onClick={() => void again.run()}>
            New truce
          </Button>
        )}
        {tonight && <CalendarLink truceId={truceId} version={SLOTS.map((s) => bundle[s]).join()} />}
        <ShareButton text={`Our plan for tonight: ${items.map((i) => i.name).join(', ')}.`} />
        <ButtonLink variant="ghost" icon="home" href={`/p/${pairId}`}>
          Group page
        </ButtonLink>
      </div>
      <p className="small muted">
        {takes
          ? 'Something can’t happen, or doesn’t feel right? Swap that one item, or plan tonight again.'
          : `New truce runs again with the same favourites${owed ? `, and ${agentOf(nameOf(names, owed))} gets a bit more say` : ''}.`}
      </p>
      {again.error && <ErrorNotice error={again.error} title="Couldn't start another truce" />}
    </section>
  );
}

const lastOf = <K extends FeedEntry['kind']>(feed: readonly FeedEntry[], kind: K) =>
  feed.findLast((e): e is Extract<FeedEntry, { kind: K }> => e.kind === kind);

/** How the evening was reached: everyone's yes or the referee's ruling, any polish, how close each person got, and any swaps since. */
function HowCard({ state, stamp, view, onAsk }: { state: TruceState; stamp: boolean; view: SwapsView | null; onAsk: (ask: Ask) => void }) {
  const { names, members, turns } = useTruceCtx();
  const result = state.result!;
  const agreement = lastOf(state.feed, 'agreement');
  const declined = lastOf(state.feed, 'declined');
  const polish = lastOf(state.feed, 'polish');
  // How far each person falls short of their best evening, with the evening as it stands now.
  const concession = view?.concession ?? result.concession;
  const gave = gaveGround(concession, members);
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
          <PolishSwaps event={polish.event} />
        </div>
      )}
      {view && <SwapHistory view={view} onReplan={() => onAsk({ kind: 'replan' })} />}
      <div className="decision__block">
        <h3 className="plan__label">
          {wasSwapped(view) ? 'How close each of you is now' : 'How close each of you got'}
          <InfoTip label="What how close means">{EXPLAIN.closeness}</InfoTip>
        </h3>
        <div className="plan__close">
          {members.map((side) => {
            const close = Math.round((1 - (concession[side] ?? 0)) * 100);
            const name = nameOf(names, side);
            return <ScoreMeter key={side} side={side} name={name} value={close} label={`${name}: ${close} of 100, where 100 is ${possessive(name)} best evening tonight`} />;
          })}
        </div>
        <p className="small muted">{gave ? `${nameOf(names, gave)} gave a little more ground tonight.` : 'You met in the middle tonight.'}</p>
      </div>
    </section>
  );
}

interface LedgerProps {
  alpha: PerSide<number>;
  tilt: PerSide<number>;
  owed: Side | null;
  /** Animate from these shares, when the decision just arrived. */
  from?: PerSide<number>;
  stamp: boolean;
}

function LedgerCard({ alpha, tilt, owed, from, stamp }: LedgerProps) {
  const { names, letters, members } = useTruceCtx();
  return (
    <section className={cx('card decision__card', stamp && 'enter')} style={delay(560)} aria-labelledby="ledger-title">
      <SectionHeader icon="scale" id="ledger-title" title="Fairness ledger" info={<InfoTip label="What the fairness ledger does">{EXPLAIN.ledger}</InfoTip>} />
      <LedgerMeter members={members} names={names} letters={letters} alpha={alpha} tilt={tilt} owed={owed} from={from} delay={from ? 900 : 0} />
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
  swaps: Swaps;
  /** Go back to following the truce live. */
  onFollow: () => void;
}

/**
 * Decision: an open request on top, then the evening with its links and
 * swaps, how it was reached and changed since, where the ledger leans next
 * time, and the check-in for afterwards.
 */
export function Decision({ state, truceId, pairId, checkedIn, stamp, swaps, onFollow }: DecisionProps) {
  const { names, letters, members } = useTruceCtx();
  const [ask, setAsk] = useState<Ask | null>(null);
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

  const { view } = swaps;
  const open = openOf(view);
  const latest = view?.swaps.findLast((s) => s.status !== 'open');
  // After a swap the ledger is the evening as it is now; before, the stream's, animated in when it just arrived.
  const swapped = wasSwapped(view);
  const ledger = swapped ? view.ledger : state.ledger?.after;
  const ledgerFrom = !swapped && stamp ? state.ledger?.before.alpha : undefined;

  return (
    <div className="phase phase--decision">
      <p className="visually-hidden" aria-live="polite">
        {latest ? outcomeLine(latest, members, names) : ''}
      </p>
      <div className="decision__main">
        {open && <VoteCard key={open.id} swap={open} swaps={swaps} truceId={truceId} />}
        <EveningCard state={state} truceId={truceId} pairId={pairId} stamp={stamp} swaps={swaps} owed={ledger?.owed ?? null} onAsk={setAsk} />
      </div>
      <div className="decision__side">
        <HowCard state={state} stamp={stamp} view={view} onAsk={setAsk} />
        {ledger && <LedgerCard alpha={ledger.alpha} tilt={ledger.tilt} owed={ledger.owed} from={ledgerFrom} stamp={stamp} />}
        <CheckinCard
          members={members}
          names={names}
          letters={letters}
          truceId={truceId}
          checkedIn={checkedIn}
          title="After the evening"
          meta={open ? 'Each of you says how it really went, once the vote is settled.' : 'Each of you says how it really went.'}
          className={cx(stamp && 'enter')}
        />
      </div>
      <SwapSheet ask={ask} swaps={swaps} truceId={truceId} onClose={() => setAsk(null)} />
    </div>
  );
}
