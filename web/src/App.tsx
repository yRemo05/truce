/*
 * Truce — design decisions.
 *
 * 1. Era: a peace treaty set in a 1960s diplomatic press dossier. Cream paper,
 *    blue-black ink, a wax seal, articles numbered in Roman; the talks read like
 *    a play script, with the referee's notes centred between rules like stage
 *    directions.
 * 2. References: press.stripe.com (warm paper, bookish serif hierarchy, small
 *    caps rhythm); rauno.me (restraint, tiny labels, motion that only answers
 *    a press); linear.app/changelog (quiet arrivals, one easing curve).
 * 3. The gesture: when a truce settles, the plan rises like a document and a
 *    wax seal with both monograms is pressed onto its corner (overshoot, a ring
 *    of ink spreading), then the ledger marker slides toward whoever is owed.
 * 4. Type: Libre Caslon Display and Text (Caslon set the founding documents
 *    of the 1770s, so it is the treaty face) with Schibsted Grotesk for the
 *    interface (a newspaper grotesk) and IBM Plex Mono for data. The faces
 *    double as provenance: italic Caslon is an agent talking, mono is Qloo's
 *    data, centred capitals between rules are the referee.
 * 5. Colour: paper oklch(96% .013 84), ink oklch(24% .03 262), one accent,
 *    sealing-wax red oklch(51% .175 29), kept for the primary action, bridges,
 *    the seal and the ledger marker. The two people are told apart by place
 *    (left/right) and by solid versus open/hatched marks, never by a second hue.
 * 6. Layout: 12 columns, editorial and left-aligned; the landing headline owns
 *    the top-left and a real move card sits dropped in the right five columns.
 *    The live truce is talks in seven columns and a sticky pool rail in five.
 *    Radius: mixed — paper square, pills and seals round.
 * 7. Voice: dry and warm, a diplomat with a sense of humour. Hero line:
 *    "Peace talks for tonight."
 */
import { useEffect } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { IconSprite } from '@/ui';
import { Handoff } from '@/screens/Handoff';
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
    if (!window.location.hash) window.scrollTo(0, 0);
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
        <Route path="/p/:pairId/play">{(p) => <HowToPlay pairId={p.pairId} />}</Route>
        <Route path="/p/:pairId/handoff">{(p) => <Handoff pairId={p.pairId} />}</Route>
        <Route path="/p/:pairId/:side">
          {(p) => (p.side === 'a' || p.side === 'b' ? <SideSetup key={`${p.pairId}-${p.side}`} pairId={p.pairId} side={p.side} /> : <NotFound />)}
        </Route>
        <Route path="/p/:pairId">{(p) => <PairHome key={p.pairId} pairId={p.pairId} />}</Route>
        <Route path="/t/:truceId">{(p) => <TrucePage key={p.truceId} truceId={p.truceId} />}</Route>
        <Route>
          <NotFound />
        </Route>
      </Switch>
    </>
  );
}
