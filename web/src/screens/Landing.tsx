/*
 * Landing (/).
 *
 * Inventory, by priority:
 *   primary   — Couple demo: one tap to a live negotiation (POST /api/demo {kind})
 *   secondary — Friends demo (three people), Start your own (→ /new)
 *   info      — what Truce does, in plain words; a real message from a truce; three steps
 *
 * Viewport budget: at 1440×900 the headline, the two buttons and the sample
 * message sit above the fold; the steps follow. At 390×844 the headline and
 * all three buttons fit.
 * Grid: 12 columns — copy in 1–6, the sample message in 7–12. Phone: one column.
 * Icons: heart / users (the two demos), plus (start), users / exchange / check (the three steps).
 */
import type { DemoInput } from '@contract';
import { useState } from 'react';
import { useLocation } from 'wouter';
import { api } from '@/api';
import { Button, ButtonLink, ErrorNotice, Icon, Page, type IconName } from '@/ui';
import { useAction } from '@/lib/useAction';
import { TruceContext } from '@/truce/context';
import { MoveCard } from '@/truce/Moves';
import { specimenCtx, specimenMove } from '@/truce/specimen';

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'users', title: 'Each of you picks a few favourites', text: 'Films, restaurants and music you love, and a word for your agent about tonight. A minute each.' },
  { icon: 'exchange', title: 'Your agents scout and negotiate', text: 'One AI agent per person, using Qloo’s taste data. A referee keeps it fair.' },
  { icon: 'check-circle', title: 'You get one plan', text: 'A film, a restaurant and music for everyone, with links to book. Next time, whoever gave more ground gets more say.' },
];

export function Landing() {
  const [, navigate] = useLocation();
  const [kind, setKind] = useState<DemoInput['kind']>('couple');
  const demo = useAction(async (k: DemoInput['kind']) => {
    setKind(k);
    const { truceId } = await api.demo(k);
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
            AI agents find an evening you&rsquo;ll all enjoy: a film, a restaurant and music. Each agent speaks for one person and
            negotiates until everyone says yes. For a couple or up to four friends.
          </p>
          <div className="landing__actions">
            <Button variant="primary" icon="heart" busy={demo.busy && kind === 'couple'} disabled={demo.busy} onClick={() => void demo.run('couple')}>
              Couple demo
            </Button>
            <Button variant="secondary" icon="users" busy={demo.busy && kind === 'friends'} disabled={demo.busy} onClick={() => void demo.run('friends')}>
              Friends demo
            </Button>
            <ButtonLink variant="ghost" icon="plus" href="/new">
              Start your own
            </ButtonLink>
          </div>
          <p className="small muted">Maya and Deniz in Manhattan, or three friends in Istanbul. Each demo takes about a minute.</p>
          {demo.error && <ErrorNotice error={demo.error} title="The demo didn't start" />}
        </div>

        <div className="landing__sample chat" aria-label="An example message from a truce">
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
