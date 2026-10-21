import type { Side, Slot } from '@contract';
import { useEffect, useState } from 'react';
import { Avatar, Badge, Icon, InfoTip, Spinner, Thumb, Voice } from '@/ui';
import { EXPLAIN } from '@/lib/glossary';
import { agentOf, listNames, nameOf, possessive } from '@/lib/people';
import type { ScoutStep, TruceState } from '@/lib/truce';
import { useTruceCtx } from './context';

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

/** One agent's scouting round: its searches, its finds, and its one line to the group. */
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

/** "How Qloo reads you": each person's taste words, and the vetoes in play. */
function Tastes({ state }: { state: TruceState }) {
  const { names, letters, members } = useTruceCtx();
  const tastes = state.tastes;
  if (!tastes) return null;
  return (
    <div className="tastes">
      <p className="tastes__title">
        How Qloo reads you
        <InfoTip label="What these words are">{EXPLAIN.portrait}</InfoTip>
        <Voice kind="qloo" />
      </p>
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
    </div>
  );
}

const GATHERING = (names: string[], location: string) => [
  `Reading ${listNames(names.map(possessive))} favourites`,
  `Finding restaurants in ${location}`,
  'Looking for picks you’d all like',
];

/**
 * Before the talks: Qloo gathers everyone's tastes, then each agent scouts.
 * Live, it leads the page; once the talks start it folds into a summary.
 */
export function Scouting({ state, folded = false }: { state: TruceState; folded?: boolean }) {
  const { names, members, location } = useTruceCtx();
  const lines = GATHERING(
    members.map((s) => nameOf(names, s)),
    location,
  );
  const [step, setStep] = useState(0);
  const scouting = members.some((s) => (state.scouts[s] ?? []).length > 0);

  useEffect(() => {
    if (step >= lines.length - 1) return;
    const timer = setTimeout(() => setStep(step + 1), 1500);
    return () => clearTimeout(timer);
  }, [step, lines.length]);

  const body = (
    <>
      <Tastes state={state} />
      {scouting && (
        <div className="scouts">
          <p className="tastes__title">
            The agents go scouting
            <InfoTip label="What scouting is">{EXPLAIN.scout}</InfoTip>
          </p>
          <ul className="scouts__list">
            {members
              .filter((s) => (state.scouts[s] ?? []).length > 0)
              .map((s) => (
                <AgentScout key={s} side={s} steps={state.scouts[s] ?? []} />
              ))}
          </ul>
        </div>
      )}
    </>
  );

  if (folded) {
    const finds = members.reduce((t, s) => t + (state.scouts[s] ?? []).filter((x) => x.step === 'add').length, 0);
    return (
      <details className="talks-fold">
        <summary className="talks-fold__summary">
          <Icon name="chevron-right" size={20} className="talks-fold__chevron" />
          <span>
            <span className="talks-fold__title">Before the talks</span>
            <span className="small muted"> {finds ? `${finds} ${finds === 1 ? 'pick' : 'picks'} scouted by the agents` : 'how Qloo reads you'}</span>
          </span>
        </summary>
        <div className="scouting scouting--folded">{body}</div>
      </details>
    );
  }

  return (
    <section className="card scouting" aria-labelledby="scouting-title" aria-live="polite">
      <h2 id="scouting-title" className="scouting__title">
        <Spinner size={20} />
        {state.phase === 'scouting' ? 'The agents are scouting' : 'Finding options for everyone'}
      </h2>
      {!state.tastes && (
        <ol className="scouting__steps">
          {lines.slice(0, step + 1).map((line, i) => (
            <li key={line} className={i === step ? 'is-now' : 'is-done'}>
              {i === step ? <span className="scouting__dot" aria-hidden="true" /> : <Icon name="check" size={16} />}
              {line}
            </li>
          ))}
        </ol>
      )}
      {body}
    </section>
  );
}
