import { useEffect, useState } from 'react';
import { Icon, Spinner } from '@/ui';
import { possessive } from '@/lib/people';
import { SLOT_ICON, SLOT_LABEL, SLOTS } from '@/lib/truce';
import { useTruceCtx } from './context';

/** While Qloo builds the pool: what is happening, in order, so the wait reads as work. */
export function Scouting() {
  const { names, location } = useTruceCtx();
  const lines = [
    `Reading ${possessive(names.a)} picks`,
    `Reading ${possessive(names.b)} picks`,
    `Looking for restaurants in ${location}`,
    'Hunting for bridges between your tastes',
    `Scoring every option for ${names.a}`,
    `Scoring every option for ${names.b}`,
  ];
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (step >= lines.length - 1) return;
    const timer = setTimeout(() => setStep(step + 1), 1500);
    return () => clearTimeout(timer);
  }, [step, lines.length]);

  return (
    <section className="scouting" aria-labelledby="scouting-title">
      <div className="scouting__slots" aria-hidden="true">
        {SLOTS.map((slot, i) => (
          <span key={slot} className="scouting__slot" style={{ ['--i' as string]: i }}>
            <Icon name={SLOT_ICON[slot]} size={24} />
            <span className="scouting__slot-label">{SLOT_LABEL[slot]}</span>
          </span>
        ))}
      </div>
      <h2 id="scouting-title" className="display-m scouting__title">
        Asking Qloo what you both love&hellip;
      </h2>
      <ol className="scouting__steps" aria-live="polite">
        {lines.slice(0, step + 1).map((line, i) => (
          <li key={line} className={i === step ? 'is-now' : 'is-done'}>
            {i === step ? <Spinner size={16} /> : <Icon name="check" size={16} />}
            {line}
          </li>
        ))}
      </ol>
      <p className="small muted">Usually a few seconds. The agents start the moment the pool is ready.</p>
    </section>
  );
}
