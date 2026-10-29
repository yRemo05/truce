/*
 * The live truce (/t/:truceId), in three tabs: Research · Discussion · Decision.
 *
 * Inventory, by priority:
 *   primary   — Discussion: the talks (agent words + the Qloo evening, who said yes), referee notes, thinking
 *   primary   — Decision: the evening to act on (links, hours, calendar), how it was reached, scores,
 *               the ledger for next time, the check-in for afterwards
 *   secondary — Research: where and when, how Qloo reads each person, each agent's scouting,
 *               every option with where it came from, the Qloo receipts (every call, one opened up)
 *   secondary — an instant replay: a slim banner on every tab (recorded when, moved to tonight,
 *               yours to swap), with Run it live; a live demo that stops offers a recorded run
 *   secondary — the tabs with a short count each, a dot for unseen news; turn progress line;
 *               reconnecting state; skip ahead; jump to the latest move
 *   rare      — a stopped truce: the full notice on its tab, a banner on the others
 *   rare      — swaps (truce/Decision.tsx): an open request is a card on Decision and a slim
 *               banner on the other tabs; an evening planned again links forward to its new
 *               plan, and a re-plan links back to the plan it replaced, on every tab
 *
 * Behaviour: while a truce runs, the tab follows the live phase. Tapping a tab
 * (or opening a link with ?tab=) is the reader's choice and stops the follow;
 * the tab lives in the URL, so back/forward and shared links work. A finished
 * truce opens on Decision.
 *
 * Viewport budget at 1440×900: the bar and tabs, then per tab — Research: the
 * tastes and scouting left (7 columns), the options right (5); Discussion: the
 * chat in one 46rem column; Decision: the evening left (7), how / ledger /
 * check-in right (5). At 390×844 everything is one column under full-width tabs.
 *
 * Icons: gavel (referee), check/x (says yes/no), data (Qloo), quote (agent),
 * sliders (rule-based), bridge/search (origin), film/restaurant/music (slots),
 * pin/calendar (where and when), wifi-off (reconnecting), fast-forward (skip
 * ahead), arrow-down (latest), hourglass (no decision yet), heart (check-in),
 * exchange / retry (a swap or a replan waiting for votes, an evening planned again), play (a
 * recorded run).
 */
import type { CardItem, Side } from '@contract';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { Badge, Button, ButtonLink, cx, ErrorNotice, Icon, InfoTip, Notice, Page, PairNames, Spinner } from '@/ui';
import { useDemo, wasBusyReplay, type DemoKind } from '@/lib/demo';
import { groupInfo, rememberGroup, rememberPlan } from '@/lib/evenings';
import { dayMonth } from '@/lib/format';
import { EXPLAIN } from '@/lib/glossary';
import { mySide } from '@/lib/mine';
import { agentOf, groupNames, monograms, nameOf } from '@/lib/people';
import {
  errorTab,
  isPhaseTab,
  isTurnEntry,
  liveTab,
  PHASE_LABEL,
  PHASE_TABS,
  SLOTS,
  tabVersion,
  type FeedEntry,
  type PhaseTab,
  type TruceState,
} from '@/lib/truce';
import { openOf } from '@/lib/swaps';
import { useSwaps } from '@/lib/useSwaps';
import { useTruce, type Link as LinkState } from '@/lib/useTruce';
import { TruceContext, type TruceCtx } from '@/truce/context';
import { Decision } from '@/truce/Decision';
import { DeclinedCard, MoveCard, ThinkingCard } from '@/truce/Moves';
import { PhaseBar } from '@/truce/PhaseBar';
import { RefereeNote } from '@/truce/RefereeNote';
import { Research } from '@/truce/Research';
import { Stopped } from '@/truce/Stopped';
import { VoteBanner } from '@/truce/SwapVote';
import { NotFound } from './NotFound';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Scroll an element into view, smoothly unless the person asked for less motion. */
const reveal = (el: Element | null, block: ScrollLogicalPosition) => el?.scrollIntoView({ block, behavior: reducedMotion() ? 'auto' : 'smooth' });

function PhaseBadge({ state, link }: { state: TruceState; link: LinkState }) {
  if (link === 'reconnecting')
    return (
      <Badge variant="warning" icon="wifi-off">
        Reconnecting
      </Badge>
    );
  switch (state.phase) {
    case 'connecting':
    case 'gathering':
    case 'scouting':
      return <Badge icon="search">Finding options</Badge>;
    case 'negotiating':
      return (
        <Badge variant="default" className="badge--live">
          Live
        </Badge>
      );
    case 'settled':
    case 'done':
      return state.ruled ? (
        <Badge icon="gavel">Truce’s call</Badge>
      ) : (
        <Badge variant="success" icon="check-circle">
          Deal
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="destructive" icon="error">
          Stopped
        </Badge>
      );
  }
}

/**
 * An instant replay, on every tab: a recorded run moved to tonight, yours to
 * swap and check in on, with the way to a live run of the same demo. When the
 * server replayed because it was busy, it says so first.
 */
function ReplayBanner({ truceId, kind, recordedAt }: { truceId: string; kind: DemoKind; recordedAt: string }) {
  const live = useDemo();
  const busy = wasBusyReplay(truceId);
  return (
    <>
      <Notice
        icon="play"
        title={busy ? 'Truce is busy right now, so this is a recorded run.' : undefined}
        action={
          <Button size="sm" iconEnd="arrow-right" busy={live.busy} onClick={() => void live.run(kind, false)}>
            Run it live
          </Button>
        }
      >
        A recorded run from {dayMonth(recordedAt)}, moved to tonight. Swaps and check-ins are yours.
      </Notice>
      {live.error && <ErrorNotice error={live.error} title="The live run didn't start" />}
    </>
  );
}

/** The agent behind a line of the talks; null for the referee's notes. */
const speaker = (entry: FeedEntry | undefined) => (entry && isTurnEntry(entry) ? entry.event.side : null);

/** One line of the talks. Memoised: the reducer only appends, so earlier entries never re-render. */
const FeedItem = memo(function FeedItem({ entry, first }: { entry: FeedEntry; first: boolean }) {
  const turn = isTurnEntry(entry);
  return (
    <li className={turn ? (first ? 'feed__item feed__item--first' : 'feed__item') : 'feed__item feed__item--sys'}>
      {entry.kind === 'move' ? (
        <MoveCard move={entry.event} first={first} live={entry.live} />
      ) : entry.kind === 'declined' ? (
        <DeclinedCard event={entry.event} first={first} live={entry.live} />
      ) : (
        <RefereeNote entry={entry} />
      )}
    </li>
  );
});

/** One short sentence per live event, for screen readers. */
function announcement(entry: FeedEntry | undefined, ctx: TruceCtx): string {
  if (!entry) return '';
  const { names, items, members } = ctx;
  const agent = (s: Side) => agentOf(nameOf(names, s));
  switch (entry.kind) {
    case 'move': {
      const picks = SLOTS.map((s) => items[entry.event.bundle[s]]?.name).join(', ');
      const fit = members.map((s) => `${nameOf(names, s)} ${entry.event.scores[s] ?? 0}`).join(', ');
      return `${agent(entry.event.side)} ${entry.event.action === 'accept' ? 'says yes to' : 'offers'}: ${picks}. Fit ${fit}.`;
    }
    case 'declined':
      return `${agent(entry.event.side)} says no to the last call.`;
    case 'rejected':
      return `The referee struck a move by ${agent(entry.event.side)}.`;
    case 'lastcall':
      return 'Last call.';
    case 'finalround':
      return 'Final round.';
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

/**
 * The open tab: the reader's choice from `?tab=`, else wherever the truce is.
 * Choosing pushes a history entry; following clears the choice.
 */
function usePhaseTab(state: TruceState) {
  const search = useSearch();
  const [path, navigate] = useLocation();
  const chosen = new URLSearchParams(search).get('tab');
  const choice = isPhaseTab(chosen) ? chosen : null;
  const go = useCallback(
    (tab: PhaseTab | null) => {
      const params = new URLSearchParams(search);
      if (tab) params.set('tab', tab);
      else params.delete('tab');
      const query = params.toString();
      navigate(query ? `${path}?${query}` : path);
    },
    [search, path, navigate],
  );
  return { tab: choice ?? liveTab(state), following: choice === null, choose: (tab: PhaseTab) => go(tab), follow: () => go(null) };
}

/** Tabs with something new since the reader last looked; only once they've taken over from the live follow. */
function useUnseen(state: TruceState, tab: PhaseTab, following: boolean, ready: boolean) {
  const versions = Object.fromEntries(PHASE_TABS.map((t) => [t, tabVersion(state, t)])) as Record<PhaseTab, number>;
  const [seen, setSeen] = useState<Record<PhaseTab, number> | null>(null);
  const key = PHASE_TABS.map((t) => versions[t]).join();

  // What was there when the page loaded, or when the reader took over, counts as seen; later versions don't reset it.
  useEffect(() => {
    if (ready) setSeen({ ...versions });
  }, [ready, following]);
  // The open tab is always read; `key` stands in for the versions.
  useEffect(() => {
    setSeen((s) => (s && s[tab] !== versions[tab] ? { ...s, [tab]: versions[tab] } : s));
  }, [tab, key]);

  return new Set(following || !seen ? [] : PHASE_TABS.filter((t) => t !== tab && versions[t] > seen[t]));
}

export function TrucePage({ truceId }: { truceId: string }) {
  const { state, meta, loadError, link, arrivedLive, backlog, skipAhead, reload } = useTruce(truceId);
  const { tab, following, choose, follow } = usePhaseTab(state);
  const unseen = useUnseen(state, tab, following, meta !== null);
  const swaps = useSwaps(truceId, state.phase === 'done' && state.result !== null);
  const [atEnd, setAtEnd] = useState(true);
  const [feedEnd, setFeedEnd] = useState<HTMLLIElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const stoppedRef = useRef<HTMLDivElement | null>(null);

  const ctx = useMemo<TruceCtx | null>(
    () =>
      meta && {
        members: meta.members,
        mine: mySide(meta.pairId),
        names: meta.names,
        letters: monograms(meta.names, meta.members),
        location: meta.location,
        items: state.items,
        turns: state.turns,
        brain: state.brain,
      },
    [meta, state.items, state.turns, state.brain],
  );

  // Remembered for My evenings, in this browser only: the group, and the evening as it stands, whichever tab is open.
  useEffect(() => {
    if (meta) rememberGroup(groupInfo(meta, meta.pairId));
  }, [meta]);
  const bundle = swaps.view?.bundle ?? state.result?.bundle ?? null;
  const picks = bundle ? SLOTS.map((s) => state.items[bundle[s]]).filter((x): x is CardItem => Boolean(x)) : [];
  const pickKey = picks.map((i) => i.id).join();
  useEffect(() => {
    if (meta && picks.length) rememberPlan(truceId, meta.pairId, picks.map((i) => ({ slot: i.slot, id: i.id, name: i.name, imageUrl: i.imageUrl })));
  }, [truceId, meta, pickKey]); // the picks, named by their ids

  const { feed } = state;
  const done = state.phase === 'done' && state.result !== null;
  const archive = done && !arrivedLive;
  const lastLive = feed.findLast((e) => e.live);
  const talking = tab === 'discussion';

  // "At the end" means the latest message is on screen, give or take a card.
  useEffect(() => {
    if (!feedEnd) return;
    const observer = new IntersectionObserver(([e]) => setAtEnd(Boolean(e?.isIntersecting)), { rootMargin: '0px 0px 320px 0px' });
    observer.observe(feedEnd);
    return () => observer.disconnect();
  }, [feedEnd]);

  // Keep up with the talks while the reader is at the end of them.
  useEffect(() => {
    if (talking && lastLive && atEnd && !done) reveal(feedEnd, 'end');
  }, [talking, lastLive, state.thinking, atEnd, done, feedEnd]);

  // A new tab starts at its top.
  const shown = useRef(tab);
  useEffect(() => {
    if (shown.current === tab) return;
    shown.current = tab;
    const top = panelRef.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [tab]);

  // A truce that stops while someone watches: bring the notice into view on its tab.
  useEffect(() => {
    if (state.error && state.sawLive) reveal(stoppedRef.current, 'center');
  }, [state.error, state.sawLive]);

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

  const { names, members } = ctx;
  const openSwap = openOf(swaps.view);
  // From the truce at load; then from the swaps, which also see a replan go ahead, or fail and give the evening back.
  const replacedBy = swaps.view ? swaps.view.replacedBy : meta.replacedBy;
  const stoppedIn = state.error ? errorTab(state) : null;
  // On its own tab the full notice, with the way forward: under the talks it interrupted, else on top.
  // A demo truce; a live one that stops offers a recorded run instead.
  const { demo } = meta;
  const stopped = state.error && stoppedIn === tab && (
    <div ref={stoppedRef}>
      <Stopped error={state.error} pairId={meta.pairId} location={meta.location} demo={meta.replay ? null : demo} />
    </div>
  );
  const running = state.phase !== 'done' && state.phase !== 'failed';

  return (
    <TruceContext.Provider value={ctx}>
      <Page
        title={groupNames(names, members)}
        stickyBar
        skipLabel="Skip to the truce"
        className="truce"
        wide
        context={
          <div className="truce-bar">
            <p className="truce-bar__names">
              <PairNames names={names} members={members} />
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
              <Button size="sm" variant="ghost" icon="fast-forward" onClick={skipAhead}>
                Skip ahead
              </Button>
            )}
            {talking && !atEnd && !done && feed.length > 0 && (
              <Button size="sm" variant="ghost" icon="arrow-down" onClick={() => reveal(feedEnd, 'end')}>
                Latest
              </Button>
            )}
            <PhaseBadge state={state} link={link} />
          </>
        }
        below={<PhaseBar state={state} tab={tab} onTab={choose} unseen={unseen} />}
      >
        <p className="visually-hidden" aria-live="polite">
          {announcement(lastLive, ctx)}
        </p>

        {stoppedIn && stoppedIn !== tab && (
          <Notice
            tone="error"
            title="This truce stopped early"
            action={
              <Button size="sm" iconEnd="arrow-right" onClick={() => choose(stoppedIn)}>
                {`See ${PHASE_LABEL[stoppedIn]}`}
              </Button>
            }
          />
        )}

        {link === 'offline' && !state.error && (
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
            The truce carries on without you. Reconnect to catch up.
          </Notice>
        )}

        {replacedBy && (
          <Notice
            icon="retry"
            title="Tonight was planned again"
            action={
              <ButtonLink size="sm" iconEnd="arrow-right" href={`/t/${replacedBy}`}>
                See the new plan
              </ButtonLink>
            }
          />
        )}

        {meta.replaces && !replacedBy && (
          <Notice
            icon="retry"
            title="Planned again, without what was swapped away"
            action={
              <ButtonLink size="sm" variant="ghost" icon="arrow-left" href={`/t/${meta.replaces}?tab=decision`}>
                The first plan
              </ButtonLink>
            }
          />
        )}

        {meta.replay && demo && <ReplayBanner truceId={truceId} kind={demo} recordedAt={meta.replay.recordedAt} />}

        {openSwap && tab !== 'decision' && <VoteBanner swap={openSwap} onOpen={() => choose('decision')} />}

        {state.brain === 'rules' && (
          <Notice tone="info">
            Rule-based agents today: no AI, same referee, same fairness.{' '}
            <InfoTip label="Why rule-based agents">{EXPLAIN.rulesMode}</InfoTip>
          </Notice>
        )}

        <div ref={panelRef} id="phase-panel" role="tabpanel" aria-labelledby={`phase-tab-${tab}`} className="truce__panel">
          {tab !== 'discussion' && stopped}

          {tab === 'research' && <Research state={state} plan={swaps.view?.bundle ?? state.result?.bundle ?? null} truceId={truceId} running={running} />}

          {tab === 'discussion' && (
            <div className="phase phase--discussion">
              {feed.length > 0 ? (
                // No single "me" (a guest, a demo, a shared phone): one centred column instead of everyone leaning left.
                <div className={cx('chat', ctx.mine === null && 'chat--centered')}>
                  <ol className="feed" aria-label="The talks">
                    {feed.map((entry, i) => (
                      <FeedItem key={entry.key} entry={entry} first={speaker(entry) !== speaker(feed[i - 1])} />
                    ))}
                    {state.thinking && (
                      <li className="feed__item">
                        <ThinkingCard side={state.thinking.side} struck={state.thinking.struck} first={speaker(feed[feed.length - 1]) !== state.thinking.side} />
                      </li>
                    )}
                    <li ref={setFeedEnd} className="feed__end" aria-hidden="true" />
                  </ol>
                </div>
              ) : (
                !state.error && (
                  <Notice tone="info" title="The talks haven’t started">
                    They start once Qloo has the options ready. Research shows what&rsquo;s happening now.
                  </Notice>
                )
              )}
              {stopped}
            </div>
          )}

          {tab === 'decision' && (
            <Decision
              state={state}
              truceId={truceId}
              pairId={meta.pairId}
              demoKind={demo ?? (meta.mode === 'couple' ? 'couple' : 'friends')}
              demo={demo !== null}
              checkedIn={meta.checkedIn}
              stamp={!archive && state.sawLive}
              swaps={swaps}
              onFollow={follow}
            />
          )}
        </div>
      </Page>
    </TruceContext.Provider>
  );
}
