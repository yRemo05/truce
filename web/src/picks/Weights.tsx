import type { Slot } from '@contract';
import { Icon, Segmented } from '@/ui';
import { bySlot, SLOT_ICON, SLOT_LABEL, SLOTS } from '@/lib/truce';

export type Level = 'little' | 'some' | 'lot';

/** What each level is worth; the server normalises them to shares. */
const LEVEL_VALUE: Record<Level, number> = { little: 1, some: 2, lot: 4 };

const OPTIONS = [
  { value: 'little', label: 'A little' },
  { value: 'some', label: 'Some' },
  { value: 'lot', label: 'A lot' },
] as const;

export const weightsOf = (levels: Record<Slot, Level>) => bySlot((s) => LEVEL_VALUE[levels[s]]);

/** "What matters most tonight?": one three-step control per slot, and the split it makes. */
export function Weights({ levels, onChange }: { levels: Record<Slot, Level>; onChange: (slot: Slot, level: Level) => void }) {
  const weights = weightsOf(levels);
  const total = SLOTS.reduce((t, s) => t + weights[s], 0);
  return (
    <div className="weights">
      <div className="weights__grid">
        {SLOTS.map((slot) => (
          <div key={slot} className="weights__slot">
            <span className="weights__label" aria-hidden="true">
              <Icon name={SLOT_ICON[slot]} size={16} />
              {SLOT_LABEL[slot]}
            </span>
            <Segmented
              legend={`How much ${SLOT_LABEL[slot].toLowerCase()} matters tonight`}
              hideLegend
              size="sm"
              value={levels[slot]}
              options={OPTIONS}
              onChange={(level) => onChange(slot, level)}
            />
          </div>
        ))}
      </div>
      <div className="split" aria-label="How tonight is split">
        {SLOTS.map((slot) => {
          const share = Math.round((weights[slot] / total) * 100);
          return (
            <span key={slot} className={`split__part split__part--${slot}`} style={{ flexGrow: weights[slot] }}>
              <span className="split__text">
                {SLOT_LABEL[slot]} {share}%
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
