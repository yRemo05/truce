/*
 * My evenings (/evenings): every group this browser has opened, in one place.
 * Kept in this browser only (lib/evenings.ts); the server's PairView of each
 * group is fetched in parallel, each group loading and failing on its own.
 *
 * Inventory, by priority:
 *   primary   — Waiting on you: votes, check-ins, starting a truce, watching one, favourites and
 *               tonight's questions; each item links where it's done (yours alone when this browser
 *               knows which person you are, else one action per person)
 *   primary   — a card per group: names and avatars, place, when last seen; where its evening is
 *               (a five-step strip and one status line); its last plan as posters; its fairness
 *               ledger as a chart (each evening's shortfall per person, the say next time)
 *   secondary — the headline numbers: evenings planned, loved picks, things waiting on you
 *   secondary — Loved: posters and photos of picks loved in check-ins sent here, per slot
 *   rare      — open a group, forget it (with Undo); a group whose link is gone drops quietly
 *   first run — what the page will hold, a real evening's posters from the demo, Try the
 *               couple demo (primary) and Start your own
 *
 * Viewport budget: at 1440×900 the header with its three numbers, Waiting on you and the first
 * group card (its stage, plan posters and ledger chart) fit the first screen. At 390×844 the
 * header, the numbers and the first waiting items are above the fold.
 * Grid: 12 columns — the groups in 1–8, Waiting on you and Loved in 9–12; the header's title in
 * 1–6 and the numbers in 7–12. Inside a card, the evening (stage, status, posters) and the ledger
 * sit side by side. Phone: one column — header, numbers (three across), Waiting on you, the
 * groups, Loved.
 * States: each card's header shows at once from the memory, its body as skeletons in the loaded
 * layout; a failed group shows its error with Retry in place; the numbers wait for every group.
 * Icons: moon (the page, in the bar), calendar (evenings planned, last plan), heart (loved,
 * check-ins), hourglass (waiting), users (groups), pin (place), play (demo, start), scale (ledger),
 * exchange / retry (votes), eye (watch), pencil (favourites), arrow-right (open), trash (forget),
 * film / restaurant / music (shelves), info (what's kept here).
 */
import { useEffect, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { api } from '@/api';
import { Button, Icon, InfoTip, Notice, Page, SectionHeader, StatTile } from '@/ui';
import { forgetGroup, MAX_GROUPS, restoreGroup, useEvenings, type GroupSlice } from '@/lib/evenings';
import { EXPLAIN } from '@/lib/glossary';
import { mySide } from '@/lib/mine';
import { groupNames } from '@/lib/people';
import { SLOTS } from '@/lib/truce';
import { lovedShelf, waitingIn } from './evenings/derive';
import { EmptyState } from './evenings/EmptyState';
import { GroupCard } from './evenings/GroupCard';
import { LovedShelf } from './evenings/LovedShelf';
import { usePairs } from './evenings/usePairs';
import { WaitingList } from './evenings/WaitingList';
import './evenings/evenings.css';

/** Once per page load: StrictMode runs effects twice in development. */
let sampled = false;

/** `npm run dev:mock`, at /evenings?sample: fills the mock and this memory with groups in every state. */
function useMockSample() {
  const sample = new URLSearchParams(useSearch()).has('sample');
  const [, navigate] = useLocation();
  useEffect(() => {
    if (api.kind !== 'mock' || !sample || sampled) return;
    sampled = true;
    void import('@/mock/sample').then((m) => {
      m.sampleEvenings();
      navigate('/evenings', { replace: true });
    });
  }, [sample, navigate]);
}

export function Evenings() {
  useMockSample();
  const memory = useEvenings();
  const { groups } = memory;
  const { loads, retry } = usePairs(groups.map((g) => g.pairId));
  const [forgotten, setForgotten] = useState<GroupSlice | null>(null);

  const loaded = groups.flatMap((g) => {
    const l = loads[g.pairId];
    return l?.status === 'ok' ? [l.pair] : [];
  });
  const settling = groups.some((g) => (loads[g.pairId]?.status ?? 'loading') === 'loading');
  const waiting = loaded.flatMap((p) => waitingIn(p, mySide(p.id))).sort((a, b) => a.rank - b.rank);
  const shelf = lovedShelf(memory);
  const lovedCount = SLOTS.reduce((n, s) => n + shelf[s].length, 0);
  const planned = loaded.reduce((n, p) => n + p.ledger.entries.filter((e) => !e.earlier).length, 0);
  const knowsYou = loaded.some((p) => mySide(p.id) !== null);

  const forget = (pairId: string) => setForgotten(forgetGroup(pairId));
  const undo = () => {
    if (forgotten) restoreGroup(forgotten);
    setForgotten(null);
  };

  return (
    <Page title="My evenings" className="evenings">
      <header className="evenings__head">
        <div className="evenings__intro">
          <h1 className="h2">My evenings</h1>
          <p className="muted">
            Every group you’ve opened here: what’s waiting, how each evening went, and how fair it’s been.{' '}
            <InfoTip label="Where this is kept">{EXPLAIN.myEvenings}</InfoTip>
          </p>
        </div>
        {groups.length > 0 && (
          <dl className="stats">
            <StatTile icon="calendar" label="Evenings planned" short="Evenings" value={settling ? null : planned} hint={`in ${groups.length} group${groups.length > 1 ? 's' : ''}`} />
            <StatTile icon="heart" label="Loved picks" short="Loved" value={lovedCount} hint="from check-ins here" />
            <StatTile icon="hourglass" label="Waiting on you" short="Waiting" value={settling ? null : waiting.length} hint={waiting.length ? 'see the list' : 'all clear'} />
          </dl>
        )}
      </header>

      {forgotten && (
        <Notice
          live
          icon="trash"
          title={`Forgot ${groupNames(forgotten.group.names, forgotten.group.members)} in this browser`}
          className="evenings__undo"
          action={
            <Button size="sm" icon="retry" onClick={undo}>
              Undo
            </Button>
          }
        >
          The group itself is still there for anyone with its link.
        </Notice>
      )}

      {groups.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid evenings__grid">
          <div className="evenings__waiting">
            <WaitingList items={waiting} loading={settling} knowsYou={knowsYou} />
          </div>
          <section className="evenings__groups" aria-labelledby="groups-title">
            <SectionHeader icon="users" id="groups-title" title="Your groups" meta={`${groups.length} remembered in this browser, last seen first.`} />
            {groups.map((g) => (
              <GroupCard key={g.pairId} memo={g} load={loads[g.pairId]} memory={memory} onRetry={() => retry(g.pairId)} onForget={() => forget(g.pairId)} />
            ))}
          </section>
          <div className="evenings__loved">
            <LovedShelf shelf={shelf} />
          </div>
        </div>
      )}
      {groups.length > 0 && (
        <p className="evenings__note icon-line small muted">
          <Icon name="info" size={16} />
          Kept only in this browser, for up to {MAX_GROUPS} groups.
        </p>
      )}
    </Page>
  );
}
