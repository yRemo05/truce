/**
 * Fairness ledger: whoever gave ground gets weight next time, the effect is
 * bounded, recent truces count more, the balance heals once the owed person
 * gets their way, two people behave exactly as before groups existed, and a
 * check-in that says the evening disappointed someone counts for them.
 * No network. Run with `npm run test:ledger`.
 */
import {
  LEDGER_DECAY,
  MAX_TILT,
  TILT_SCALE,
  alphaFromBalance,
  concession,
  experienced,
  ledgerBalance,
  owed,
  realisedConcession,
  tiltOf,
  type LedgerEntry,
} from '../src/truce/ledger';
import type { Side } from '../src/truce/types';
import { normalizeWeights } from '../src/truce/utility';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const AB: Side[] = ['a', 'b'];
const ABC: Side[] = ['a', 'b', 'c'];
const two = (a: number, b: number): LedgerEntry => ({ concession: { a, b } });

/** The two-person ledger as it was before groups: balance Σ λ(cA − cB), α_A = 0.5 + 0.15·tanh(B/0.3). */
const oldBalance = (entries: [number, number][]) => entries.reduce((b, [a, c]) => b * LEDGER_DECAY + (a - c), 0);
const oldAlpha = (b: number) => 0.5 + MAX_TILT * Math.tanh(b / TILT_SCALE);

{
  const even = ledgerBalance([], AB);
  check('empty ledger is even', even.a === 0 && even.b === 0 && close(alphaFromBalance(even, AB).a!, 0.5) && owed(even, AB) === null);
}

const aGave = two(0.4, 0.1);
const bGave = two(0.1, 0.4);

{
  const balance = ledgerBalance([aGave], AB);
  check('A gave more: A positive, B negative', balance.a! > 0 && close(balance.a!, -balance.b!));
  check('A gave more: A gets more weight next time', alphaFromBalance(balance, AB).a! > 0.5);
  check('A gave more: the ledger says A is owed', owed(balance, AB) === 'a');
  check('weights sum to 1', close(alphaFromBalance(balance, AB).a! + alphaFromBalance(balance, AB).b!, 1));
}

{
  // Two people: identical to the formula from before groups, on a mixed history.
  const history: [number, number][] = [[0.4, 0.1], [0.05, 0.3], [0.2, 0.25], [0.5, 0.0]];
  const balance = ledgerBalance(history.map(([a, b]) => two(a, b)), AB);
  const alpha = alphaFromBalance(balance, AB);
  check('two people: α matches the pre-group formula', close(alpha.a!, oldAlpha(oldBalance(history))), `${alpha.a} vs ${oldAlpha(oldBalance(history))}`);
  check('two people: tilt is (α − 0.5)/0.15', close(tiltOf(alpha, AB).a!, (alpha.a! - 0.5) / MAX_TILT));
}

{
  const streak = ledgerBalance(Array.from({ length: 8 }, () => aGave), AB);
  const alpha = alphaFromBalance(streak, AB).a!;
  check('a long streak keeps growing the balance', streak.a! > ledgerBalance([aGave, aGave], AB).a!);
  check('the tilt is bounded however long the streak', alpha < 0.5 + MAX_TILT && alpha > 0.6, `α=${alpha.toFixed(3)}`);
  check('the tilt is symmetric', close(alphaFromBalance(ledgerBalance(Array.from({ length: 8 }, () => bGave), AB), AB).a!, 1 - alpha));
}

{
  const old = ledgerBalance([aGave, bGave], AB).a!;
  const recent = ledgerBalance([bGave, aGave], AB).a!;
  check('the recent truce counts more than the old one', old < 0 && recent > 0);
  check('decay factor applied once per step', close(recent, (0.3 - 0.3 * LEDGER_DECAY) / 2));
}

{
  const owedA = ledgerBalance([aGave, aGave], AB).a!;
  const healed = ledgerBalance([aGave, aGave, bGave, bGave], AB).a!;
  check('the balance heals when the owed person gets their way', Math.abs(healed) < Math.abs(owedA));
}

{
  // Three friends: Lina (c) gave the most ground.
  const balance = ledgerBalance([{ concession: { a: 0.15, b: 0.02, c: 0.33 } }], ABC);
  const alpha = alphaFromBalance(balance, ABC);
  check('three: balances sum to zero', close(balance.a! + balance.b! + balance.c!, 0));
  check('three: weights sum to 1', close(alpha.a! + alpha.b! + alpha.c!, 1));
  check('three: whoever gave most gets the most say', alpha.c! > alpha.a! && alpha.a! > alpha.b!);
  check('three: whoever gave least gets the least', alpha.b! < 1 / 3);
  check('three: the ledger says c is owed', owed(balance, ABC) === 'c');
  const tilt = tiltOf(alpha, ABC);
  check('three: tilts stay within −1…1', [tilt.a!, tilt.b!, tilt.c!].every((t) => t >= -1 && t <= 1));
  const even = alphaFromBalance(ledgerBalance([], ABC), ABC);
  check('three: an empty ledger is a third each', close(even.a!, 1 / 3) && close(even.c!, 1 / 3));
}

{
  // Someone who wasn't there (a group that grew) is neither credited nor charged.
  const balance = ledgerBalance([two(0.4, 0.1)], ABC);
  check('a newcomer starts even', balance.c === 0);
}

{
  const w = normalizeWeights({ film: 2, restaurant: 1, music: 1 });
  const predicted = { film: 0.8, restaurant: 0.6, music: 0.4 };
  const allLoved = experienced(w, predicted, { film: 'loved', restaurant: 'loved', music: 'loved' });
  const noRatings = experienced(w, predicted, {});
  check('check-in: all loved is worth 1', close(allLoved, 1));
  check('check-in: no ratings keeps the prediction', close(noRatings, 0.5 * 0.8 + 0.25 * 0.6 + 0.25 * 0.4));
  check('check-in: "not for me" on the film costs half the evening', close(experienced(w, predicted, { film: 'not_for_me' }), 0.25 * 0.6 + 0.25 * 0.4));

  const best = 0.9;
  const got = 0.7;
  check('check-in: no report keeps the predicted concession', close(realisedConcession(best, got, null), concession(best, got)));
  check('check-in: a disappointing evening counts as more ground given', realisedConcession(best, got, 0.2) > concession(best, got));
  check('check-in: a great evening counts as less', realisedConcession(best, got, 1) < concession(best, got));
  check('check-in: halfway between prediction and report', close(realisedConcession(best, got, 0.3), best - 0.5));
}

check('concession: shortfall from best', close(concession(0.9, 0.6), 0.3));
check('concession: never negative', concession(0.5, 0.6) === 0);
check('owed: a small balance is even', owed({ a: 0.005, b: -0.005 }, AB) === null);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
