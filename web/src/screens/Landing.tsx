/*
 * Landing (/).
 *
 * Inventory, by priority:
 *   primary   — Couple demo: one tap to a finished truce, an instant replay of a recorded run
 *               (POST /api/demo {kind, replay: true})
 *   secondary — Friends demo (three people), Start your own (→ /new)
 *   rare      — run a demo live instead (about a minute): one quiet line under the buttons
 *   info      — what Truce does, in plain words; a real message from a truce; three steps
 *
 * Viewport budget: at 1440×900 the headline, the buttons, the live line and the sample message sit
 * above the fold, with the steps; the page fits the window. At 390×844 the headline and all three
 * buttons fit.
 * Grid: the full window with a modest gutter, 12 columns — copy in 1–6 (its
 * measure capped), the sample message floating at the right edge of 7–12.
 * Phone: one column.
 * Surface: the faceted photo behind everything. The steps are frosted glass
 * (a live blur on wider screens, nearly solid on a phone); the floating
 * sample's bubble is fake glass, a pre-blurred copy of the photo (ui/Frost),
 * so its float costs no blur per frame.
 * Icons: heart / users (the two demos), plus (start), users / exchange / check (the three steps).
 */
import { Button, ButtonLink, ErrorNotice, Frost, Icon, Page, type IconName } from '@/ui';
import { useDemo } from '@/lib/demo';
import { TruceContext } from '@/truce/context';
import { MoveCard } from '@/truce/Moves';
import { specimenCtx, specimenMove } from '@/truce/specimen';

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'users', title: 'Each of you picks a few favourites', text: 'Films, restaurants and music you love, and a word for your agent about tonight. A minute each.' },
  { icon: 'exchange', title: 'Your agents scout and negotiate', text: 'One AI agent per person, using Qloo’s taste data. A referee keeps it fair.' },
  { icon: 'check-circle', title: 'You get one plan', text: 'A film, a restaurant and music for everyone, with links to book. Next time, whoever gave more ground gets more say.' },
];

export function Landing() {
  const demo = useDemo();

  return (
    <Page title={null} className="landing" wide backdrop>
      <section className="landing__hero grid" aria-labelledby="hero-title">
        <div className="landing__copy">
          <h1 id="hero-title" className="h1">
            Plan tonight together
          </h1>
          <p className="lede landing__lede">
            AI agents find an evening you&rsquo;ll all enjoy: a film, a restaurant and music. Each agent speaks for one person and
            negotiates until everyone says yes. For a couple or up to four friends.
          </p>
          <div className="landing__actions">
            <Button variant="primary" icon="heart" busy={demo.busyFor('couple', true)} disabled={demo.busy} onClick={() => void demo.run('couple', true)}>
              Couple demo
            </Button>
            <Button variant="secondary" icon="users" busy={demo.busyFor('friends', true)} disabled={demo.busy} onClick={() => void demo.run('friends', true)}>
              Friends demo
            </Button>
            <ButtonLink variant="ghost" icon="plus" href="/new">
              Start your own
            </ButtonLink>
          </div>
          <div className="landing__note">
            <p className="small muted">Maya and Deniz in Manhattan, or three friends in Istanbul, recorded so they open at once.</p>
            <p className="landing__live small muted">
              <span>Run it live (about a minute):</span>
              <span className="landing__live-buttons">
                <Button size="sm" variant="ghost" icon="heart" busy={demo.busyFor('couple', false)} disabled={demo.busy} aria-label="Run the couple demo live" onClick={() => void demo.run('couple', false)}>
                  Couple
                </Button>
                <Button size="sm" variant="ghost" icon="users" busy={demo.busyFor('friends', false)} disabled={demo.busy} aria-label="Run the friends demo live" onClick={() => void demo.run('friends', false)}>
                  Friends
                </Button>
              </span>
            </p>
          </div>
          {demo.error && <ErrorNotice error={demo.error} title="The demo didn't start" />}
        </div>

        <figure className="landing__sample float" aria-label="An example message from a truce">
          <Frost />
          <TruceContext.Provider value={specimenCtx}>
            <MoveCard move={specimenMove} live={false} />
          </TruceContext.Provider>
        </figure>
      </section>

      <section className="landing__how" aria-labelledby="how-title">
        <h2 id="how-title" className="h3">
          How it works
        </h2>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="card glass step">
              <span className="step__icon" aria-hidden="true">
                <Icon name={s.icon} size={20} />
              </span>
              <h3 className="step__title">
                <span className="visually-hidden">Step {i + 1}: </span>
                {s.title}
              </h3>
              <p className="small muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </Page>
  );
}
