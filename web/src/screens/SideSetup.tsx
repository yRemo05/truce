/*
 * One person's side (/p/:pairId/:side) — step 3 of 3.
 *
 * Inventory, by priority:
 *   primary   — three pickers (film, restaurant, music): search Qloo, confirm, 1–3 each
 *   primary   — Save, in the sticky bar with the "n of 3 slots" progress
 *   secondary — what matters most tonight (three-level weight per slot, and the split)
 *   rare      — notice that saving again replaces a saved side
 *
 * Viewport budget: at 1440×900 all three pickers, the weights and Save are in
 * view; at 390×844 the bar (with Save) and the first picker are.
 * Grid: pickers in three columns of four ≥1024px, the weight controls in the
 * same three columns underneath so each sits under its slot. Phone: one column.
 * Icons: film / restaurant / music, search, plus, x (remove), check (save), sliders.
 */
import type { Side, Slot } from '@contract';
import { useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { api } from '@/api';
import { Avatar, Badge, Button, ErrorNotice, Notice, Page, SectionHeader } from '@/ui';
import { isPassMode, withPass } from '@/lib/flow';
import { monograms, possessive } from '@/lib/people';
import { bySlot, SLOTS } from '@/lib/truce';
import { useAction } from '@/lib/useAction';
import { usePair } from '@/lib/usePair';
import { SeedPicker, type Picked } from '@/picks/SeedPicker';
import { Weights, weightsOf, type Level } from '@/picks/Weights';
import { NotFound } from './NotFound';
import { Steps } from './Steps';

const EMPTY: Record<Slot, Picked[]> = { film: [], restaurant: [], music: [] };

export function SideSetup({ pairId, side }: { pairId: string; side: Side }) {
  const [, navigate] = useLocation();
  const pass = isPassMode(useSearch());
  const { pair, error: loadError, reload } = usePair(pairId);
  const [picks, setPicks] = useState(EMPTY);
  const [levels, setLevels] = useState<Record<Slot, Level>>({ film: 'some', restaurant: 'some', music: 'some' });
  const [tried, setTried] = useState(false);
  const saving = useAction(async () => {
    const seeds = bySlot((s) => picks[s].map(({ id, name: n }) => ({ id, name: n })));
    const { ready } = await api.saveSide(pairId, side, { seeds, weights: weightsOf(levels) });
    if (pass && side === 'a' && !ready.b) navigate(`/p/${pairId}/handoff`, { replace: true });
    else navigate(withPass(`/p/${pairId}`, pass), { replace: true });
  });

  if (loadError?.status === 404) return <NotFound what="pair" />;

  const name = pair?.names[side] ?? '';
  const missing = SLOTS.filter((s) => picks[s].length === 0);
  const filled = SLOTS.length - missing.length;
  const any = filled > 0;

  const save = () => {
    setTried(true);
    if (any) void saving.run();
  };

  return (
    <Page
      title={name ? `${possessive(name)} side` : 'Your side'}
      stickyBar
      className="side"
      context={
        pair && (
          <span className="side__who">
            <Avatar side={side} letters={monograms(pair.names)[side]} size="sm" />
            <span className="side__who-name">{possessive(name)} favourites</span>
            {pass && <span className="side__step small muted">{side === 'a' ? '1 of 2' : '2 of 2'}</span>}
          </span>
        )
      }
      actions={
        <>
          <Badge variant={filled === 3 ? 'success' : 'secondary'} icon={filled === 3 ? 'check' : undefined} className="side__progress">
            {filled} of 3 done
          </Badge>
          <Button variant="primary" size="sm" icon="check" busy={saving.busy} onClick={save} disabled={!pair}>
            Save
          </Button>
        </>
      }
    >
      <div className="side__intro">
        <div>
          <h1 className="h2">{name ? `What does ${name} love?` : <span className="visually-hidden">Loading</span>}</h1>
          <p className="muted">
            Search and add one to three of each. They can be from anywhere.
            {pass && pair && side === 'b' && ` ${possessive(pair.names.a)} favourites are hidden.`}
          </p>
        </div>
        {pass && <Steps current={3} className="side__steps" />}
      </div>

      {loadError && <ErrorNotice error={loadError} title="Couldn't load this pair" onRetry={reload} />}
      {pair?.ready[side] && (
        <Notice tone="info" title={`${possessive(name)} favourites are already saved`}>
          They stay private, so they don&rsquo;t show here. Saving again replaces them.
        </Notice>
      )}

      <div className="side__pickers">
        {SLOTS.map((slot) => (
          <SeedPicker
            key={slot}
            slot={slot}
            picks={picks[slot]}
            onAdd={(p) => setPicks((all) => ({ ...all, [slot]: [...all[slot], p] }))}
            onRemove={(id) => setPicks((all) => ({ ...all, [slot]: all[slot].filter((p) => p.id !== id) }))}
            near={slot === 'restaurant' ? pair?.location : null}
          />
        ))}
      </div>

      <section className="card side__weights" aria-labelledby="weights-title">
        <SectionHeader icon="sliders" id="weights-title" title="What matters most tonight?" meta="Your agent pushes harder for what matters more to you." />
        <Weights levels={levels} onChange={(slot, level) => setLevels((l) => ({ ...l, [slot]: level }))} />
      </section>

      <div className="side__footer">
        {tried && !any ? (
          <Notice tone="warn" live title="Add at least one favourite first">
            Search above and tap a result to add it.
          </Notice>
        ) : any && missing.length > 0 ? (
          <Notice tone="info">
            No {missing.join(' or ')} yet. That&rsquo;s fine, but one of each gives a better evening.
          </Notice>
        ) : null}
        {saving.error && <ErrorNotice error={saving.error} title={`Couldn't save ${possessive(name)} side`} />}
      </div>
    </Page>
  );
}
