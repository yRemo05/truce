import type { CardItem, Side, Slot } from '@contract';
import { memo, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Chip, cx, Icon, Monogram, Notice, ScoreMeter, SectionHeader, Skeleton, Thumb, Voice } from '@/ui';
import { possessive, SIDES } from '@/lib/people';
import { isBridge, SLOT_ICON, SLOT_LABEL, SLOTS, type Bundle } from '@/lib/truce';
import { Because } from './Because';
import { useTruceCtx } from './context';
import { subLine } from './Evening';

/** The facts worth showing, in this order. */
const FACT_LABEL: Record<string, string> = {
  cuisineType: 'Cuisine',
  cuisine: 'About',
  price: 'Price',
  ambience: 'Feel',
  dishes: 'Known for',
  goodFor: 'Good for',
  genres: 'Genres',
  sound: 'Sound',
  tone: 'Tone',
  minutes: 'Minutes',
  rating: 'Rated',
};

type Mark = 'table' | 'plan' | null;

function Origin({ item }: { item: CardItem }) {
  const { names, letters } = useTruceCtx();
  if (isBridge(item)) {
    return (
      <Chip tone="seal" icon="bridge" className="pool-row__origin">
        Bridge
      </Chip>
    );
  }
  const side = item.origins.includes('a') ? 'a' : 'b';
  return (
    <span className="pool-row__origin" title={`From ${possessive(names[side])} taste`}>
      <Monogram side={side} letters={letters[side]} size="xs" />
      <span className="visually-hidden">From {possessive(names[side])} taste</span>
    </span>
  );
}

const Row = memo(function Row({ item, mark }: { item: CardItem; mark: Mark }) {
  const { names } = useTruceCtx();
  const sub = subLine(item);
  const facts = Object.keys(FACT_LABEL).flatMap((k) => (item.facts[k] ? [[k, item.facts[k]] as const] : []));
  return (
    <li className={cx('pool-row', mark && `is-${mark}`)}>
      <details>
        <summary className="pool-row__summary">
          <Thumb name={item.name} imageUrl={item.imageUrl} slot={item.slot} />
          <span className="pool-row__main">
            <span className="pool-row__title">
              <span className="pool-row__name">{item.name}</span>
              {sub && <span className="pool-row__sub">{sub}</span>}
            </span>
            <span className="pool-row__meters">
              {SIDES.map((side) => (
                <ScoreMeter key={side} side={side} name={names[side]} value={item.scores[side]} size="sm" />
              ))}
            </span>
          </span>
          <span className="pool-row__side">
            <Origin item={item} />
            {mark && (
              <span className="pool-row__mark">
                <span className="pool-row__dot" aria-hidden="true" />
                {mark === 'plan' ? 'In the plan' : 'On the table'}
              </span>
            )}
          </span>
        </summary>
        <div className="pool-row__more">
          {item.blurb && <p className="small">{item.blurb}</p>}
          {facts.length > 0 && (
            <dl className="pool-row__facts small">
              {facts.slice(0, 4).map(([k, v]) => (
                <div key={k}>
                  <dt>{FACT_LABEL[k]}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {SIDES.map((side) => (
            <Because key={side} item={item} side={side} />
          ))}
        </div>
      </details>
    </li>
  );
});

export function PoolSkeleton() {
  return (
    <section className="pool" aria-label="The pool, loading">
      <div className="pool__head">
        <Skeleton w="7rem" h="1.5rem" />
        <Skeleton w="12rem" h="0.875rem" delay={80} />
      </div>
      <div className="pool__tabs pool__tabs--skeleton" aria-hidden="true">
        {SLOTS.map((s, i) => (
          <Skeleton key={s} w="6.5rem" h="2.25rem" round delay={i * 60} />
        ))}
      </div>
      <ul className="pool__list" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="pool-row pool-row--skeleton">
            <span className="pool-row__summary">
              <Skeleton w="2.5rem" h="2.5rem" delay={i * 90} />
              <span className="pool-row__main">
                <Skeleton w={`${55 + ((i * 17) % 30)}%`} h="0.875rem" delay={i * 90} />
                <Skeleton w="80%" h="0.375rem" delay={i * 90 + 40} />
                <Skeleton w="80%" h="0.375rem" delay={i * 90 + 80} />
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface PoolPanelProps {
  pool: Record<Slot, CardItem[]>;
  indifferent: Record<Side, Record<Slot, boolean>> | null;
  /** The evening on the table now, and the final one once there is one. */
  table: Bundle | null;
  final: Bundle | null;
}

const STEP: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };

export function PoolPanel({ pool, indifferent, table, final }: PoolPanelProps) {
  const { names } = useTruceCtx();
  const [slot, setSlot] = useState<Slot>('film');
  const [expanded, setExpanded] = useState(false);
  const tabs = useRef<Partial<Record<Slot, HTMLButtonElement | null>>>({});

  const items = useMemo(() => [...pool[slot]].sort((x, y) => y.scores.a + y.scores.b - (x.scores.a + x.scores.b)), [pool, slot]);
  const { total, bridges } = useMemo(() => {
    const all = SLOTS.flatMap((s) => pool[s]);
    return { total: all.length, bridges: all.filter(isBridge).length };
  }, [pool]);
  const flat = indifferent ? SIDES.filter((side) => indifferent[side][slot]) : [];

  const markOf = (item: CardItem): Mark => {
    if (final) return final[item.slot] === item.id ? 'plan' : null;
    return table?.[item.slot] === item.id ? 'table' : null;
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = SLOTS.indexOf(slot);
    const step = STEP[e.key];
    const next = step ? SLOTS[(i + step + SLOTS.length) % SLOTS.length] : e.key === 'Home' ? SLOTS[0] : e.key === 'End' ? SLOTS[SLOTS.length - 1] : undefined;
    if (!next) return;
    e.preventDefault();
    setSlot(next);
    tabs.current[next]?.focus();
  };

  return (
    <section className={cx('pool', !expanded && 'pool--collapsed')} aria-labelledby="pool-title">
      <SectionHeader
        className="pool__head"
        icon="data"
        id="pool-title"
        title="The pool"
        meta={`${total} options Qloo found for the two of you, ${bridges} of them bridges.`}
        actions={<Voice kind="qloo" />}
      />
      <div className="pool__tabs" role="tablist" aria-label="Slot">
        {SLOTS.map((s) => (
          <button
            key={s}
            ref={(el) => {
              tabs.current[s] = el;
            }}
            type="button"
            role="tab"
            id={`pool-tab-${s}`}
            aria-selected={s === slot}
            aria-controls="pool-panel"
            tabIndex={s === slot ? 0 : -1}
            className={cx('pool__tab', s === slot && 'is-on')}
            onClick={() => setSlot(s)}
            onKeyDown={onKey}
          >
            <Icon name={SLOT_ICON[s]} size={16} />
            {SLOT_LABEL[s]}
          </button>
        ))}
      </div>
      <div className="pool__panel" role="tabpanel" id="pool-panel" aria-labelledby={`pool-tab-${slot}`}>
        {flat.map((side) => (
          <Notice key={side} tone="info" className="pool__flat">
            Qloo sees no strong pull for {names[side]} in {SLOT_LABEL[slot].toLowerCase()}, so every option scores 50 for{' '}
            {names[side]}. An easy trade.
          </Notice>
        ))}
        <ul className="pool__list">
          {items.map((item) => (
            <Row key={item.id} item={item} mark={markOf(item)} />
          ))}
        </ul>
        {items.length > 3 && (
          <button type="button" className="pool__more" onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>
            <Icon name="chevron-down" size={16} className={cx('pool__more-icon', expanded && 'is-open')} />
            {expanded ? 'Show fewer' : `Show all ${items.length}`}
          </button>
        )}
        <p className="pool__legend small muted">
          Scores are Qloo&rsquo;s fit for each of you, 0 to 100. A bridge came from both tastes at once.
        </p>
      </div>
    </section>
  );
}
