/*
 * Pair home (/p/:pairId).
 *
 * Inventory, by priority:
 *   primary   — Start the truce (only when both sides are ready), or Watch the running one
 *   primary   — who's ready: each person, a status chip, fill in / redo
 *   secondary — the link for the other person (link play), the ledger meter
 *   secondary — past evenings, each opening its plan
 *
 * Viewport budget: at 1440×900 everything fits one screen; at 390×844 the two
 * people and the start action are above the fold.
 * Grid: 12 columns — "Tonight" in 1–7, the ledger and history in 8–12.
 * Phone: tonight, ledger, history. Polls every 4 s while someone is still
 * picking or a truce is running, so the other phone's progress shows up here.
 * Icons: check-circle / pencil (status), arrow-right, play (start), eye (watch),
 * scale (ledger), calendar (history dates), link, heart / users (mode), pin.
 */
import type { PairView, Side } from '@contract';
import { useEffect, useState } from 'react';
import { Link, useSearch } from 'wouter';
import {
  Button,
  ButtonLink,
  Chip,
  CopyLink,
  ErrorNotice,
  Icon,
  LedgerMeter,
  Monogram,
  Page,
  PairNames,
  pullSentence,
  SectionHeader,
  Skeleton,
} from '@/ui';
import { isPassMode, withPass } from '@/lib/flow';
import { dayMonth } from '@/lib/format';
import { modeLabel, monograms, possessive, SIDES } from '@/lib/people';
import { absolute } from '@/lib/share';
import { gaveGround, SLOTS } from '@/lib/truce';
import { useStartTruce } from '@/lib/useAction';
import { usePair } from '@/lib/usePair';
import { NotFound } from './NotFound';

function Person({ pair, side, pass }: { pair: PairView; side: Side; pass: boolean }) {
  const ready = pair.ready[side];
  const name = pair.names[side];
  const href = withPass(`/p/${pair.id}/${side}`, pass);
  return (
    <li className="person">
      <Monogram side={side} letters={monograms(pair.names)[side]} size="lg" />
      <div className="person__text">
        <p className="person__name">{name}</p>
        {ready ? (
          <Chip tone="ok" icon="check-circle">
            Picks in
          </Chip>
        ) : (
          <Chip icon="pencil">Still picking</Chip>
        )}
      </div>
      {ready ? (
        <ButtonLink size="sm" variant="quiet" icon="pencil" href={href}>
          Redo
        </ButtonLink>
      ) : (
        <ButtonLink size="sm" iconEnd="arrow-right" href={href}>
          Add picks
        </ButtonLink>
      )}
    </li>
  );
}

function Tonight({ pair, running, pass }: { pair: PairView; running: string | null; pass: boolean }) {
  const start = useStartTruce(pair.id);
  const both = pair.ready.a && pair.ready.b;
  const waiting = SIDES.filter((s) => !pair.ready[s]);

  return (
    <section className="card tonight" aria-labelledby="tonight-title">
      <SectionHeader icon="calendar" id="tonight-title" title="Tonight" meta={both ? 'Both sides are in.' : 'Each of you picks what you love, privately.'} />
      <ul className="people">
        {SIDES.map((side) => (
          <Person key={side} pair={pair} side={side} pass={pass} />
        ))}
      </ul>

      {!both && !pass && (
        <div className="tonight__invite">
          <p className="small">
            <Icon name="link" size={16} />
            {waiting.length === 2 ? 'Send the other person this link:' : `Send ${pair.names[waiting[0]!]} this link:`}
          </p>
          <CopyLink
            url={absolute(`/p/${pair.id}`)}
            shareTitle="Our truce"
            shareText={`Truce for tonight: ${pair.names.a} & ${pair.names.b}. Add your picks:`}
          />
        </div>
      )}

      <div className="tonight__action">
        {running ? (
          <>
            <ButtonLink variant="primary" icon="eye" href={`/t/${running}`}>
              Watch the truce
            </ButtonLink>
            <p className="small muted">The agents are at it now.</p>
          </>
        ) : (
          <>
            <Button variant="primary" icon="play" busy={start.busy} disabled={!both} onClick={() => void start.run()}>
              Start the truce
            </Button>
            <p className="small muted">
              {both
                ? pullSentence(pair.ledger.tilt, pair.ledger.owed, pair.names, 'tonight')
                : `Waiting for ${waiting.map((s) => possessive(pair.names[s])).join(' and ')} picks.`}
            </p>
          </>
        )}
      </div>
      {start.error && <ErrorNotice error={start.error} title="The truce didn't start" />}
    </section>
  );
}

function Ledger({ pair }: { pair: PairView }) {
  const letters = monograms(pair.names);
  const entries = [...pair.ledger.entries].reverse();
  return (
    <section className="card ledger-card" aria-labelledby="ledger-title">
      <SectionHeader icon="scale" id="ledger-title" title="The ledger" meta="Who gave ground, and how that tilts the next truce." />
      <LedgerMeter names={pair.names} letters={letters} alphaA={pair.ledger.alphaA} tilt={pair.ledger.tilt} owed={pair.ledger.owed} />

      <h3 className="eyebrow history__title">
        <Icon name="calendar" size={16} />
        Past evenings
      </h3>
      {entries.length === 0 ? (
        <p className="history__empty small muted">No evenings yet. The first truce starts the ledger at even.</p>
      ) : (
        <ol className="history">
          {entries.map((e) => {
            const gave = gaveGround(e.concession);
            return (
              <li key={e.truceId}>
                <Link href={`/t/${e.truceId}`} className="history__row">
                  <span className="history__date">{dayMonth(e.at)}</span>
                  <span className="history__evening">{SLOTS.map((s) => e.evening[s]).filter(Boolean).join(' · ')}</span>
                  <span className="history__who small muted">
                    {gave ? (
                      <>
                        <Monogram side={gave} letters={letters[gave]} size="xs" />
                        {pair.names[gave]} gave ground
                      </>
                    ) : (
                      'Met in the middle'
                    )}
                  </span>
                  <Icon name="chevron-right" size={16} className="history__go" />
                </Link>
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

  // A truce still going gets a link to watch it, rather than a second start.
  const running = pair?.lastTruce?.status === 'running' ? pair.lastTruce.id : null;

  // Poll while someone is still picking or a truce runs; once both are in, Start finds any truce the other phone began.
  const settled = Boolean(pair && pair.ready.a && pair.ready.b && !running);
  useEffect(() => setPoll(!settled), [settled]);

  if (error?.status === 404) return <NotFound what="pair" />;

  return (
    <Page
      title={pair ? `${pair.names.a} & ${pair.names.b}` : 'Your truce'}
      className="pair"
      context={
        pair && (
          <span className="pair__bar">
            <Chip icon={pair.mode === 'couple' ? 'heart' : 'users'}>{modeLabel(pair.mode)}</Chip>
            <span className="small muted pair__place">
              <Icon name="pin" size={16} />
              {pair.location}
            </span>
          </span>
        )
      }
    >
      <h1 className="display-l pair__title">
        {pair ? (
          <PairNames names={pair.names} />
        ) : (
          <Skeleton w="12ch" h="1em" />
        )}
      </h1>

      {error && !pair && <ErrorNotice error={error} title="Couldn't load this pair" onRetry={reload} />}

      {pair ? (
        <div className="grid pair__grid">
          <Tonight pair={pair} running={running} pass={pass} />
          <Ledger pair={pair} />
        </div>
      ) : (
        !error && <PairSkeleton />
      )}
    </Page>
  );
}
