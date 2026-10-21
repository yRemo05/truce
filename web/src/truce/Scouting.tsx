import { useEffect, useState } from 'react';
import { Icon, Spinner } from '@/ui';
import { possessive } from '@/lib/people';
import { useTruceCtx } from './context';

/** While Qloo builds the options: what is happening, in order, so the wait reads as work. */
export function Scouting() {
  const { names, location } = useTruceCtx();
  const lines = [
    `Reading ${possessive(names.a)} favourites`,
    `Reading ${possessive(names.b)} favourites`,
    `Finding restaurants in ${location}`,
    'Looking for picks you’d both like',
    'Scoring every option for each of you',
  ];
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (step >= lines.length - 1) return;
    const timer = setTimeout(() => setStep(step + 1), 1500);
    return () => clearTimeout(timer);
  }, [step, lines.length]);

  return (
    <section className="card scouting" aria-labelledby="scouting-title">
      <h2 id="scouting-title" className="scouting__title">
        <Spinner size={20} />
        Finding options for both of you
      </h2>
      <ol className="scouting__steps" aria-live="polite">
        {lines.slice(0, step + 1).map((line, i) => (
          <li key={line} className={i === step ? 'is-now' : 'is-done'}>
            {i === step ? <span className="scouting__dot" aria-hidden="true" /> : <Icon name="check" size={16} />}
            {line}
          </li>
        ))}
      </ol>
      <p className="small muted">This usually takes a few seconds. Then the agents start talking.</p>
    </section>
  );
}
