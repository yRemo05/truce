/*
 * Start a truce (/new) — step 1 of 3.
 *
 * Inventory: who it's for (mode), two names, where to eat; Continue (primary).
 * Viewport budget: the whole form and Continue sit above the fold at 1440×900
 * and at 390×844. Grid: form in columns 1–7, the three steps ahead in 9–12;
 * on a phone the steps shrink to one line above the title.
 * Names sit side by side at every width: they are one decision.
 * Icons: heart / users (mode), pin (place), arrow-right (continue), check (done step).
 */
import type { Mode } from '@contract';
import { useState, type FormEvent } from 'react';
import { useLocation } from 'wouter';
import { api } from '@/api';
import { Button, ErrorNotice, Page, Segmented, TextField } from '@/ui';
import { useAction } from '@/lib/useAction';
import { Steps } from './Steps';

const PLACES = ['Manhattan', 'Brooklyn', 'Istanbul', 'London', 'Paris'];
const MAX_NAME = 24;

export function NewPair() {
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<Mode>('couple');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [location, setLocation] = useState('Manhattan');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const create = useAction(async () => {
    const { id } = await api.createPair({ mode, names: { a: clean(a), b: clean(b) }, location: clean(location) });
    navigate(`/p/${id}/play`);
  });

  const clean = (s: string) => s.trim().replace(/\s+/g, ' ');
  const errors = {
    a: !clean(a) ? 'Add your name for the agents.' : null,
    b: !clean(b)
      ? 'Add their name.'
      : clean(a).toLocaleLowerCase() === clean(b).toLocaleLowerCase()
        ? `Two ${clean(b)}s? Add an initial so the agents can tell you apart.`
        : null,
    location: clean(location).length < 2 ? 'Name a city or neighbourhood, like Manhattan or Istanbul.' : null,
  };
  const show = (k: keyof typeof errors) => (touched[k] || submitted ? errors[k] : null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitted(true);
    const invalid = (['a', 'b', 'location'] as const).find((k) => errors[k]);
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
            <p className="muted">Tell us who it's for and where you'll eat. Next, each of you picks a few favourites.</p>
          </header>

          <Segmented
            legend="Who is it for?"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'couple', label: 'Couple', icon: 'heart' },
              { value: 'bff', label: 'Best friends', icon: 'users' },
            ]}
          />

          <div className="setup__pair">
            <TextField
              label="Your name"
              name="a"
              value={a}
              maxLength={MAX_NAME}
              autoComplete="given-name"
              onChange={(e) => setA(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, a: true }))}
              error={show('a')}
            />
            <TextField
              label="Their name"
              name="b"
              value={b}
              maxLength={MAX_NAME}
              autoComplete="off"
              onChange={(e) => setB(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, b: true }))}
              error={show('b')}
            />
          </div>

          <div className="setup__place">
            <TextField
              label="Where will you eat?"
              name="location"
              icon="pin"
              value={location}
              maxLength={60}
              autoComplete="address-level2"
              onChange={(e) => setLocation(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, location: true }))}
              error={show('location')}
              hint="A city or neighbourhood. Qloo looks for restaurants there."
            />
            <div className="examples" role="group" aria-label="Suggestions">
              {PLACES.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={p === clean(location) ? 'btn btn--sm btn--secondary is-on' : 'btn btn--sm btn--outline'}
                  aria-pressed={p === clean(location)}
                  onClick={() => setLocation(p)}
                >
                  {p}
                </button>
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
