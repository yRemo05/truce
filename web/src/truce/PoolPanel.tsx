import type { CardItem, PerSide, Side, Slot } from '@contract';
import { memo, useId, useMemo, useState } from 'react';
import { Badge, cx, Icon, InfoTip, Notice, ScoreMeter, SectionHeader, Skeleton, Tabs, Thumb, Voice } from '@/ui';
import { EXPLAIN } from '@/lib/glossary';
import { agentOf, nameOf, possessive } from '@/lib/people';
import { isBridge, SLOT_ICON, SLOT_LABEL, SLOTS, type Bundle } from '@/lib/truce';
import { Because } from './Because';
import { useTruceCtx } from './context';
import { Hours } from './Hours';
import { Serves } from './Serves';

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

/** A row's second line: where a restaurant is (the neighbourhood, else the address), or a film's or artist's hint. */
const subLine = (item: CardItem): string | null =>
  item.slot === 'restaurant' ? (item.facts.neighborhood ?? item.disambiguation ?? null) : (item.disambiguation ?? item.facts.genres ?? null);

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
  const side = item.origins.find((o): o is Side => o !== 'joint' && o !== 'scout');
  return side ? <Badge variant="outline">From {possessive(nameOf(names, side))} taste</Badge> : null;
}

/** "Scouted by Ömer's agent", for items an agent brought to the table. */
function Scouted({ item }: { item: CardItem }) {
  const { names } = useTruceCtx();
  if (!item.scout) return null;
  return (
    <span className="pool-row__origin">
      <Badge variant="secondary" icon="search">
        Scouted by {agentOf(nameOf(names, item.scout.side))}
      </Badge>
      <InfoTip label="What scouting is">{EXPLAIN.scout}</InfoTip>
    </span>
  );
}

const Row = memo(function Row({ item, mark }: { item: CardItem; mark: Mark }) {
  const { names, members } = useTruceCtx();
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
            <Scouted item={item} />
            {mark && (
              <Badge variant="default" icon={mark === 'plan' ? 'check' : 'exchange'}>
                {mark === 'plan' ? 'In the plan' : 'On the table'}
              </Badge>
            )}
          </div>
          <Serves item={item} />
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
      <div className="pool-row__meters" style={{ ['--n' as string]: members.length }}>
        {members.map((side) => (
          <ScoreMeter key={side} side={side} name={nameOf(names, side)} value={item.scores[side] ?? 0} size="stack" />
        ))}
      </div>
      <div id={moreId} className="pool-row__more" hidden={!open}>
        {item.scout && (
          <p className="small">
            <span className="because__who">Why {agentOf(nameOf(names, item.scout.side))} added it:</span>{' '}
            <span className="muted">{item.scout.why}</span>
          </p>
        )}
        {item.blurb && <p className="small">{item.blurb}</p>}
        <Hours hours={item.hours} />
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
        {members.map((side) => (
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
  indifferent: PerSide<Record<Slot, boolean>> | null;
  /** The evening on the table now, and the final one once there is one. */
  table: Bundle | null;
  final: Bundle | null;
}

export function PoolPanel({ pool, indifferent, table, final }: PoolPanelProps) {
  const { names, members } = useTruceCtx();
  const [slot, setSlot] = useState<Slot>('film');

  const items = useMemo(() => {
    const sum = (i: CardItem) => members.reduce((t, s) => t + (i.scores[s] ?? 0), 0);
    return [...pool[slot]].sort((x, y) => sum(y) - sum(x));
  }, [pool, slot, members]);
  const total = useMemo(() => SLOTS.reduce((t, s) => t + pool[s].length, 0), [pool]);
  const flat = indifferent ? members.filter((side) => indifferent[side]?.[slot]) : [];

  const markOf = (item: CardItem): Mark => {
    if (final) return final[item.slot] === item.id ? 'plan' : null;
    return table?.[item.slot] === item.id ? 'table' : null;
  };

  return (
    <section className="card pool" aria-labelledby="pool-title">
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
      <Tabs
        label="Kind of option"
        idBase="pool-tab"
        panelId="pool-panel"
        value={slot}
        onChange={setSlot}
        items={SLOTS.map((s) => ({ value: s, label: SLOT_LABEL[s], icon: SLOT_ICON[s], meta: pool[s].length }))}
      />
      <div className="pool__panel" role="tabpanel" id="pool-panel" aria-labelledby={`pool-tab-${slot}`}>
        {flat.map((side) => (
          <Notice key={side} tone="info" className="pool__flat">
            {nameOf(names, side)} has no strong preference here, so every {SLOT_LABEL[slot].toLowerCase()} scores 50 for {nameOf(names, side)}.
          </Notice>
        ))}
        <ul className="pool__list">
          {items.map((item) => (
            <Row key={item.id} item={item} mark={markOf(item)} />
          ))}
        </ul>
      </div>
    </section>
  );
}
