/*
 * Group home (/p/:pairId).
 *
 * Inventory, by priority:
 *   primary   — Start the truce (only when everyone is ready), or Watch the running one
 *   primary   — who's ready: each person, a status chip, fill in / redo, their own link
 *   rare      — a swap or replan of the last evening waiting for votes: a banner on top, to the vote
 *   secondary — after an evening: "How was the evening?", each person's check-in
 *   secondary — the ledger (a split bar for two, a bar each for a group)
 *   secondary — past evenings, each opening its plan, with who checked in
 *
 * Viewport budget: at 1440×900 everything fits one screen for a group of four;
 * at 390×844 the people and the start action are above the fold.
 * Grid: 12 columns — the check-in and "Tonight" in 1–7, the ledger and history
 * in 8–12. Phone: check-in, tonight, ledger, history. Polls every 4 s while
 * someone is still picking, a truce runs or check-ins are due.
 * Icons: check / pencil (status), arrow-right, copy (link), play (start), eye
 * (watch), heart (check-in), scale (ledger), calendar (history), pin,
 * exchange / retry (a swap or replan waiting for votes), play (a recorded demo, when Truce is too
 * busy to start one live).
 */
import type { PairView } from '@contract';
import { useEffect, useState } from 'react';
import { Link, useSearch } from 'wouter';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  CopyButton,
  ErrorNotice,
  Icon,
  InfoTip,
  LedgerMeter,
  Page,
  PairNames,
  PersonRow,
  pullSentence,
  SectionHeader,
  Skeleton,
} from '@/ui';
import { useDemo } from '@/lib/demo';
import { isPassMode, withPass } from '@/lib/flow';
import { EXPLAIN } from '@/lib/glossary';
import { dayMonth } from '@/lib/format';
import { groupNames, listNames, modeLabel, monograms, nameOf, possessive, type Names } from '@/lib/people';
import { absolute } from '@/lib/share';
import { mySide } from '@/lib/mine';
import { canVote, waitingLine } from '@/lib/swaps';
import { gaveGround, SLOTS } from '@/lib/truce';
import { useStartTruce } from '@/lib/useAction';
import { usePair } from '@/lib/usePair';
import { CheckinCard } from '@/truce/CheckinCard';
import { SwapBanner } from '@/truce/SwapVote';
import { NotFound } from './NotFound';

function Tonight({ pair, letters, running, pass }: { pair: PairView; letters: Names; running: string | null; pass: boolean }) {
  const start = useStartTruce(pair.id);
  const demo = useDemo();
  const waiting = pair.members.filter((s) => !pair.ready[s]);
  const all = waiting.length === 0;

  return (
    <section className="card tonight" aria-labelledby="tonight-title">
      <SectionHeader
        icon="calendar"
        id="tonight-title"
        title="Tonight"
        meta={all ? 'Everyone’s ready.' : pass ? 'Each of you picks your favourites, privately.' : 'Each of you picks on your own phone. Send each person their link.'}
      />
      <ul className="people">
        {pair.members.map((side) => {
          const name = nameOf(pair.names, side);
          const ready = pair.ready[side];
          const href = withPass(`/p/${pair.id}/${side}`, pass);
          return (
            <PersonRow
              key={side}
              side={side}
              letters={nameOf(letters, side)}
              name={name}
              status={
                ready ? (
                  <Badge variant="success" icon="check">
                    Ready
                  </Badge>
                ) : (
                  <Badge variant="secondary">Still picking</Badge>
                )
              }
              actions={
                <>
                  {!ready && !pass && <CopyButton text={absolute(`/p/${pair.id}/${side}`)} compact description={`Copy link for ${name}`} />}
                  {ready ? (
                    <ButtonLink size="sm" variant="ghost" icon="pencil" href={href}>
                      Change
                    </ButtonLink>
                  ) : (
                    <ButtonLink size="sm" iconEnd="arrow-right" href={href} aria-label={`Add favourites for ${name}`}>
                      Add favourites
                    </ButtonLink>
                  )}
                </>
              }
            />
          );
        })}
      </ul>

      <div className="tonight__action">
        {running ? (
          <>
            <ButtonLink variant="primary" icon="eye" href={`/t/${running}`}>
              Watch the talks
            </ButtonLink>
            <p className="small muted">The agents are talking now.</p>
          </>
        ) : (
          <>
            <Button variant="primary" icon="play" busy={start.busy} disabled={!all} onClick={() => void start.run()}>
              Start the truce
            </Button>
            <p className="small muted">
              {all
                ? pullSentence(pair.ledger.tilt, pair.ledger.owed, pair.names, pair.members, 'tonight')
                : `Waiting for ${listNames(waiting.map((s) => possessive(nameOf(pair.names, s))))} picks.`}
            </p>
          </>
        )}
      </div>
      {start.error && (
        <ErrorNotice
          error={start.error}
          title="The truce didn't start"
          action={
            // Too busy for a new live truce: a recorded demo opens at once instead.
            start.error.code === 'capacity' && (
              <Button size="sm" icon="play" busy={demo.busy} onClick={() => void demo.run(pair.mode === 'couple' ? 'couple' : 'friends', true)}>
                Watch a recorded demo
              </Button>
            )
          }
        />
      )}
      {demo.error && <ErrorNotice error={demo.error} title="The recorded demo didn't open" />}
    </section>
  );
}

function Ledger({ pair, letters }: { pair: PairView; letters: Names }) {
  const entries = [...pair.ledger.entries].reverse();
  return (
    <section className="card ledger-card" aria-labelledby="ledger-title">
      <SectionHeader icon="scale" id="ledger-title" title="Fairness ledger" info={<InfoTip label="What the fairness ledger does">{EXPLAIN.ledger}</InfoTip>} />
      <LedgerMeter members={pair.members} names={pair.names} letters={letters} alpha={pair.ledger.alpha} tilt={pair.ledger.tilt} owed={pair.ledger.owed} />

      <h3 className="history__title">
        <Icon name="calendar" size={16} />
        Past evenings
      </h3>
      {entries.length === 0 ? (
        <p className="history__empty small muted">No evenings yet. The ledger starts even.</p>
      ) : (
        <ol className="history">
          {entries.map((e) => {
            const gave = gaveGround(e.concession, pair.members);
            const answered = pair.members.filter((s) => e.checkedIn[s]);
            const body = (
              <>
                <span className="history__date">{dayMonth(e.at)}</span>
                <span className="history__evening">{SLOTS.map((s) => e.evening[s]).filter(Boolean).join(' · ')}</span>
                <span className="history__who small muted">
                  {gave ? (
                    <>
                      <Avatar side={gave} letters={nameOf(letters, gave)} size="sm" />
                      {nameOf(pair.names, gave)} gave ground
                    </>
                  ) : (
                    'Met in the middle'
                  )}
                </span>
                {e.earlier && (
                  <span className="history__checkins">
                    <Badge variant="outline">earlier (demo)</Badge>
                  </span>
                )}
                {answered.length > 0 && (
                  <span className="history__checkins small muted">
                    <Icon name="check" size={16} />
                    {answered.length === pair.members.length ? 'Everyone checked in' : `${listNames(answered.map((s) => nameOf(pair.names, s)))} checked in`}
                  </span>
                )}
              </>
            );
            return (
              <li key={e.truceId}>
                {e.earlier ? (
                  <div className="history__row">{body}</div>
                ) : (
                  <Link href={`/t/${e.truceId}`} className="history__row history__row--link">
                    {body}
                    <Icon name="chevron-right" size={16} className="history__go" />
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function PairSkeleton() {
  return (
    <div className="grid pair__grid" aria-hidden="true">
      <div className="pair__main">
        <div className="card tonight">
          <Skeleton w="8rem" h="1.5rem" />
          {[0, 1].map((i) => (
            <div key={i} className="person person--skeleton">
              <Skeleton w="2.75rem" h="2.75rem" round delay={i * 80} />
              <Skeleton w="40%" h="1rem" delay={i * 80} />
            </div>
          ))}
          <Skeleton w="11rem" h="2.75rem" round />
        </div>
      </div>
      <div className="card ledger-card">
        <Skeleton w="9rem" h="1.5rem" />
        <Skeleton h="1.5rem" delay={80} />
        <Skeleton w="70%" h="0.875rem" delay={120} />
      </div>
    </div>
  );
}

export function PairHome({ pairId }: { pairId: string }) {
  const pass = isPassMode(useSearch());
  const [poll, setPoll] = useState(true);
  const { pair, error, reload } = usePair(pairId, { poll });

  const last = pair?.lastTruce ?? null;
  // A truce still going gets a link to watch it, rather than a second start.
  const running = last?.status === 'running' ? last.id : null;
  const checkinDue = Boolean(pair && last?.status === 'done' && pair.members.some((s) => !last.checkedIn[s]));
  const openSwap = last?.openSwap ?? null;

  // Poll while someone is still picking, a truce runs, or check-ins are due on other phones.
  const settled = Boolean(pair && pair.members.every((s) => pair.ready[s]) && !running && !checkinDue && !openSwap);
  useEffect(() => setPoll(!settled), [settled]);

  if (error?.status === 404) return <NotFound what="pair" />;
  const letters = pair ? monograms(pair.names, pair.members) : {};

  return (
    <Page
      title={pair ? groupNames(pair.names, pair.members) : 'Your truce'}
      className="pair"
      context={
        pair && (
          <span className="pair__bar">
            <Badge variant="outline" icon={pair.mode === 'couple' ? 'heart' : 'users'}>
              {modeLabel(pair.mode)}
            </Badge>
            <span className="small muted pair__place">
              <Icon name="pin" size={16} />
              {pair.location}
            </span>
          </span>
        )
      }
    >
      <h1 className="h2 pair__title">{pair ? <PairNames names={pair.names} members={pair.members} /> : <Skeleton w="12ch" h="1em" />}</h1>

      {error && !pair && <ErrorNotice error={error} title="Couldn't load this truce" onRetry={reload} />}

      {pair ? (
        <div className="grid pair__grid">
          <div className="pair__main">
            {openSwap && last && (
              <SwapBanner
                swap={openSwap}
                names={pair.names}
                action={
                  <ButtonLink size="sm" iconEnd="arrow-right" href={`/t/${last.id}?tab=decision`}>
                    {canVote(openSwap, mySide(pair.id)) ? 'Vote' : 'See the vote'}
                  </ButtonLink>
                }
              >
                {waitingLine(openSwap.waiting, pair.names)}
              </SwapBanner>
            )}
            {checkinDue && last && (
              <CheckinCard
                members={pair.members}
                names={pair.names}
                letters={letters}
                truceId={last.id}
                checkedIn={last.checkedIn}
                title="How was the evening?"
                meta={openSwap ? 'Each of you says how it really went, once the vote is settled.' : 'Each of you says how it really went.'}
                footer={
                  <ButtonLink size="sm" variant="ghost" iconEnd="arrow-right" href={`/t/${last.id}`} className="checkin-card__plan">
                    See the plan
                  </ButtonLink>
                }
              />
            )}
            <Tonight pair={pair} letters={letters} running={running} pass={pass} />
          </div>
          <Ledger pair={pair} letters={letters} />
        </div>
      ) : (
        !error && <PairSkeleton />
      )}
    </Page>
  );
}

