import type { Food, SearchHit, SearchResult, Seed, Slot } from '@contract';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { api, ApiError } from '@/api';
import { cx, Icon, Skeleton, Spinner, TextField, Thumb } from '@/ui';
import { SLOT_ICON } from '@/lib/truce';
import { useDebounced } from '@/lib/useDebounced';

const MAX_PICKS = 3;

/** One pick: a Qloo entity (a film, an artist, a place), or, for restaurants, a food. */
export interface Picked extends Seed {
  imageUrl: string | null;
  disambiguation: string | null;
  /** Set when the pick is a dish or a cuisine rather than a place. */
  food?: Food;
}

const FOOD_KIND: Record<Food['kind'], string> = { dish: 'Dish', cuisine: 'Cuisine' };

/** A food's pick id: its name, so the same dish can't be added twice. */
const foodId = (food: Food) => `food:${food.name.toLocaleLowerCase()}`;

const cache = new Map<string, SearchResult>();

type Search =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'done'; hits: SearchHit[]; foods: Food[]; near: string | null }
  | { state: 'error'; message: string };

/** What the list offers, foods first: one index runs over both groups, for the arrow keys. */
type Option = { id: string; food: Food; hit?: undefined } | { id: string; hit: SearchHit; food?: undefined };

interface Copy {
  title: string;
  noun: string;
  prompt: string;
  hint: string;
  examples: string[];
}

const COPY: Record<Slot, Copy> = {
  film: {
    title: 'Films',
    noun: 'a film',
    prompt: 'Search for a film',
    hint: 'Films you’d happily watch again.',
    examples: ['Past Lives', 'Heat', 'Paddington 2'],
  },
  restaurant: {
    title: 'Restaurants',
    noun: 'a place or a food',
    prompt: 'A place or food',
    hint: 'A place or a food you love. A place counts most for tonight’s table.',
    examples: ['Trattoria', 'Lasagna', 'Sushi'],
  },
  music: {
    title: 'Music',
    noun: 'an artist',
    prompt: 'Search for an artist',
    hint: 'Artists or bands you love.',
    examples: ['Nina Simone', 'Daft Punk', 'Mitski'],
  },
};

/** A restaurant search that offers foods alone: tonight's cravings, with the favourite places already saved. */
const FOODS_COPY: Copy = {
  title: 'Foods',
  noun: 'a food',
  prompt: 'A dish or a cuisine',
  hint: 'A dish or a cuisine you’re in the mood for. Optional.',
  examples: ['Lasagna', 'Sushi', 'Ramen'],
};

interface SeedPickerProps {
  slot: Slot;
  picks: Picked[];
  onAdd: (pick: Picked) => void;
  onRemove: (id: string) => void;
  /** Restaurants only: the pair's city, so the search keeps to places there. */
  near?: string | null;
  /** Restaurants only: offer the foods a search names and leave its places out. */
  foodsOnly?: boolean;
}

/** Search Qloo for one slot, confirm a match, keep it as a pick. A combobox with a listbox of real entities (and, for restaurants, foods). */
export function SeedPicker({ slot, picks, onAdd, onRemove, near = null, foodsOnly = false }: SeedPickerProps) {
  const copy = foodsOnly ? FOODS_COPY : COPY[slot];
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [search, setSearch] = useState<Search>({ state: 'idle' });
  const [said, setSaid] = useState('');
  const settled = useDebounced(query.trim(), 280);
  const full = picks.length >= MAX_PICKS;
  const listId = `${uid}-list`;
  const headingId = `${uid}-title`;

  useEffect(() => {
    if (settled.length < 2) {
      setSearch({ state: 'idle' });
      return;
    }
    const key = `${slot}:${near ?? ''}:${settled.toLocaleLowerCase()}`;
    const hit = cache.get(key);
    if (hit) {
      setSearch({ state: 'done', ...hit });
      setActive(0);
      return;
    }
    const controller = new AbortController();
    setSearch({ state: 'loading' });
    api
      .search(slot, settled, near, controller.signal)
      .then((result) => {
        cache.set(key, result);
        setSearch({ state: 'done', ...result });
        setActive(0);
      })
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError') return;
        const e = ApiError.from(err);
        setSearch({
          state: 'error',
          message: e.code === 'rate_limited' ? 'Searching a little fast. Give it a second and keep typing.' : e.message,
        });
      });
    return () => controller.abort();
  }, [settled, slot, near]);

  const typing = query.trim().length >= 2 && query.trim() !== settled;
  const hits = search.state === 'done' && !foodsOnly ? search.hits : [];
  const foods = search.state === 'done' ? (search.foods ?? []) : [];
  const options: Option[] = [...foods.map((food) => ({ id: foodId(food), food })), ...hits.map((hit) => ({ id: hit.id, hit }))];
  const showList = open && query.trim().length >= 2;
  const pickedIds = new Set(picks.map((p) => p.id));

  const choose = (option: Option) => {
    if (pickedIds.has(option.id) || full) return;
    if (option.food) onAdd({ id: option.id, name: option.food.name, imageUrl: null, disambiguation: FOOD_KIND[option.food.kind], food: option.food });
    else onAdd({ id: option.hit.id, name: option.hit.name, imageUrl: option.hit.imageUrl, disambiguation: option.hit.disambiguation });
    setSaid(`Added ${option.food?.name ?? option.hit?.name}.`);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && options.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp' && options.length) {
      e.preventDefault();
      setActive((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === 'Enter') {
      if (showList && options[active]) {
        e.preventDefault();
        choose(options[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) setOpen(false);
      else setQuery('');
    }
  };

  const renderOption = (option: Option, i: number) => {
    const picked = pickedIds.has(option.id);
    return (
      <li
        key={option.id}
        id={`${listId}-${i}`}
        role="option"
        aria-selected={i === active}
        aria-disabled={picked || undefined}
        className={cx('combo__option', i === active && 'is-active', picked && 'is-picked')}
        onMouseDown={(e) => e.preventDefault()}
        onMouseEnter={() => setActive(i)}
        onClick={() => choose(option)}
      >
        {option.food ? (
          <>
            <Thumb name={option.food.name} imageUrl={null} slot={slot} glyph="food" />
            <span className="combo__text">
              <span className="combo__name">{option.food.name}</span>
              <span className="combo__dis small muted">{FOOD_KIND[option.food.kind]}</span>
            </span>
          </>
        ) : (
          <>
            <Thumb name={option.hit.name} imageUrl={option.hit.imageUrl} slot={slot} />
            <span className="combo__text">
              <span className="combo__name">{option.hit.name}</span>
              {option.hit.disambiguation && <span className="combo__dis small muted">{option.hit.disambiguation}</span>}
            </span>
          </>
        )}
        {picked ? <Icon name="check" size={16} label="Already picked" /> : <Icon name="plus" size={16} className="combo__add" />}
      </li>
    );
  };

  // Foods and places are grouped only when both can show; otherwise the list reads as before.
  const grouped = foods.length > 0 && !foodsOnly;
  const groupId = (name: string) => `${listId}-${name}`;

  return (
    <section className="card picker" aria-labelledby={headingId}>
      <header className="picker__head">
        <h2 id={headingId} className="picker__title">
          <Icon name={foodsOnly ? 'food' : SLOT_ICON[slot]} size={20} />
          {copy.title}
        </h2>
        <span className={cx('picker__count', picks.length > 0 && 'is-some')}>
          {picks.length} of {MAX_PICKS}
        </span>
      </header>
      <p className="picker__hint small muted">{copy.hint}</p>

      <div className="combo">
        <TextField
          ref={inputRef}
          label={`Search for ${copy.noun}`}
          hideLabel
          icon="search"
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && options[active] ? `${listId}-${active}` : undefined}
          placeholder={full ? 'That’s three, the most you can add' : `${copy.prompt}${near ? ` in ${near}` : ''}`}
          disabled={full}
          value={query}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKey}
          trailing={
            typing || search.state === 'loading' ? (
              <Spinner size={16} />
            ) : (
              query && (
                <button
                  type="button"
                  className="combo__clear"
                  aria-label="Clear search"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setQuery('');
                    inputRef.current?.focus();
                  }}
                >
                  <Icon name="x" size={16} />
                </button>
              )
            )
          }
        />

        <div className={cx('combo__pop', showList && 'is-open')} hidden={!showList}>
          <ul id={listId} role="listbox" aria-label={`${copy.title} from Qloo`} className="combo__list">
            {grouped ? (
              <>
                <li role="group" aria-labelledby={groupId('foods')} className="combo__group">
                  <span id={groupId('foods')} className="combo__group-label">
                    Foods
                  </span>
                  <ul role="none" className="combo__list">
                    {options.slice(0, foods.length).map((o, i) => renderOption(o, i))}
                  </ul>
                </li>
                {hits.length > 0 && (
                  <li role="group" aria-labelledby={groupId('places')} className="combo__group">
                    <span id={groupId('places')} className="combo__group-label">
                      Places
                    </span>
                    <ul role="none" className="combo__list">
                      {options.slice(foods.length).map((o, i) => renderOption(o, foods.length + i))}
                    </ul>
                  </li>
                )}
              </>
            ) : (
              options.map(renderOption)
            )}
          </ul>
          {search.state === 'loading' && options.length === 0 && (
            <div className="combo__status" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span key={i} className="combo__skel">
                  <Skeleton w="2.5rem" h="2.5rem" delay={i * 90} />
                  <Skeleton w={`${60 - i * 12}%`} h="0.875rem" delay={i * 90} />
                </span>
              ))}
            </div>
          )}
          {search.state === 'done' && options.length === 0 && !typing && (
            <p className="combo__empty small">
              <Icon name="info" size={16} />
              {foodsOnly
                ? `No food matches “${settled}”. Try a dish or a cuisine, like ramen or Italian.`
                : search.near
                  ? `No match for “${settled}” near ${search.near}. Try fewer words.`
                  : `No match for “${settled}”. Try the original title, or fewer words.`}
            </p>
          )}
          {search.state === 'error' && (
            <p className="combo__empty combo__empty--error small">
              <Icon name="warning" size={16} />
              {search.message}
            </p>
          )}
          {search.state === 'done' && options.length > 0 && (
            <p className="combo__credit">
              {search.near && hits.length > 0
                ? `Near ${search.near}, from Qloo`
                : near && hits.length > 0
                  ? `Qloo doesn’t know “${near}”, so these are from anywhere`
                  : 'Results from Qloo'}
            </p>
          )}
        </div>
      </div>

      {picks.length > 0 ? (
        <ul className="picks" aria-label={`Your ${copy.title.toLowerCase()}`}>
          {picks.map((p) => (
            <li key={p.id} className="pick enter">
              <Thumb name={p.name} imageUrl={p.imageUrl} slot={slot} glyph={p.food ? 'food' : undefined} />
              <span className="pick__text">
                <span className="pick__name">{p.name}</span>
                {p.disambiguation && <span className="pick__dis small muted">{p.disambiguation}</span>}
              </span>
              <button type="button" className="pick__remove" aria-label={`Remove ${p.name}`} onClick={() => onRemove(p.id)}>
                <Icon name="x" size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="picks__empty small muted">
          Nothing yet. Try{' '}
          {copy.examples.map((ex, i) => (
            <span key={ex}>
              <button
                type="button"
                className="picks__example"
                onClick={() => {
                  setQuery(ex);
                  setOpen(true);
                  inputRef.current?.focus();
                }}
              >
                {ex}
              </button>
              {i < copy.examples.length - 2 ? ', ' : i === copy.examples.length - 2 ? ' or ' : '.'}
            </span>
          ))}
        </p>
      )}
      <span className="visually-hidden" role="status">
        {said}
      </span>
    </section>
  );
}
