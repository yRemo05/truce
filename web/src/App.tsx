/*
 * Truce — design decisions (owner's redesign brief: "as simple as it gets
 * without losing context").
 *
 * 1. Theme: the Bamboo Teal palette, dark only (tokens in styles/tokens.css).
 *    One typeface, Inter, with tabular numbers for scores. Radius 0.625rem.
 * 2. The talks read like a group chat: every agent on one side with a round
 *    initial in its person's colour, the evening it offers inside its bubble,
 *    who has said yes under it, and the referee as centred system lines.
 * 3. Provenance is shown with small badges, not type: "AI" on agent words,
 *    "Qloo" on data, "Referee" on the rules.
 * 4. Jargon (bridge, score, ledger, last call, Truce's call, minimum) carries a
 *    small ⓘ with one plain sentence (lib/glossary.ts).
 * 5. Two to four people: teal, light neutral, sand and lilac, always beside
 *    the person's name, so colour is never the only cue.
 * 6. Secondary detail (why these scores, an option's facts) sits behind a
 *    disclosure; each screen has one primary action.
 * 7. Copy says what things do, in plain words. Hero: "Plan tonight together".
 */
import { useEffect } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { IconSprite } from '@/ui';
import { isSide } from '@/lib/people';
import { Handoff } from '@/screens/Handoff';
import { CheckIn } from '@/screens/CheckIn';
import { Evenings } from '@/screens/Evenings';
import { HowToPlay } from '@/screens/HowToPlay';
import { Landing } from '@/screens/Landing';
import { NewPair } from '@/screens/NewPair';
import { NotFound } from '@/screens/NotFound';
import { PairHome } from '@/screens/PairHome';
import { SideSetup } from '@/screens/SideSetup';
import { TrucePage } from '@/screens/TrucePage';

function ScrollToTop() {
  const [path] = useLocation();
  useEffect(() => {
    // Instant, or the landing's smooth anchor scrolling would glide a new page up from the old position.
    if (!window.location.hash) window.scrollTo({ top: 0, behavior: 'instant' });
  }, [path]);
  return null;
}

export function App() {
  return (
    <>
      <IconSprite />
      <ScrollToTop />
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/new" component={NewPair} />
        <Route path="/evenings" component={Evenings} />
        <Route path="/p/:pairId/play">{(p) => <HowToPlay pairId={p.pairId} />}</Route>
        <Route path="/p/:pairId/handoff/:side">{(p) => (isSide(p.side) ? <Handoff key={p.side} pairId={p.pairId} side={p.side} /> : <NotFound />)}</Route>
        <Route path="/p/:pairId/:side">
          {(p) => (isSide(p.side) ? <SideSetup key={`${p.pairId}-${p.side}`} pairId={p.pairId} side={p.side} /> : <NotFound />)}
        </Route>
        <Route path="/p/:pairId">{(p) => <PairHome key={p.pairId} pairId={p.pairId} />}</Route>
        <Route path="/t/:truceId">{(p) => <TrucePage key={p.truceId} truceId={p.truceId} />}</Route>
        <Route path="/truces/:truceId/checkin/:side">
          {(p) => (isSide(p.side) ? <CheckIn key={`${p.truceId}-${p.side}`} truceId={p.truceId} side={p.side} /> : <NotFound />)}
        </Route>
        <Route>
          <NotFound />
        </Route>
      </Switch>
    </>
  );
}
