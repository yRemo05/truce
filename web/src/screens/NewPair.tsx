/*
 * Start a truce (/new) — step 1 of 3.
 *
 * Inventory: who it's for (couple or friends), two to four names, where to eat;
 * Add a friend (secondary, friends only); Continue (primary).
 * Viewport budget: the whole form and Continue sit above the fold at 1440×900
 * with four friends, and at 390×844 with two.
 * Names sit two to a row at every width: they are one decision. A friend's
 * remove button lives inside their field, so rows keep one height.
 * Icons: heart / users (mode), plus (add a friend), x (remove), pin (place),
 * arrow-right (continue).
 */
import type { Mode } from '@contract';
import { useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'wouter';
import { api } from '@/api';
import { Button, Chip, ErrorNotice, Icon, Page, Segmented, TextField } from '@/ui';
import { MAX_PEOPLE, MIN_PEOPLE } from '@/lib/people';
import { useAction } from '@/lib/useAction';
import { Steps } from './Steps';

const PLACES = ['Manhattan', 'Brooklyn', 'Istanbul', 'London', 'Paris'];
const MAX_NAME = 24;

const clean = (s: string) => s.trim().replace(/\s+/g, ' ');

/** "Your name", then "Their name" for a couple or "Friend 1…3" for a group. */
const labelOf = (mode: Mode, i: number) => (i === 0 ? 'Your name' : mode === 'couple' ? 'Their name' : `Friend ${i}`);

export function NewPair() {
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<Mode>('couple');
  // A couple shows the first two; switching back to friends brings the rest back.
  const [names, setNames] = useState<string[]>(['', '']);
  const [location, setLocation] = useState('Manhattan');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const fields = useRef<(HTMLInputElement | null)[]>([]);
  const addButton = useRef<HTMLButtonElement>(null);

  const shown = mode === 'couple' ? names.slice(0, MIN_PEOPLE) : names;
  const create = useAction(async () => {
    const { id } = await api.createPair({ mode, names: shown.map(clean), location: clean(location) });
    navigate(`/p/${id}/play`);
  });

  const nameError = (i: number): string | null => {
    const name = clean(shown[i] ?? '');
    if (!name) return i === 0 ? 'Add your name for the agents.' : i >= MIN_PEOPLE ? 'Add a name, or remove this friend.' : 'Add their name.';
    const twin = shown.findIndex((other, j) => j < i && clean(other).toLocaleLowerCase() === name.toLocaleLowerCase());
    return twin >= 0 ? `Two ${name}s? Add an initial so the agents can tell you apart.` : null;
  };
  const errors: Record<string, string | null> = {
    ...Object.fromEntries(shown.map((_, i) => [`name-${i}`, nameError(i)])),
    location: clean(location).length < 2 ? 'Name a city or neighbourhood, like Manhattan or Istanbul.' : null,
  };
  const show = (k: string) => (touched[k] || submitted ? errors[k] : null);
  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));

  const setName = (i: number, value: string) => setNames((list) => list.map((n, j) => (j === i ? value : n)));
  const addFriend = () => {
    setNames((list) => [...list, '']);
    requestAnimationFrame(() => fields.current[names.length]?.focus());
  };
  const removeFriend = (i: number) => {
    setNames((list) => list.filter((_, j) => j !== i));
    setTouched((t) => Object.fromEntries(Object.entries(t).filter(([k]) => !k.startsWith('name-'))));
    requestAnimationFrame(() => (addButton.current ?? fields.current[i - 1])?.focus());
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitted(true);
    const invalid = Object.keys(errors).find((k) => errors[k]);
    if (invalid) {
      (e.currentTarget.elements.namedItem(invalid) as HTMLInputElement | null)?.focus();
      return;
    }
    await create.run();
  };

  return (
    <Page title="Start a truce" className="setup">
      <div className="setup__inner">
        <form className="card setup__card" onSubmit={submit} noValidate>
          <Steps current={1} />
          <header className="setup__head">
            <h1 className="h2">Start a truce</h1>
            <p className="muted">Tell us who&rsquo;s coming and where you&rsquo;ll eat. Next, each of you picks a few favourites.</p>
          </header>

          <Segmented
            legend="Who is it for?"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'couple', label: 'Couple', icon: 'heart' },
              { value: 'bff', label: 'Friends', icon: 'users' },
            ]}
          />

          <fieldset className="setup__people">
            <legend className="visually-hidden">{mode === 'couple' ? 'The two of you' : 'Who’s coming'}</legend>
            <div className="setup__pair">
              {shown.map((name, i) => {
                const label = labelOf(mode, i);
                const removable = mode !== 'couple' && i >= MIN_PEOPLE;
                return (
                  <TextField
                    key={i}
                    ref={(el) => {
                      fields.current[i] = el;
                    }}
                    label={label}
                    name={`name-${i}`}
                    value={name}
                    maxLength={MAX_NAME}
                    autoComplete={i === 0 ? 'given-name' : 'off'}
                    onChange={(e) => setName(i, e.target.value)}
                    onBlur={() => touch(`name-${i}`)}
                    error={show(`name-${i}`)}
                    trailing={
                      removable ? (
                        <button type="button" className="field__clear" aria-label={`Remove ${clean(name) || label}`} onClick={() => removeFriend(i)}>
                          <Icon name="x" size={16} />
                        </button>
                      ) : undefined
                    }
                  />
                );
              })}
            </div>
            {mode !== 'couple' && names.length < MAX_PEOPLE && (
              <Button ref={addButton} type="button" variant="outline" size="sm" icon="plus" className="setup__add" onClick={addFriend}>
                Add a friend
              </Button>
            )}
          </fieldset>

          <div className="setup__place">
            <TextField
              label="Where will you eat?"
              name="location"
              icon="pin"
              value={location}
              maxLength={60}
              autoComplete="address-level2"
              onChange={(e) => setLocation(e.target.value)}
              onBlur={() => touch('location')}
              error={show('location')}
              hint="A city or neighbourhood. Qloo looks for restaurants there."
            />
            <div className="examples" role="group" aria-label="Suggestions">
              {PLACES.map((p) => (
                <Chip key={p} pressed={p === clean(location)} onClick={() => setLocation(p)}>
                  {p}
                </Chip>
              ))}
            </div>
          </div>

          {create.error && <ErrorNotice error={create.error} title="Couldn't set up the truce" />}

          <div className="setup__submit">
            <Button type="submit" variant="primary" iconEnd="arrow-right" busy={create.busy}>
              Continue
            </Button>
          </div>
        </form>
      </div>
    </Page>
  );
}
