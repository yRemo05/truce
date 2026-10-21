/*
 * Landing (/).
 *
 * Inventory, by priority:
 *   primary   — Try the demo: one tap to a live negotiation (POST /api/demo)
 *   secondary — Start a truce (→ /new)
 *   info      — what Truce is, in one breath; how to read a truce (agent / Qloo / referee);
 *               how it works in four steps; the Qloo credit
 *
 * Viewport budget: at 1440×900 the headline, the breath, both doors and the
 * specimen move all sit above the fold; the four steps start just under it.
 * At 390×844 the headline, breath and both doors fit; the specimen follows.
 *
 * Grid: 12 columns — copy in 1–7, the specimen (a real MoveCard) in 8–12,
 * dropped 4rem so the headline owns the top-left. Steps run in four columns
 * under a hairline. Phone: one column, same order.
 *
 * Icons: play (demo), plus (start), arrow-down (how it works), quote / data /
 * gavel (the three voices), plus whatever the specimen card carries.
 */
import { useLocation } from 'wouter';
import { api } from '@/api';
import { Button, ButtonLink, ErrorNotice, Icon, Page } from '@/ui';
import { useAction } from '@/lib/useAction';
import { TruceContext } from '@/truce/context';
import { MoveCard } from '@/truce/Moves';
import { specimenCtx, specimenMove } from '@/truce/specimen';

const STEPS = [
  { n: 'I', title: 'You each name what you love', text: 'One to three films, restaurants and artists. Search, tap, done.' },
  { n: 'II', title: 'Qloo scouts a shared pool', text: 'About eight options a slot: some from your taste, some from theirs, and bridges found from both at once.' },
  { n: 'III', title: 'Two agents haggle', text: 'Six turns and a last call. A referee in plain code checks every move and rules if they deadlock.' },
  { n: 'IV', title: 'The ledger remembers', text: 'Whoever gave more ground tonight gets more pull next time. Nobody is always the one who gives in.' },
];

export function Landing() {
  const [, navigate] = useLocation();
  const demo = useAction(async () => {
    const { truceId } = await api.demo();
    navigate(`/t/${truceId}`);
  });

  return (
    <Page
      title={null}
      className="landing"
      actions={
        <a className="bar-link" href="#how">
          How it works
        </a>
      }
    >
      <section className="landing__hero grid" aria-labelledby="hero-title">
        <div className="landing__copy">
          <p className="eyebrow">For couples and best friends</p>
          <h1 id="hero-title" className="display-xl landing__title">
            Peace talks for <em>tonight.</em>
          </h1>
          <p className="lede landing__lede">
            You each name a few things you love. Two AI agents, grounded in Qloo&rsquo;s taste graph, haggle over a film, a
            restaurant and the music until you both say yes, and a ledger remembers who gave ground last time.
          </p>

          <div className="landing__doors">
            <div className="door">
              <Button variant="primary" icon="play" busy={demo.busy} onClick={() => void demo.run()}>
                Try the demo
              </Button>
              <p className="door__note small muted">Maya and Deniz, mid-argument. Starts at once.</p>
            </div>
            <div className="door">
              <ButtonLink icon="plus" href="/new">
                Start a truce
              </ButtonLink>
              <p className="door__note small muted">For the two of you. About two minutes.</p>
            </div>
          </div>

          {demo.error && (
            <div className="landing__error">
              <ErrorNotice error={demo.error} title="The demo didn't start" />
            </div>
          )}
        </div>

        <aside className="landing__specimen" aria-labelledby="specimen-title">
          <p className="eyebrow" id="specimen-title">
            How to read a truce
          </p>
          <div className="specimen">
            <TruceContext.Provider value={specimenCtx}>
              <MoveCard move={specimenMove} live={false} />
            </TruceContext.Provider>
          </div>
          <ul className="legend">
            <li>
              <Icon name="quote" size={16} />
              <span>
                <span className="speech legend__sample">Italic serif</span> is an agent talking. Its words, not facts.
              </span>
            </li>
            <li>
              <Icon name="data" size={16} />
              <span>
                <span className="data legend__sample">Mono</span> is Qloo&rsquo;s data: scores, and the picks behind them.
              </span>
            </li>
            <li>
              <Icon name="gavel" size={16} />
              <span>
                <span className="legend__sample legend__sample--referee">Referee</span> notes are plain code keeping it honest.
              </span>
            </li>
          </ul>
        </aside>
      </section>

      <section className="landing__how" id="how" aria-labelledby="how-title">
        <h2 id="how-title" className="eyebrow landing__how-title">
          <Icon name="arrow-down" size={16} />
          How it works
        </h2>
        <ol className="steps">
          {STEPS.map((s) => (
            <li key={s.n} className="step">
              <span className="step__n" aria-hidden="true">
                {s.n}
              </span>
              <h3 className="step__title">{s.title}</h3>
              <p className="step__text small muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </Page>
  );
}
