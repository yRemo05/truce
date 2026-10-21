/**
 * Bargaining maths: synthetic pools with known answers. Every check is a
 * property Truce relies on (a fair evening beats a lopsided one, a tilt moves
 * the fair point, people who care about different slots trade them, an
 * agent can always close by the last turn), for two people and for groups.
 * No network. Run with `npm run test:bargain`.
 */
import {
  betterForAll,
  eagerness,
  enumerateBundles,
  floorOf,
  nashBundle,
  paretoFrontier,
  reservation,
  scoreBundles,
} from '../src/truce/bargain';
import { SLOTS, type Bundle, type Side, type Slot, type Utilities, type Weights } from '../src/truce/types';
import { bundleUtility, normalizeWeights, scaleSlot } from '../src/truce/utility';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// --- scaleSlot -------------------------------------------------------------
{
  const s = scaleSlot(['x', 'y', 'z'], { x: 0.9, y: 0.8, z: 0.7 });
  check('scale: favourite is 1, least favourite 0', close(s.utilities.x!, 1) && close(s.utilities.z!, 0));
  check('scale: linear in between', close(s.utilities.y!, 0.5));
  check('scale: a real spread is not indifferent', !s.indifferent);

  const flat = scaleSlot(['x', 'y'], { x: 0.801, y: 0.79 });
  check('scale: a spread under 0.02 is indifferent', flat.indifferent && flat.utilities.x === 0.5 && flat.utilities.y === 0.5);

  const missing = scaleSlot(['x', 'y', 'z'], { x: 0.9, y: 0.7 });
  check('scale: an unscored item counts as least favourite', missing.utilities.z === 0);

  const none = scaleSlot(['x'], {});
  check('scale: no scores at all is indifferent', none.indifferent && none.utilities.x === 0.5);
}

// --- normalizeWeights ------------------------------------------------------
{
  const w = normalizeWeights({ film: 2, restaurant: 1, music: 1 });
  check('weights: sum to 1', close(w.film + w.restaurant + w.music, 1));
  check('weights: keep proportions', close(w.film, 0.5) && close(w.music, 0.25));
  const eq = normalizeWeights({ film: 0, restaurant: -3, music: Number.NaN });
  check('weights: invalid input falls back to equal', SLOTS.every((s) => close(eq[s], 1 / 3)));
}

// --- A small world: two films, two restaurants, two artists ---------------
// A loves f1/r1/m1, B loves f2/r2/m2; each slot is a straight disagreement.
const AB: Side[] = ['a', 'b'];
const pools: Record<Slot, string[]> = { film: ['f1', 'f2'], restaurant: ['r1', 'r2'], music: ['m1', 'm2'] };
const uA: Utilities = { film: { f1: 1, f2: 0 }, restaurant: { r1: 1, r2: 0 }, music: { m1: 1, m2: 0 } };
const uB: Utilities = { film: { f1: 0, f2: 1 }, restaurant: { r1: 0, r2: 1 }, music: { m1: 0, m2: 1 } };
const equal = normalizeWeights({});
const bundles = enumerateBundles(pools);
const two = (wa: Weights, wb: Weights) => ({ a: { utilities: uA, weights: wa }, b: { utilities: uB, weights: wb } });
const alpha2 = (a: number) => ({ a, b: 1 - a });

check('enumerate: one bundle per combination', bundles.length === 8);
check('enumerate: no duplicates', new Set(bundles.map((b) => SLOTS.map((s) => b[s]).join())).size === 8);

{
  const scored = scoreBundles(bundles, AB, two(equal, equal));
  const fair = nashBundle(scored, AB, alpha2(0.5));
  check('nash: with equal weights neither side takes everything', fair.u.a! > 0 && fair.u.b! > 0, `a=${fair.u.a!.toFixed(2)} b=${fair.u.b!.toFixed(2)}`);
  check('nash: the fair split is 2-to-1 at worst', Math.abs(fair.u.a! - fair.u.b!) <= 1 / 3 + 1e-9);
  const frontier = paretoFrontier(scored, AB);
  check('pareto: every bundle here is efficient (pure conflict)', frontier.length === 8, `got ${frontier.length}`);
}

// --- Logrolling: A cares about the film, B about the restaurant -----------
{
  const wA: Weights = normalizeWeights({ film: 0.7, restaurant: 0.1, music: 0.2 });
  const wB: Weights = normalizeWeights({ film: 0.1, restaurant: 0.7, music: 0.2 });
  const scored = scoreBundles(bundles, AB, two(wA, wB));
  const fair = nashBundle(scored, AB, alpha2(0.5));
  check('logroll: A gets its film', fair.bundle.film === 'f1');
  check('logroll: B gets its restaurant', fair.bundle.restaurant === 'r2');
  check('logroll: both keep at least their top slot (0.7)', fair.u.a! >= 0.7 - 1e-9 && fair.u.b! >= 0.7 - 1e-9);

  // An offer giving A the restaurant it barely cares about is dominated by the swap.
  const bad = scored.find((x) => x.bundle.film === 'f2' && x.bundle.restaurant === 'r1' && x.bundle.music === 'm1')!;
  const better = betterForAll(scored, bad, AB);
  check('betterForAll: finds a swap both prefer', better !== null && better.u.a! >= bad.u.a! && better.u.b! >= bad.u.b!);
  check('betterForAll: nothing beats the fair bundle for both', betterForAll(scored, fair, AB) === null);
  check('pareto: the dominated offer is off the frontier', !paretoFrontier(scored, AB).includes(bad));
}

// --- Tilt: never hurts the favoured side; moves the evening off a weak middle
// Three films and three restaurants; each slot has a middle option both rate
// `mid`. A strong middle is a real compromise and survives a tilt; a weak one
// is where the ledger decides who gets their way.
function middleWorld(mid: number) {
  const p: Record<Slot, string[]> = { film: ['f1', 'f2', 'f3'], restaurant: ['r1', 'r2', 'r3'], music: ['m1'] };
  const ua: Utilities = { film: { f1: 1, f2: mid, f3: 0 }, restaurant: { r1: 1, r2: mid, r3: 0 }, music: { m1: 0.5 } };
  const ub: Utilities = { film: { f1: 0, f2: mid, f3: 1 }, restaurant: { r1: 0, r2: mid, r3: 1 }, music: { m1: 0.5 } };
  const scored = scoreBundles(enumerateBundles(p), AB, { a: { utilities: ua, weights: equal }, b: { utilities: ub, weights: equal } });
  const at = (a: number) => {
    const x = nashBundle(scored, AB, alpha2(a));
    return { bundle: x.bundle, a: x.u.a!, b: x.u.b! };
  };
  return { even: at(0.5), tiltA: at(0.65), tiltB: at(0.35) };
}
{
  const strong = middleWorld(0.6);
  check('tilt: a strong middle is the fair evening', strong.even.bundle.film === 'f2' && strong.even.bundle.restaurant === 'r2');
  check('tilt: a strong middle survives a full tilt', strong.tiltA.bundle.film === 'f2' && strong.tiltB.bundle.film === 'f2');

  const weak = middleWorld(0.45);
  // A weak middle loses to a split: each side gets one contested slot outright.
  check('tilt: over a weak middle, even weights split the slots', close(weak.even.a, weak.even.b) && weak.even.bundle.film !== 'f2');
  check('tilt toward A moves the evening toward A', weak.tiltA.a > weak.even.a, `A even=${weak.even.a.toFixed(2)} tilted=${weak.tiltA.a.toFixed(2)}`);
  check('tilt toward B moves the evening toward B', weak.tiltB.b > weak.even.b, `B even=${weak.even.b.toFixed(2)} tilted=${weak.tiltB.b.toFixed(2)}`);
  check('tilt: the favoured side still does not take everything', weak.tiltA.b > 0 && weak.tiltB.a > 0);

  for (const [name, w] of [['strong', strong], ['weak', weak]] as const) {
    check(`tilt never hurts the favoured side (${name} middle)`, w.tiltA.a >= w.even.a - 1e-12 && w.tiltB.b >= w.even.b - 1e-12);
  }
}

// --- Reservation curves ----------------------------------------------------
{
  const T = 6;
  const floor = floorOf(0.6);
  const curve = (e: number) => Array.from({ length: T + 1 }, (_, t) => reservation({ turn: t, turns: T, best: 1, floor, eagerness: e }));
  const even = curve(eagerness(0.5, 2));
  const favoured = curve(eagerness(0.65, 2));
  const owing = curve(eagerness(0.35, 2));

  check('reservation: starts at the best evening', close(even[0]!, 1));
  check('reservation: ends at the floor', close(even[T]!, floor));
  check('reservation: never rises', even.every((r, i) => i === 0 || r <= even[i - 1]! + 1e-12));
  check('eagerness: 1 at the even weight for any group size', close(eagerness(0.5, 2), 1) && close(eagerness(1 / 3, 3), 1) && close(eagerness(0.25, 4), 1));
  check('eagerness: unchanged for two people (2^((0.5−α)/0.15))', close(eagerness(0.65, 2), 2 ** (-0.15 / 0.15)) && close(eagerness(0.4, 2), 2 ** (0.1 / 0.15)));
  check(
    'reservation: the favoured side holds out longer',
    favoured.slice(1, T).every((r, i) => r > even[i + 1]! && even[i + 1]! > owing[i + 1]!),
  );
  check('reservation: every side reaches its floor on the last turn', close(favoured[T]!, floor) && close(owing[T]!, floor));
  check('floor: a margin below the fair share', close(floor, 0.5) && floorOf(0.05) === 0);
  check('reservation: scales to a best below 1', close(reservation({ turn: 0, turns: T, best: 0.8, floor: 0.4, eagerness: 1 }), 0.8));
}

// --- Closing is always possible on the last turn --------------------------
{
  const wA = normalizeWeights({ film: 3, restaurant: 1, music: 2 });
  const wB = normalizeWeights({ film: 1, restaurant: 3, music: 2 });
  const scored = scoreBundles(bundles, AB, two(wA, wB));
  for (const alpha of [0.35, 0.5, 0.65]) {
    const fair = nashBundle(scored, AB, alpha2(alpha));
    const lastA = reservation({ turn: 6, turns: 6, best: 1, floor: floorOf(fair.u.a!), eagerness: eagerness(alpha, 2) });
    const lastB = reservation({ turn: 6, turns: 6, best: 1, floor: floorOf(fair.u.b!), eagerness: eagerness(1 - alpha, 2) });
    check(`closing at α=${alpha}: both accept the fair bundle on the last turn`, fair.u.a! >= lastA && fair.u.b! >= lastB);
  }
}

// --- Three people, each caring most about a different slot ----------------
// Each slot has one favourite per person; whoever cares about a slot should
// win it, and nobody should be shut out, even under a tilt.
{
  const ABC: Side[] = ['a', 'b', 'c'];
  const p3: Record<Slot, string[]> = { film: ['f1', 'f2', 'f3'], restaurant: ['r1', 'r2', 'r3'], music: ['m1', 'm2', 'm3'] };
  const fav = (k: number): Utilities => ({
    film: { f1: k === 1 ? 1 : 0, f2: k === 2 ? 1 : 0, f3: k === 3 ? 1 : 0 },
    restaurant: { r1: k === 1 ? 1 : 0, r2: k === 2 ? 1 : 0, r3: k === 3 ? 1 : 0 },
    music: { m1: k === 1 ? 1 : 0, m2: k === 2 ? 1 : 0, m3: k === 3 ? 1 : 0 },
  });
  const people = {
    a: { utilities: fav(1), weights: normalizeWeights({ film: 0.8, restaurant: 0.1, music: 0.1 }) },
    b: { utilities: fav(2), weights: normalizeWeights({ film: 0.1, restaurant: 0.8, music: 0.1 }) },
    c: { utilities: fav(3), weights: normalizeWeights({ film: 0.1, restaurant: 0.1, music: 0.8 }) },
  };
  const scored3 = scoreBundles(enumerateBundles(p3), ABC, people);
  check('three: 27 bundles', scored3.length === 27);
  const third = { a: 1 / 3, b: 1 / 3, c: 1 / 3 };
  const fair3 = nashBundle(scored3, ABC, third);
  check(
    'three: each person wins the slot they care about',
    fair3.bundle.film === 'f1' && fair3.bundle.restaurant === 'r2' && fair3.bundle.music === 'm3',
    JSON.stringify(fair3.bundle),
  );
  check('three: the logroll is on the frontier', paretoFrontier(scored3, ABC).includes(fair3));
  check('three: nothing beats it for everyone', betterForAll(scored3, fair3, ABC) === null);
  const tilted = nashBundle(scored3, ABC, { a: 0.5, b: 0.25, c: 0.25 });
  check('three: a tilt never hurts the favoured person', tilted.u.a! >= fair3.u.a! - 1e-12);
  check('three: a tilt still leaves the others something', tilted.u.b! > 0 && tilted.u.c! > 0);
  check('three: favoured eagerness is below 1, owed above', eagerness(0.4, 3) < 1 && eagerness(0.27, 3) > 1);
}

// --- bundleUtility sanity ---------------------------------------------------
{
  const b: Bundle = { film: 'f1', restaurant: 'r2', music: 'm1' };
  check('bundleUtility: weighted sum', close(bundleUtility(uA, equal, b), 2 / 3));
  check('bundleUtility: unknown ids count 0', close(bundleUtility(uA, equal, { film: '?', restaurant: '?', music: '?' }), 0));
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
