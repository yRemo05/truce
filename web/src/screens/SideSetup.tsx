/*
 * One person's side (/p/:pairId/:side) — step 3 of 3.
 *
 * Inventory, by priority:
 *   primary   — three pickers (film, restaurant, music): search Qloo, confirm, 1–3 each;
 *               restaurants take a place or a food (a dish or a cuisine)
 *   primary   — Save, in the sticky bar with the "n of 3 slots" progress
 *   secondary — what matters most tonight (three-level weight per slot, and the split)
 *   secondary — a private note for their agent (≤ 280 characters, examples to tap)
 *   rare      — notice that saving again replaces a saved side, with the way back to tonight's
 *               questions alone when they're due
 * After saving a note: what the agent understood (private), then Continue.
 *
 * A new evening (tonightDue, unless `?all`): tonight's questions alone, favourites kept.
 *   primary   — what matters most tonight; Save in the sticky bar
 *   secondary — the note for their agent; foods for tonight (a food-only restaurant search, ≤ 3;
 *               the server refuses more with the saved favourite places counted in)
 *   rare      — change my favourites too (the whole form, `?all`)
 *
 * Viewport budget: at 1440×900 all three pickers, the weights and Save are in
 * view; at 390×844 the bar (with Save) and the first picker are. Tonight's
 * form fits 1440×900 whole; at 390×844 the bar and the weights are in view.
 * Grid: pickers in three columns of four ≥1024px, the weight controls in the
 * same three columns underneath so each sits under its slot. Phone: one column.
 * Tonight's form: the weights across, then the note (two columns) beside foods (one).
 * Icons: film / restaurant / music, food, search, plus, x (remove), check (save),
 * sliders (weights), quote (the note), ban (vetoes), eye-off (private), arrow-right,
 * pencil (change favourites), arrow-left (back to tonight's questions).
 */
import type { BriefView, Side, SideSaved, Slot } from '@contract';
import { useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { api } from '@/api';
import { Avatar, Badge, Button, ButtonLink, ErrorNotice, Notice, Page, SectionHeader, Skeleton } from '@/ui';
import { isPassMode, nextUp, wantsAll, withAll, withPass } from '@/lib/flow';
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

/** Shaped like the form, until it's known which form this person gets. */
function SideSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="side__intro">
        <div>
          <Skeleton w="min(18rem, 80%)" h="2rem" />
          <Skeleton w="min(28rem, 100%)" h="1rem" delay={80} />
        </div>
      </div>
      <div className="side__pickers">
        {SLOTS.map((slot, i) => (
          <div key={slot} className="card picker">
            <Skeleton w="7rem" h="1.25rem" delay={i * 80} />
            <Skeleton h="var(--control-h)" delay={i * 80} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SideSetup({ pairId, side }: { pairId: string; side: Side }) {
  const [, navigate] = useLocation();
  const search = useSearch();
  const pass = isPassMode(search);
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

  // Favourites saved, and an evening since: tonight's questions alone, unless they asked for the whole form.
  const due = Boolean(pair?.tonightDue[side]);
  const tonight = due && !wantsAll(search);
  const saved = Boolean(pair && (pair.ready[side] || due));
  const here = withPass(`/p/${pairId}/${side}`, pass);

  const moveOn = (ready: SideSaved['ready']) => {
    const next = pass && pair ? nextUp(pair.members, ready, side) : null;
    if (next) navigate(`/p/${pairId}/handoff/${next}`, { replace: true });
    else navigate(withPass(`/p/${pairId}`, pass), { replace: true });
  };

  const saving = useAction(async () => {
    // Foods travel apart from the Qloo entities, exactly as the search returned them.
    const foods = picks.restaurant.flatMap((p) => (p.food ? [p.food] : []));
    const note = brief.trim();
    const answers = {
      weights: weightsOf(levels),
      ...(foods.length ? { foods } : {}),
      ...(note ? { brief: note } : {}),
    };
    const result = tonight
      ? await api.saveTonight(pairId, side, answers)
      : await api.saveSide(pairId, side, { seeds: bySlot((s) => picks[s].filter((p) => !p.food).map(({ id, name: n }) => ({ id, name: n }))), ...answers });
    rememberSide(pairId, side);
    if (note) setUnderstood({ ready: result.ready, brief: result.brief });
    else moveOn(result.ready);
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
    // Tonight's answers are always complete: the weights have defaults, foods and the note are optional.
    if (tonight || any) void saving.run();
  };

  const who = pair && (
    <span className="side__who">
      <Avatar side={side} letters={nameOf(monograms(pair.names, pair.members), side)} size="sm" />
      <span className="side__who-name">{tonight ? `Tonight for ${name}` : `${possessive(name)} favourites`}</span>
      {pass && (
        <span className="side__step small muted">
          {seat + 1} of {pair.members.length}
        </span>
      )}
    </span>
  );

  const saveButton = (
    <Button variant="primary" size="sm" icon="check" busy={saving.busy} onClick={save} disabled={!pair}>
      Save
    </Button>
  );
  const weights = (
    <section className="card side__weights" aria-labelledby="weights-title">
      <SectionHeader icon="sliders" id="weights-title" title="What matters most tonight?" meta="Your agent pushes harder for what matters more to you." />
      <Weights levels={levels} onChange={(slot, level) => setLevels((l) => ({ ...l, [slot]: level }))} />
    </section>
  );
  const onAdd = (slot: Slot) => (p: Picked) => setPicks((all) => ({ ...all, [slot]: [...all[slot], p] }));
  const onRemove = (slot: Slot) => (id: string) => setPicks((all) => ({ ...all, [slot]: all[slot].filter((p) => p.id !== id) }));
  const saveError = saving.error && <ErrorNotice error={saving.error} title={tonight ? `Couldn't save ${possessive(name)} answers` : `Couldn't save ${possessive(name)} side`} />;

  if (understood) {
    return (
      <Page title={tonight ? `Tonight for ${name}` : `${possessive(name)} side`} stickyBar className="side" context={who}>
        <div className="side__intro">
          <div>
            <h1 className="h2">Saved</h1>
            <p className="muted">
              {tonight ? 'Tonight’s answers are in.' : 'Your favourites are in.'}
              {understood.brief && ' Here’s what your agent took from your note.'}
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

  if (!pair && !loadError) {
    return (
      <Page title="Your side" stickyBar className="side">
        <SideSkeleton />
      </Page>
    );
  }

  if (tonight) {
    return (
      <Page title={`Tonight for ${name}`} stickyBar className="side" context={who} actions={saveButton}>
        <div className="side__intro">
          <div>
            <h1 className="h2">Tonight for {name}</h1>
            <p className="muted">A new evening. Your favourites stay; tell your agent what you&rsquo;re in the mood for tonight.</p>
            <ButtonLink size="sm" variant="ghost" icon="pencil" href={withAll(here)} className="side__redo">
              Change my favourites too
            </ButtonLink>
          </div>
          {pass && <Steps current={3} className="side__steps" />}
        </div>

        <div className="side__tonight">
          {weights}
          <BriefField value={brief} onChange={setBrief} />
          <SeedPicker slot="restaurant" foodsOnly picks={picks.restaurant} onAdd={onAdd('restaurant')} onRemove={onRemove('restaurant')} />
        </div>

        {saveError && <div className="side__footer">{saveError}</div>}
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
          {saveButton}
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
      {saved && (
        <Notice
          tone="info"
          title={`${possessive(name)} favourites are already saved`}
          action={
            due && (
              <ButtonLink size="sm" variant="ghost" icon="arrow-left" href={here}>
                Just tonight&rsquo;s questions
              </ButtonLink>
            )
          }
        >
          They stay private, so they don&rsquo;t show here. Saving again replaces them.
        </Notice>
      )}

      <div className="side__pickers">
        {SLOTS.map((slot) => (
          <SeedPicker key={slot} slot={slot} picks={picks[slot]} onAdd={onAdd(slot)} onRemove={onRemove(slot)} near={slot === 'restaurant' ? pair?.location : null} />
        ))}
      </div>

      {weights}

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
        {saveError}
      </div>
    </Page>
  );
}
