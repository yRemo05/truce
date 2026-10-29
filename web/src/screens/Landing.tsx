/*
 * Landing (/): the product story, on the faceted photo backdrop.
 *
 * Inventory, by priority:
 *   primary   — Couple demo: one tap to a finished truce, an instant replay of a recorded run
 *               (POST /api/demo {kind, replay: true}); in the hero, the sticky bar and the closing band
 *   secondary — Friends demo, Start your own (→ /new); My evenings (→ /evenings); the source on GitHub
 *   rare      — run a demo live instead (about a minute): one quiet line under the hero buttons
 *   info      — hero: what Truce is, and a looping negotiation that resolves into a plan with pictures
 *               problem: "I don't mind, you pick", with a tally of whose evening it was
 *               how it works: five steps, each with a piece of the real interface
 *               why Qloo: one shortlist scored for two people; cross-domain; words → tags; receipts
 *               fairness: the referee's rules, the swap vote, the ledger over five evenings (a chart)
 *
 * Data: the couple demo's recorded run (GET /api/showcase/couple) drives the pictures, the
 * negotiation and the shortlist; with none (404, offline) a synthetic run stands in, says so, and
 * shows the typeset stand-ins instead of pictures. While it loads, the hero window shows skeletons.
 *
 * Viewport budget: at 1440×900 the bar, the headline, the lede, all three buttons, the live line
 * and the whole negotiation window fit above the fold. At 390×844 the headline, lede and the three
 * buttons fit, with the top of the window peeking in.
 * Grid: the centred column (72rem), 12 columns on a wide screen: hero copy 1–6, the window 7–12;
 * how it works as a 3 + 2 bento (4/4/4, then 7/5); Why Qloo 7/5; fairness 5/7. Phone: one column.
 * Surfaces: the bar and the hero window are fake glass (Frost); every other card is near-solid
 * (`l-surface`), so nothing large runs a live blur while the page scrolls.
 * Icons: heart / users / plus (the demos, start), github, moon (My evenings), pause / play (the
 * loop), film / restaurant / music (slots), check-circle / gavel (deal, ruling), exchange (offers,
 * swaps), ban / scale / gavel (the rules), bridge, quote, data (the Qloo cards).
 */
import { useState } from 'react';
import { Button, ButtonLink, ErrorNotice, Page } from '@/ui';
import { useDemo, type DemoKind } from '@/lib/demo';
import { Fairness } from './landing/Fairness';
import { HowItWorks } from './landing/HowItWorks';
import { NavActions, NavLinks } from './landing/LandingNav';
import { Negotiation } from './landing/Negotiation';
import { Problem } from './landing/Problem';
import { syntheticStory, useStory } from './landing/story';
import { WhyQloo } from './landing/WhyQloo';
import './landing/landing.css';

type Place = 'hero' | 'bar' | 'end';

export function Landing() {
  const demo = useDemo();
  const story = useStory();
  // Where the last demo was asked for, so its error shows beside that button.
  const [from, setFrom] = useState<Place>('hero');
  const run = (place: Place, kind: DemoKind, replay: boolean) => {
    setFrom(place);
    void demo.run(kind, replay);
  };
  const error = (place: Place) => demo.error && (from === place || (place === 'hero' && from === 'bar')) && <ErrorNotice error={demo.error} title="The demo didn't start" />;
  // The sections below the fold don't wait for the recorded run: they start on the synthetic one's people.
  const s = story ?? syntheticStory;

  const demoButtons = (place: Place) => (
    <div className="l-actions">
      <Button variant="primary" icon="heart" busy={from === place && demo.busyFor('couple', true)} disabled={demo.busy} onClick={() => run(place, 'couple', true)}>
        Couple demo
      </Button>
      <Button variant="secondary" icon="users" busy={from === place && demo.busyFor('friends', true)} disabled={demo.busy} onClick={() => run(place, 'friends', true)}>
        Friends demo
      </Button>
      <ButtonLink variant="ghost" icon="plus" href="/new">
        Start your own
      </ButtonLink>
    </div>
  );

  return (
    <Page
      title={null}
      className="l-main"
      backdrop
      stickyBar
      context={<NavLinks />}
      actions={<NavActions busy={from === 'bar' && demo.busyFor('couple', true)} disabled={demo.busy} onCouple={() => run('bar', 'couple', true)} />}
    >
      <section className="l-hero" aria-labelledby="hero-title">
        <div className="l-hero__copy">
          <h1 id="hero-title" className="l-hero__title">
            Plan tonight together. Nobody always gives in.
          </h1>
          <p className="l-hero__lede">
            Each of you briefs your own AI agent. The agents negotiate a film, a restaurant and music over Qloo&rsquo;s taste data, a
            referee keeps every move fair, and whoever gives ground tonight gets more say next time. For a couple or up to four friends.
          </p>
          {demoButtons('hero')}
          <div className="l-hero__note">
            <p className="small muted">Maya and Deniz in Manhattan, or three friends in Istanbul, recorded so they open at once.</p>
            <p className="l-live small muted">
              <span>Run it live (about a minute):</span>
              <span className="l-live__buttons">
                <Button size="sm" variant="ghost" icon="heart" busy={demo.busyFor('couple', false)} disabled={demo.busy} aria-label="Run the couple demo live" onClick={() => run('hero', 'couple', false)}>
                  Couple
                </Button>
                <Button size="sm" variant="ghost" icon="users" busy={demo.busyFor('friends', false)} disabled={demo.busy} aria-label="Run the friends demo live" onClick={() => run('hero', 'friends', false)}>
                  Friends
                </Button>
              </span>
            </p>
          </div>
          {error('hero')}
        </div>
        <Negotiation story={story} />
      </section>

      <Problem names={s.names} letters={s.letters} />
      <HowItWorks story={s} />
      <WhyQloo story={s} />
      <Fairness names={s.names} />

      <section className="card l-surface l-end" aria-labelledby="end-title">
        <div className="l-end__text">
          <h2 id="end-title" className="l-section__title">
            See a whole truce in one tap
          </h2>
          <p className="l-section__lede">Open a recorded negotiation from first offer to booked table, or start your own for two to four people.</p>
        </div>
        {demoButtons('end')}
        {error('end')}
      </section>
    </Page>
  );
}
