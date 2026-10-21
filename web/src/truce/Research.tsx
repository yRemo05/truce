import type { Side, Slot } from '@contract';
import { useEffect, useState } from 'react';
import { Avatar, Badge, Icon, InfoTip, SectionHeader, Spinner, Thumb, Voice } from '@/ui';
import { eveningLabel } from '@/lib/format';
import { EXPLAIN } from '@/lib/glossary';
import { agentOf, listNames, nameOf, possessive } from '@/lib/people';
import { findsOf, type ScoutStep, type TruceState } from '@/lib/truce';
import { useTruceCtx } from './context';
import { PoolPanel, PoolSkeleton } from './PoolPanel';

const NOUN: Record<Slot, string> = { film: 'films', restaurant: 'restaurants', music: 'artists' };

/** "Searching Qloo for cosy restaurants like Doy Doy around Cihangir → 5 found". */
function SearchLine({ step }: { step: Extract<ScoutStep, { step: 'search' }> }) {
  const { location } = useTruceCtx();
  const words = step.words.length ? `${step.words.join(', ')} ` : '';
  const like = step.like.length ? ` like ${step.like.join(', ')}` : '';
  const hotspot = step.area && step.area !== location;
  return (
    <li className="scout__step">
      <Icon name="search" size={16} className="scout__icon" />
      <span>
        Searching Qloo for {words}
        {NOUN[step.slot]}
        {like}
        {step.area && (
          <>
            {' '}
            around {step.area}
            {hotspot && <InfoTip label="What a taste hotspot is">{EXPLAIN.hotspot}</InfoTip>}
          </>
        )}{' '}
        <span className="muted num">→ {step.found.length} found</span>
      </span>
    </li>
  );
}

function AddLine({ step }: { step: Extract<ScoutStep, { step: 'add' }> }) {
  return (
    <li className="scout__step scout__step--add">
      <Thumb name={step.item.name} imageUrl={step.item.imageUrl} slot={step.slot} />
      <span>
        <span className="scout__added">Added {step.item.name}</span>
        <span className="muted"> · {step.why}</span>
      </span>
    </li>
  );
}

/** One agent's scouting round: its searches, its finds and why, and its one line to the group. */
function AgentScout({ side, steps }: { side: Side; steps: ScoutStep[] }) {
  const { names, letters } = useTruceCtx();
  const done = steps.find((s): s is Extract<ScoutStep, { step: 'done' }> => s.step === 'done');
  return (
    <li className="scout">
      <p className="scout__head">
        <Avatar side={side} letters={nameOf(letters, side)} size="sm" />
        <span className="scout__who">{agentOf(nameOf(names, side))}</span>
        <Voice kind="agent" />
        {done ? (
          <Badge variant="success" icon="check">
            Done
          </Badge>
        ) : (
          <Badge icon="search">Scouting</Badge>
        )}
      </p>
      <ul className="scout__steps">
        {steps.map((step, i) =>
          step.step === 'search' ? <SearchLine key={i} step={step} /> : step.step === 'add' ? <AddLine key={i} step={step} /> : null,
        )}
      </ul>
      {done?.message && <p className="scout__done small">{done.message}</p>}
    </li>
  );
}

const gatheringLines = (names: string[], location: string) => [
  `Reading ${listNames(names.map(possessive))} favourites`,
  `Finding restaurants in ${location}`,
  'Looking for picks you’d all like',
];

/** While Qloo gathers: three steps that tick over, so the wait reads as work. */
function Gathering() {
  const { names, members, location } = useTruceCtx();
  const lines = gatheringLines(
    members.map((s) => nameOf(names, s)),
    location,
  );
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (step >= lines.length - 1) return;
    const timer = setTimeout(() => setStep(step + 1), 1500);
    return () => clearTimeout(timer);
  }, [step, lines.length]);
  return (
    <ol className="scouting__steps" aria-live="polite">
      {lines.slice(0, step + 1).map((line, i) => (
        <li key={line} className={i === step ? 'is-now' : 'is-done'}>
          {i === step ? <span className="scouting__dot" aria-hidden="true" /> : <Icon name="check" size={16} />}
          {line}
        </li>
      ))}
    </ol>
  );
}

/** "How Qloo reads you": each person's taste words, and the vetoes in play. */
function Tastes({ state }: { state: TruceState }) {
  const { names, letters, members } = useTruceCtx();
  const tastes = state.tastes;
  // A truce that stopped before Qloo read anyone has nothing to show here; the stop notice says why.
  if (!tastes && state.error) return null;
  const waiting = !tastes && (state.phase === 'connecting' || state.phase === 'gathering');
  return (
    <section className="card research__card" aria-labelledby="tastes-title">
      <SectionHeader
        icon="users"
        id="tastes-title"
        title="How Qloo reads you"
        info={<InfoTip label="What these words are">{EXPLAIN.portrait}</InfoTip>}
        actions={<Voice kind="qloo" />}
      />
      {tastes ? (
        <>
          <ul className="tastes__people">
            {members.map((s) => (
              <li key={s} className="tastes__person">
                <span className="tastes__who">
                  <Avatar side={s} letters={nameOf(letters, s)} size="sm" />
                  {nameOf(names, s)}
                </span>
                <span className="tastes__words">
                  {(tastes.portraits[s] ?? []).map((w) => (
                    <Badge key={w} variant="secondary">
                      {w}
                    </Badge>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          {tastes.vetoes.length > 0 && (
            <p className="tastes__vetoes">
              <span className="small muted">
                Ruled out tonight
                <InfoTip label="What a veto is">{EXPLAIN.veto}</InfoTip>
              </span>
              {tastes.vetoes.map((v) => (
                <Badge key={v} variant="veto" icon="ban">
                  {v}
                </Badge>
              ))}
            </p>
          )}
        </>
      ) : waiting ? (
        <Gathering />
      ) : (
        <p className="small muted">Qloo didn&rsquo;t describe anyone&rsquo;s taste for this truce.</p>
      )}
    </section>
  );
}

/** Each agent's scouting: what it searched for, what it added and why. */
function Scouts({ state }: { state: TruceState }) {
  const { members } = useTruceCtx();
  const scouting = members.filter((s) => (state.scouts[s] ?? []).length > 0);
  if (!scouting.length && state.phase !== 'scouting') return null;
  const finds = findsOf(state);
  return (
    <section className="card research__card" aria-labelledby="scouts-title">
      <SectionHeader
        icon="search"
        id="scouts-title"
        title={state.phase === 'scouting' ? 'The agents are scouting' : 'What the agents scouted'}
        info={<InfoTip label="What scouting is">{EXPLAIN.scout}</InfoTip>}
        meta={state.phase === 'scouting' ? undefined : `${finds} ${finds === 1 ? 'pick' : 'picks'} added to the options.`}
        actions={state.phase === 'scouting' ? <Spinner size={20} label="Scouting" /> : undefined}
      />
      <ul className="scouts__list" aria-live="polite">
        {scouting.map((s) => (
          <AgentScout key={s} side={s} steps={state.scouts[s] ?? []} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Research: everything before the talks. Where and when, how Qloo reads each
 * person, what each agent scouted, and every option with where it came from.
 */
export function Research({ state }: { state: TruceState }) {
  const { location } = useTruceCtx();
  const tonight = state.tonight;
  return (
    <div className="phase phase--research">
      <p className="phase__where small muted">
        <span>
          <Icon name="pin" size={16} />
          {location}
        </span>
        {tonight && (
          <span>
            <Icon name="calendar" size={16} />
            {eveningLabel(tonight.date, tonight.weekday)}
          </span>
        )}
      </p>
      <div className="research__main">
        <Tastes state={state} />
        <Scouts state={state} />
      </div>
      <div className="research__options">
        {state.pool ? (
          <PoolPanel pool={state.pool} indifferent={state.indifferent} table={state.onTable?.bundle ?? null} final={state.result?.bundle ?? null} />
        ) : (
          !state.error && <PoolSkeleton />
        )}
      </div>
    </div>
  );
}
