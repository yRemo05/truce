/*
 * The live truce (/t/:truceId).
 *
 * Inventory, by priority:
 *   primary   — the talks: each move (agent words + the Qloo evening), referee notes, thinking
 *   primary   — the plan, once settled (the peak: the seal presses in, the ledger leans)
 *   secondary — the pool (what's on offer, origin badges, what's on the table now)
 *   secondary — turn track and phase, in the sticky bar; reconnecting state; skip ahead
 *   rare      — retry after an error, jump to the latest move when scrolled away
 *
 * Viewport budget: at 1440×900 the bar (with the turn track), the latest move and
 * the whole pool rail are visible at once. At 390×844 the bar holds the turn
 * track; the pool is a compact three-row tab block above the talks.
 *
 * Grid: 12 columns ≥1024px — talks and plan in 7, the pool as a sticky rail in 5.
 * Below that one column: scouting, pool, talks, plan. A truce opened after it
 * finished reads as a document: the plan first, the talks folded under it.
 *
 * Icons: gavel (referee), exchange/check/x (move kinds), data (Qloo), quote
 * (agent), bridge (origin), film/restaurant/music (slots), pin (place),
 * wifi-off (reconnecting), fast-forward (skip ahead), arrow-down (jump), retry.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Chip, ErrorNotice, Icon, Notice, Page, PairNames, Spinner } from '@/ui';
import { agentOf, monograms } from '@/lib/people';
import { isTurnEntry, SLOTS, type FeedEntry, type TruceState } from '@/lib/truce';
import { useTruce, type Link as LinkState } from '@/lib/useTruce';
import { TruceContext, type TruceCtx } from '@/truce/context';
import { DeclinedCard, MoveCard, ThinkingCard } from '@/truce/Moves';
import { Plan } from '@/truce/Plan';
import { PoolPanel, PoolSkeleton } from '@/truce/PoolPanel';
import { RefereeNote } from '@/truce/RefereeNote';
import { Scouting } from '@/truce/Scouting';
import { Stopped } from '@/truce/Stopped';
import { TurnTrack } from '@/truce/TurnTrack';
import { NotFound } from './NotFound';

/** Scroll an element into view, smoothly unless the person asked for less motion. */
const reveal = (el: Element | null, block: ScrollLogicalPosition) =>
  el?.scrollIntoView({ block, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });

function PhaseChip({ state, link }: { state: TruceState; link: LinkState }) {
  if (link === 'reconnecting')
    return (
      <Chip tone="warn" icon="wifi-off">
        Reconnecting
      </Chip>
    );
  switch (state.phase) {
    case 'connecting':
    case 'scouting':
      return <Chip icon="search">Scouting</Chip>;
    case 'negotiating':
      return (
        <Chip tone="ink" className="chip--live">
          Live
        </Chip>
      );
    case 'settled':
    case 'done':
      return state.ruled ? (
        <Chip icon="gavel">Truce’s call</Chip>
      ) : (
        <Chip tone="ok" icon="check-circle">
          Agreed
        </Chip>
      );
    case 'failed':
      return (
        <Chip tone="danger" icon="error">
          Stopped
        </Chip>
      );
  }
}

/** One line of the talks. Memoised: the reducer only appends, so earlier entries never re-render. */
const FeedItem = memo(function FeedItem({ entry }: { entry: FeedEntry }) {
  const side = isTurnEntry(entry) ? entry.event.side : null;
  return (
    <li className={side ? `feed__item feed__item--${side}` : 'feed__item feed__item--referee'}>
      {entry.kind === 'move' ? (
        <MoveCard move={entry.event} live={entry.live} />
      ) : entry.kind === 'declined' ? (
        <DeclinedCard event={entry.event} live={entry.live} />
      ) : (
        <RefereeNote entry={entry} />
      )}
    </li>
  );
});

/** One short sentence per live event, for screen readers. */
function announcement(entry: FeedEntry | undefined, ctx: TruceCtx): string {
  if (!entry) return '';
  const { names, items } = ctx;
  switch (entry.kind) {
    case 'move': {
      const picks = SLOTS.map((s) => items[entry.event.bundle[s]]?.name).join(', ');
      return `${agentOf(names[entry.event.side])} ${entry.event.action === 'accept' ? 'accepts' : 'offers'}: ${picks}. Fit ${names.a} ${entry.event.scores.a}, ${names.b} ${entry.event.scores.b}.`;
    }
    case 'declined':
      return `${agentOf(names[entry.event.side])} declines the last call.`;
    case 'rejected':
      return `The referee struck a move by ${agentOf(names[entry.event.side])}.`;
    case 'lastcall':
      return `Last call. ${agentOf(names[entry.event.side])} decides.`;
    case 'agreement':
      return 'Agreed.';
    case 'ruling':
      return 'No deal. The referee rules.';
    case 'polish':
      return 'The referee polished the deal.';
    case 'start':
      return 'The negotiation starts.';
  }
}

export function TrucePage({ truceId }: { truceId: string }) {
  const { state, meta, loadError, link, arrivedLive, backlog, skipAhead, reload } = useTruce(truceId);
  const [following, setFollowing] = useState(true);
  const [feedEnd, setFeedEnd] = useState<HTMLLIElement | null>(null);
  const planRef = useRef<HTMLDivElement | null>(null);

  const ctx = useMemo<TruceCtx | null>(
    () =>
      meta && {
        names: meta.names,
        letters: monograms(meta.names),
        location: meta.location,
        items: state.items,
        turns: state.turns,
        brain: state.brain,
      },
    [meta, state.items, state.turns, state.brain],
  );

  const { feed } = state;
  const done = state.phase === 'done' && state.result !== null;
  const archive = done && !arrivedLive;
  const lastLive = feed.findLast((e) => e.live);
  const turnsUsed = feed.filter(isTurnEntry).length;
  // Follow the talks once the first move is in; before that, let the pool reveal be read.
  const moved = feed.some((e) => e.kind === 'move');

  // "Following" means the end of the talks is on screen, give or take a card.
  useEffect(() => {
    if (!feedEnd) return;
    const observer = new IntersectionObserver(([e]) => setFollowing(Boolean(e?.isIntersecting)), { rootMargin: '0px 0px 320px 0px' });
    observer.observe(feedEnd);
    return () => observer.disconnect();
  }, [feedEnd]);

  useEffect(() => {
    if (lastLive && moved && following && !done) reveal(feedEnd, 'end');
  }, [lastLive, state.thinking, moved, following, done, feedEnd]);

  useEffect(() => {
    if (done && !archive) reveal(planRef.current, 'start');
  }, [done, archive]);

  if (loadError?.status === 404) return <NotFound what="truce" />;

  if (loadError || !ctx || !meta) {
    return (
      <Page title={null}>
        {loadError ? (
          <ErrorNotice error={loadError} title="Couldn't load this truce" onRetry={reload} />
        ) : (
          <div className="truce-loading">
            <Spinner size={20} label="Loading the truce" />
          </div>
        )}
      </Page>
    );
  }

  const { names } = ctx;
  const scouting = state.phase === 'connecting' || state.phase === 'scouting';

  const talks = (
    <ol className="feed" aria-label="The talks">
      {feed.map((entry) => (
        <FeedItem key={entry.key} entry={entry} />
      ))}
      {state.thinking && (
        <li className={`feed__item feed__item--${state.thinking.side}`}>
          <ThinkingCard side={state.thinking.side} struck={state.thinking.struck} />
        </li>
      )}
      <li ref={setFeedEnd} className="feed__end" aria-hidden="true" />
    </ol>
  );

  return (
    <TruceContext.Provider value={ctx}>
      <Page
        title={`${names.a} & ${names.b}`}
        stickyBar
        skipLabel="Skip to the talks"
        className={archive ? 'truce truce--archive' : 'truce'}
        context={
          <div className="truce-bar">
            <p className="truce-bar__names">
              <PairNames names={names} />
            </p>
            <span className="truce-bar__place small muted">
              <Icon name="pin" size={16} />
              {meta.location}
            </span>
          </div>
        }
        actions={
          <>
            {backlog > 1 && (
              <Button size="sm" variant="quiet" icon="fast-forward" onClick={skipAhead}>
                Skip ahead
              </Button>
            )}
            {!following && !done && feed.length > 0 && (
              <Button size="sm" variant="quiet" icon="arrow-down" onClick={() => reveal(feedEnd, 'end')}>
                Latest
              </Button>
            )}
            <PhaseChip state={state} link={link} />
          </>
        }
        below={state.start ? <TurnTrack state={state} /> : undefined}
      >
        <p className="visually-hidden" aria-live="polite">
          {announcement(lastLive, ctx)}
        </p>

        {scouting && !state.error && (
          <div className="truce__lead">
            <Scouting />
          </div>
        )}

        {(state.pool || !state.error) && (
          <div className="truce__rail">
            {state.pool ? (
              <PoolPanel pool={state.pool} indifferent={state.indifferent} table={state.onTable?.bundle ?? null} final={state.result?.bundle ?? null} />
            ) : (
              <PoolSkeleton />
            )}
          </div>
        )}

        {feed.length > 0 && (
          <div className="truce__talks">
            {archive ? (
              <details className="talks-fold">
                <summary className="talks-fold__summary">
                  <Icon name="chevron-right" size={20} className="talks-fold__chevron" />
                  <span>
                    <span className="talks-fold__title display-s">The talks</span>
                    <span className="small muted">
                      {' '}
                      {turnsUsed} moves, {feed.filter((e) => e.kind === 'rejected').length} struck by the referee
                    </span>
                  </span>
                </summary>
                {talks}
              </details>
            ) : (
              talks
            )}
          </div>
        )}

        {state.error && (
          <div className="truce__lead">
            <Stopped error={state.error} pairId={meta.pairId} location={meta.location} />
          </div>
        )}

        {link === 'offline' && !state.error && (
          <div className="truce__lead">
            <Notice
              tone="warn"
              live
              title="Lost the connection"
              action={
                <Button size="sm" icon="retry" onClick={reload}>
                  Reconnect
                </Button>
              }
            >
              The truce carries on without you. Reconnect to catch up from the start.
            </Notice>
          </div>
        )}

        {done && (
          <div className="truce__plan" ref={planRef}>
            <Plan state={state} pairId={meta.pairId} date={meta.endedAt ?? meta.createdAt ?? null} stamp={!archive && state.sawLive} />
          </div>
        )}
      </Page>
    </TruceContext.Provider>
  );
}
