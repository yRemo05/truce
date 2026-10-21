import type { SearchHit, Seed, Slot } from '@contract';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { api, ApiError } from '@/api';
import { cx, Icon, Skeleton, Spinner, TextField, Thumb } from '@/ui';
import { SLOT_ICON } from '@/lib/truce';
import { useDebounced } from '@/lib/useDebounced';

const MAX_PICKS = 3;

export interface Picked extends Seed {
  imageUrl: string | null;
  disambiguation: string | null;
}

const cache = new Map<string, SearchHit[]>();

type Search =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'done'; hits: SearchHit[] }
  | { state: 'error'; message: string };

const COPY: Record<Slot, { title: string; noun: string; hint: string; examples: string[] }> = {
  film: {
    title: 'Films',
    noun: 'a film',
    hint: 'Films you’d happily watch again.',
    examples: ['Past Lives', 'Heat', 'Paddington 2'],
  },
  restaurant: {
    title: 'Restaurants',
    noun: 'a restaurant',
    hint: 'A restaurant you love counts most for tonight’s table.',
    examples: ['Trattoria', 'Noodle', 'Sushi'],
  },
  music: {
    title: 'Music',
    noun: 'an artist',
    hint: 'Artists or bands you love.',
    examples: ['Nina Simone', 'Daft Punk', 'Mitski'],
  },
};

interface SeedPickerProps {
  slot: Slot;
  picks: Picked[];
  onAdd: (pick: Picked) => void;
  onRemove: (id: string) => void;
}

/** Search Qloo for one slot, confirm a match, keep it as a pick. A combobox with a listbox of real entities. */
export function SeedPicker({ slot, picks, onAdd, onRemove }: SeedPickerProps) {
  const copy = COPY[slot];
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
    const key = `${slot}:${settled.toLocaleLowerCase()}`;
    const hit = cache.get(key);
    if (hit) {
      setSearch({ state: 'done', hits: hit });
      setActive(0);
      return;
    }
    const controller = new AbortController();
    setSearch({ state: 'loading' });
    api
      .search(slot, settled, controller.signal)
      .then((hits) => {
        cache.set(key, hits);
        setSearch({ state: 'done', hits });
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
  }, [settled, slot]);

  const typing = query.trim().length >= 2 && query.trim() !== settled;
  const hits = search.state === 'done' ? search.hits : [];
  const showList = open && query.trim().length >= 2;
  const pickedIds = new Set(picks.map((p) => p.id));

  const choose = (hit: SearchHit) => {
    if (pickedIds.has(hit.id) || full) return;
    onAdd({ id: hit.id, name: hit.name, imageUrl: hit.imageUrl, disambiguation: hit.disambiguation });
    setSaid(`Added ${hit.name}.`);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && hits.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === 'ArrowUp' && hits.length) {
      e.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter') {
      if (showList && hits[active]) {
        e.preventDefault();
        choose(hits[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) setOpen(false);
      else setQuery('');
    }
  };

  return (
    <section className="card picker" aria-labelledby={headingId}>
      <header className="picker__head">
        <h2 id={headingId} className="picker__title">
          <Icon name={SLOT_ICON[slot]} size={20} />
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
          aria-activedescendant={showList && hits[active] ? `${listId}-${active}` : undefined}
          placeholder={full ? 'That’s three, the most you can add' : `Search for ${copy.noun}`}
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
            {hits.map((hit, i) => {
              const picked = pickedIds.has(hit.id);
              return (
                <li
                  key={hit.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  aria-disabled={picked || undefined}
                  className={cx('combo__option', i === active && 'is-active', picked && 'is-picked')}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(hit)}
                >
                  <Thumb name={hit.name} imageUrl={hit.imageUrl} slot={slot} />
                  <span className="combo__text">
                    <span className="combo__name">{hit.name}</span>
                    {hit.disambiguation && <span className="combo__dis small muted">{hit.disambiguation}</span>}
                  </span>
                  {picked ? <Icon name="check" size={16} label="Already picked" /> : <Icon name="plus" size={16} className="combo__add" />}
                </li>
              );
            })}
          </ul>
          {search.state === 'loading' && hits.length === 0 && (
            <div className="combo__status" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span key={i} className="combo__skel">
                  <Skeleton w="2.5rem" h="2.5rem" delay={i * 90} />
                  <Skeleton w={`${60 - i * 12}%`} h="0.875rem" delay={i * 90} />
                </span>
              ))}
            </div>
          )}
          {search.state === 'done' && hits.length === 0 && !typing && (
            <p className="combo__empty small">
              <Icon name="info" size={16} />
              No match for &ldquo;{settled}&rdquo;. Try the original title, or fewer words.
            </p>
          )}
          {search.state === 'error' && (
            <p className="combo__empty combo__empty--error small">
              <Icon name="warning" size={16} />
              {search.message}
            </p>
          )}
          {search.state === 'done' && hits.length > 0 && <p className="combo__credit">Results from Qloo</p>}
        </div>
      </div>

      {picks.length > 0 ? (
        <ul className="picks" aria-label={`Your ${copy.title.toLowerCase()}`}>
          {picks.map((p) => (
            <li key={p.id} className="pick enter">
              <Thumb name={p.name} imageUrl={p.imageUrl} slot={slot} />
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
