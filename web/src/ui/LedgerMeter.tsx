import type { Side } from '@contract';
import { useEffect, useState } from 'react';
import { agentOf, type Names } from '@/lib/people';
import { cx } from './cx';
import { Monogram } from './Monogram';

/** The most the ledger moves a side's weight from 0.5 (the server's MAX_TILT). */
const MAX_TILT = 0.15;

/**
 * Whom the ledger favours, and how strongly, in words. `owed` is the server's
 * verdict where it has one; the weight alone only says how much.
 */
export function pullSentence(alphaA: number, names: Names, when: 'next' | 'tonight', owed?: Side | null): string {
  const side = owed !== undefined ? owed : Math.abs(alphaA - 0.5) < 0.01 ? null : alphaA > 0.5 ? 'a' : 'b';
  if (!side) return when === 'next' ? 'The ledger is even. Next time starts level.' : 'The ledger is even tonight.';
  const tilt = Math.abs(alphaA - 0.5) / MAX_TILT;
  const words = tilt < 0.4 ? 'a little more pull' : tilt < 0.75 ? 'more pull' : 'a lot more pull';
  return when === 'next' ? `Next time, ${agentOf(names[side])} gets ${words}.` : `The ledger gives ${agentOf(names[side])} ${words} tonight.`;
}

interface LedgerMeterProps {
  names: Names;
  letters: Names;
  /** A's bargaining weight; B's is 1 − alphaA. */
  alphaA: number;
  owed: Side | null;
  /** Animate from this weight to `alphaA`. */
  from?: number;
  delay?: number;
}

const positionOf = (alphaA: number) => 50 - Math.max(-1, Math.min(1, (alphaA - 0.5) / MAX_TILT)) * 44;

/** The fairness ledger as a balance: the marker leans toward whoever is owed. */
export function LedgerMeter({ names, letters, alphaA, owed, from, delay = 0 }: LedgerMeterProps) {
  const [shown, setShown] = useState(from ?? alphaA);

  useEffect(() => {
    if (from === undefined) {
      setShown(alphaA);
      return;
    }
    setShown(from);
    const timer = setTimeout(() => setShown(alphaA), delay);
    return () => clearTimeout(timer);
  }, [alphaA, from, delay]);

  const pos = positionOf(shown);
  const sentence = pullSentence(alphaA, names, 'next', owed);
  const pct = Math.round(alphaA * 100);

  return (
    <div className="ledger">
      <div className="ledger__ends" aria-hidden="true">
        <span className="ledger__end">
          <Monogram side="a" letters={letters.a} size="sm" />
          {names.a}
        </span>
        <span className="ledger__end">
          {names.b}
          <Monogram side="b" letters={letters.b} size="sm" />
        </span>
      </div>
      <div
        className="ledger__track"
        role="meter"
        aria-valuemin={Math.round((0.5 - MAX_TILT) * 100)}
        aria-valuemax={Math.round((0.5 + MAX_TILT) * 100)}
        aria-valuenow={pct}
        aria-valuetext={`${names.a} ${pct}, ${names.b} ${100 - pct}. ${sentence}`}
        aria-label="Fairness ledger"
      >
        <span className="ledger__even" />
        <span
          className={cx('ledger__fill', pos < 50 ? 'ledger__fill--a' : 'ledger__fill--b')}
          style={{ left: `${Math.min(pos, 50)}%`, width: `${Math.abs(50 - pos)}%` }}
        />
        <span className="ledger__marker" style={{ left: `${pos}%` }} />
      </div>
      <div className="ledger__scale" aria-hidden="true">
        <span>{pct}</span>
        <span>even</span>
        <span>{100 - pct}</span>
      </div>
      <p className="ledger__caption">{sentence}</p>
    </div>
  );
}
