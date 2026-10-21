/**
 * Fairness ledger: whoever gave ground gets weight next time, the effect is
 * bounded, recent truces count more, and the balance heals once the owed
 * side gets its way. No network. Run with `npm run test:ledger`.
 */
import {
  LEDGER_DECAY,
  MAX_TILT,
  alphaFromBalance,
  concession,
  ledgerBalance,
  owed,
  type LedgerEntry,
} from '../src/truce/ledger';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

check('empty ledger is even', ledgerBalance([]) === 0 && alphaFromBalance(0) === 0.5 && owed(0) === null);

const aGave: LedgerEntry = { concessionA: 0.4, concessionB: 0.1 };
const bGave: LedgerEntry = { concessionA: 0.1, concessionB: 0.4 };

{
  const balance = ledgerBalance([aGave]);
  check('A gave more: balance positive', close(balance, 0.3));
  check('A gave more: A gets more weight next time', alphaFromBalance(balance) > 0.5);
  check('A gave more: the ledger says A is owed', owed(balance) === 'a');
}

{
  const streak = ledgerBalance([aGave, aGave, aGave, aGave, aGave, aGave, aGave, aGave]);
  const alpha = alphaFromBalance(streak);
  check('a long streak keeps growing the balance', streak > ledgerBalance([aGave, aGave]));
  check('the tilt is bounded however long the streak', alpha < 0.5 + MAX_TILT && alpha > 0.6, `α=${alpha.toFixed(3)}`);
  check('the tilt is symmetric', close(alphaFromBalance(-streak), 1 - alpha));
}

{
  const old = ledgerBalance([aGave, bGave]);
  const recent = ledgerBalance([bGave, aGave]);
  check('the recent truce counts more than the old one', old < 0 && recent > 0);
  check('decay factor applied once per step', close(recent, 0.3 - 0.3 * LEDGER_DECAY));
}

{
  // A gave ground twice; then two truces go A's way. The ledger should heal.
  const owedA = ledgerBalance([aGave, aGave]);
  const healed = ledgerBalance([aGave, aGave, bGave, bGave]);
  check('the balance heals when the owed side gets its way', Math.abs(healed) < Math.abs(owedA));
}

check('concession: shortfall from best', close(concession(0.9, 0.6), 0.3));
check('concession: never negative', concession(0.5, 0.6) === 0);
check('owed: a small balance is even', owed(0.01) === null && owed(-0.01) === null);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
