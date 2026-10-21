import type { CardItem, Side, Slot } from '@contract';
import { memo, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Badge, cx, Icon, InfoTip, Notice, ScoreMeter, SectionHeader, Skeleton, Thumb, Voice } from '@/ui';
import { EXPLAIN } from '@/lib/glossary';
import { possessive, SIDES } from '@/lib/people';
import { isBridge, SLOT_ICON, SLOT_LABEL, SLOTS, type Bundle } from '@/lib/truce';
import { Because } from './Because';
import { useTruceCtx } from './context';
import { subLine } from './Evening';

/** The facts worth showing, in this order. */
const FACT_LABEL: Record<string, string> = {
  cuisineType: 'Cuisine',
  price: 'Price',
  ambience: 'Feel',
  dishes: 'Known for',
  genres: 'Genres',
  sound: 'Sound',
  minutes: 'Minutes',
  rating: 'Rated',
  cuisine: 'About',
};

type Mark = 'table' | 'plan' | null;

function Origin({ item }: { item: CardItem }) {
  const { names } = useTruceCtx();
  if (isBridge(item)) {
    return (
      <span className="pool-row__origin">
        <Badge variant="success" icon="bridge">
          Bridge
        </Badge>
        <InfoTip label="What is a bridge?">
          {EXPLAIN.bridge}
        </InfoTip>
      </span>
    );
  }
  const side = item.origins.includes('a') ? 'a' : 'b';
  return <Badge variant="outline">From {possessive(names[side])} taste</Badge>;
}

const Row = memo(function Row({ item, mark }: { item: CardItem; mark: Mark }) {
  const { names } = useTruceCtx();
  const [open, setOpen] = useState(false);
  const moreId = useId();
  const sub = subLine(item);
  const facts = Object.keys(FACT_LABEL).flatMap((k) => (item.facts[k] ? [[k, item.facts[k]] as const] : []));
  return (
    <li className={cx('pool-row', mark && 'is-marked')}>
      <div className="pool-row__top">
        <Thumb name={item.name} imageUrl={item.imageUrl} slot={item.slot} />
        <div className="pool-row__main">
          <p className="pool-row__title">
            <span className="pool-row__name">{item.name}</span>
            {sub && <span className="pool-row__sub">{sub}</span>}
          </p>
          <div className="pool-row__badges">
            <Origin item={item} />
            {mark && (
              <Badge variant="default" icon={mark === 'plan' ? 'check' : 'exchange'}>
                {mark === 'plan' ? 'In the plan' : 'On the table'}
              </Badge>
            )}
          </div>
        </div>
        <button
          type="button"
          className="pool-row__toggle"
          aria-expanded={open}
          aria-controls={moreId}
          aria-label={`${open ? 'Hide' : 'Show'} details for ${item.name}`}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="chevron-down" size={16} className={cx('pool-row__chevron', open && 'is-open')} />
        </button>
      </div>
      <div className="pool-row__meters">
        {SIDES.map((side) => (
          <ScoreMeter key={side} side={side} name={names[side]} value={item.scores[side]} size="sm" />
        ))}
      </div>
      <div id={moreId} className="pool-row__more" hidden={!open}>
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
    </li>
  );
});

export function PoolSkeleton() {
  return (
    <section className="card pool" aria-label="Options, loading">
      <Skeleton w="10rem" h="1.25rem" />
      <div className="pool__tabs-skeleton" aria-hidden="true">
        <Skeleton h="2.25rem" />
      </div>
      <ul className="pool__list" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i} className="pool-row">
            <div className="pool-row__top">
              <Skeleton w="2.5rem" h="2.5rem" delay={i * 90} />
              <div className="pool-row__main">
                <Skeleton w={`${50 + ((i * 17) % 30)}%`} h="0.875rem" delay={i * 90} />
                <Skeleton w="6rem" h="1.25rem" delay={i * 90 + 40} />
              </div>
            </div>
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
  const total = useMemo(() => SLOTS.reduce((t, s) => t + pool[s].length, 0), [pool]);
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
    <section className={cx('card pool', !expanded && 'pool--collapsed')} aria-labelledby="pool-title">
      <SectionHeader
        id="pool-title"
        title="Options from Qloo"
        info={
          <InfoTip label="Where these options come from">
            {EXPLAIN.pool}
          </InfoTip>
        }
        meta={`${total} options the agents can choose from.`}
        actions={<Voice kind="qloo" />}
      />
      <div className="pool__tabs" role="tablist" aria-label="Kind of option">
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
            {names[side]} has no strong preference here, so every {SLOT_LABEL[slot].toLowerCase()} scores 50 for {names[side]}.
          </Notice>
        ))}
        <ul className="pool__list">
          {items.map((item) => (
            <Row key={item.id} item={item} mark={markOf(item)} />
          ))}
        </ul>
        {items.length > 3 && (
          <button type="button" className="btn btn--ghost btn--sm pool__more" onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>
            <Icon name="chevron-down" size={16} className={cx('pool__more-icon', expanded && 'is-open')} />
            {expanded ? 'Show fewer' : `Show all ${items.length}`}
          </button>
        )}
      </div>
    </section>
  );
}
