/*
 * One person's side (/p/:pairId/:side) — step 3 of 3.
 *
 * Inventory, by priority:
 *   primary   — three pickers (film, restaurant, music): search Qloo, confirm, 1–3 each;
 *               restaurants take a place or a food (a dish or a cuisine)
 *   primary   — Save, in the sticky bar with the "n of 3 slots" progress
 *   secondary — what matters most tonight (three-level weight per slot, and the split)
 *   secondary — a private note for their agent (≤ 280 characters, examples to tap)
 *   rare      — notice that saving again replaces a saved side
 * After saving a note: what the agent understood (private), then Continue.
 *
 * Viewport budget: at 1440×900 all three pickers, the weights and Save are in
 * view; at 390×844 the bar (with Save) and the first picker are.
 * Grid: pickers in three columns of four ≥1024px, the weight controls in the
 * same three columns underneath so each sits under its slot. Phone: one column.
 * Icons: film / restaurant / music, search, plus, x (remove), check (save),
 * sliders (weights), quote (the note), ban (vetoes), eye-off (private), arrow-right.
 */
import type { BriefView, Side, SideSaved, Slot } from '@contract';
import { useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { api } from '@/api';
import { Avatar, Badge, Button, ErrorNotice, Notice, Page, SectionHeader } from '@/ui';
import { isPassMode, nextUp, withPass } from '@/lib/flow';
import { rememberSide } from '@/lib/mine';
import { monograms, nameOf, possessive } from '@/lib/people';
import { bySlot, SLOTS } from '@/lib/truce';
import { useAction } from '@/lib/useAction';
import { usePair } from '@/lib/usePair';
import { BriefField } from '@/picks/BriefField';
import { BriefSummary } from '@/picks/BriefSummary';
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
  const [brief, setBrief] = useState('');
  const [tried, setTried] = useState(false);
  /**
   * Set once saved with a note: the page shows what the agent understood before
   * moving on, or, when the server couldn't read the note (brief: null), says so.
   */
  const [understood, setUnderstood] = useState<{ ready: SideSaved['ready']; brief: BriefView | null } | null>(null);

  const moveOn = (ready: SideSaved['ready']) => {
    const next = pass && pair ? nextUp(pair.members, ready, side) : null;
    if (next) navigate(`/p/${pairId}/handoff/${next}`, { replace: true });
    else navigate(withPass(`/p/${pairId}`, pass), { replace: true });
  };

  const saving = useAction(async () => {
    // Foods travel apart from the Qloo entities, exactly as the search returned them.
    const seeds = bySlot((s) => picks[s].filter((p) => !p.food).map(({ id, name: n }) => ({ id, name: n })));
    const foods = picks.restaurant.flatMap((p) => (p.food ? [p.food] : []));
    const note = brief.trim();
    const saved = await api.saveSide(pairId, side, {
      seeds,
      weights: weightsOf(levels),
      ...(foods.length ? { foods } : {}),
      ...(note ? { brief: note } : {}),
    });
    rememberSide(pairId, side);
    if (note) setUnderstood({ ready: saved.ready, brief: saved.brief });
    else moveOn(saved.ready);
  });

  if (loadError?.status === 404) return <NotFound what="pair" />;
  if (pair && !pair.members.includes(side)) return <NotFound what="pair" />;

  const name = pair ? nameOf(pair.names, side) : '';
  const seat = pair ? pair.members.indexOf(side) : 0;
  const missing = SLOTS.filter((s) => picks[s].length === 0);
  const filled = SLOTS.length - missing.length;
  // Foods guide the restaurant, but the agents need at least one film, artist or place to start from.
  const any = SLOTS.some((s) => picks[s].some((p) => !p.food));
  const onlyFoods = !any && filled > 0;

  const save = () => {
    setTried(true);
    if (any) void saving.run();
  };

  const who = pair && (
    <span className="side__who">
      <Avatar side={side} letters={nameOf(monograms(pair.names, pair.members), side)} size="sm" />
      <span className="side__who-name">{possessive(name)} favourites</span>
      {pass && (
        <span className="side__step small muted">
          {seat + 1} of {pair.members.length}
        </span>
      )}
    </span>
  );

  if (understood) {
    return (
      <Page
        title={`${possessive(name)} side`}
        stickyBar
        className="side"
        context={who}
      >
        <div className="side__intro">
          <div>
            <h1 className="h2">Saved</h1>
            <p className="muted">
              {understood.brief ? 'Your favourites are in. Here’s what your agent took from your note.' : 'Your favourites are in.'}
            </p>
          </div>
        </div>
        <div className="side__understood">
          {understood.brief ? (
            <BriefSummary brief={understood.brief} />
          ) : (
            <Notice tone="info" title="Your note wasn’t read">
              Your agent can&rsquo;t read notes right now, so your favourites and weights will guide it.
            </Notice>
          )}
          <div className="side__understood-actions">
            <Button variant="primary" iconEnd="arrow-right" onClick={() => moveOn(understood.ready)}>
              Continue
            </Button>
            <Button variant="ghost" icon="pencil" onClick={() => setUnderstood(null)}>
              Change my note
            </Button>
          </div>
        </div>
      </Page>
    );
  }

  return (
    <Page
      title={name ? `${possessive(name)} side` : 'Your side'}
      stickyBar
      className="side"
      context={who}
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
            {pass && seat > 0 && ' Everyone else’s favourites are hidden.'}
          </p>
        </div>
        {pass && <Steps current={3} className="side__steps" />}
      </div>

      {loadError && <ErrorNotice error={loadError} title="Couldn't load this truce" onRetry={reload} />}
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

      <BriefField value={brief} onChange={setBrief} />

      <div className="side__footer">
        {tried && onlyFoods ? (
          <Notice tone="warn" live title="Add a film, an artist or a place too">
            Foods guide the restaurant, but your agent needs at least one film, artist or place to start from.
          </Notice>
        ) : tried && !any ? (
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
