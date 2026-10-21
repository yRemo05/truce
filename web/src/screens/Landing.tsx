/*
 * Landing (/).
 *
 * Inventory, by priority:
 *   primary   — Try the demo: one tap to a live negotiation (POST /api/demo)
 *   secondary — Start your own (→ /new)
 *   info      — what Truce does, in plain words; a real message from a truce; three steps
 *
 * Viewport budget: at 1440×900 the headline, the two buttons and the sample
 * message sit above the fold; the steps follow. At 390×844 the headline and
 * both buttons fit.
 * Grid: 12 columns — copy in 1–6, the sample message in 7–12. Phone: one column.
 * Icons: play (demo), plus (start), users / chat / check (the three steps).
 */
import { useLocation } from 'wouter';
import { api } from '@/api';
import { Button, ButtonLink, ErrorNotice, Icon, Page, type IconName } from '@/ui';
import { useAction } from '@/lib/useAction';
import { TruceContext } from '@/truce/context';
import { MoveCard } from '@/truce/Moves';
import { specimenCtx, specimenMove } from '@/truce/specimen';

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'users', title: 'Each of you picks a few favourites', text: 'Films, restaurants and music you love. It takes a minute each.' },
  { icon: 'exchange', title: 'Two AI agents negotiate', text: 'Each agent speaks for one of you, using Qloo’s taste data. A referee keeps it fair.' },
  { icon: 'check-circle', title: 'You get one plan', text: 'A film, a restaurant and music you’ll both enjoy. Next time, whoever gave more ground gets more say.' },
];

export function Landing() {
  const [, navigate] = useLocation();
  const demo = useAction(async () => {
    const { truceId } = await api.demo();
    navigate(`/t/${truceId}`);
  });

  return (
    <Page title={null} className="landing">
      <section className="landing__hero grid" aria-labelledby="hero-title">
        <div className="landing__copy">
          <h1 id="hero-title" className="h1">
            Plan tonight together
          </h1>
          <p className="lede landing__lede">
            Two AI agents find an evening you&rsquo;ll both enjoy: a film, a restaurant and music. Each agent speaks for one of
            you and negotiates until you both say yes.
          </p>
          <div className="landing__actions">
            <Button variant="primary" icon="play" busy={demo.busy} onClick={() => void demo.run()}>
              Try the demo
            </Button>
            <ButtonLink variant="outline" icon="plus" href="/new">
              Start your own
            </ButtonLink>
          </div>
          <p className="small muted">The demo plays out a truce between Maya and Deniz. It takes about half a minute.</p>
          {demo.error && <ErrorNotice error={demo.error} title="The demo didn't start" />}
        </div>

        <div className="landing__sample" aria-label="An example message from a truce">
          <TruceContext.Provider value={specimenCtx}>
            <MoveCard move={specimenMove} live={false} />
          </TruceContext.Provider>
        </div>
      </section>

      <section className="landing__how" aria-labelledby="how-title">
        <h2 id="how-title" className="h3">
          How it works
        </h2>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="card step">
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
