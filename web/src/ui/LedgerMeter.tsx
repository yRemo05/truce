import type { Side } from '@contract';
import { useEffect, useState } from 'react';
import { agentOf, type Names } from '@/lib/people';
import { cx } from './cx';
import { Monogram } from './Monogram';

/**
 * Whom the ledger favours, and how strongly, in words. `owed` is the server's
 * verdict on who; `tilt` (−1 favours B fully, 1 favours A) says how much.
 */
export function pullSentence(tilt: number, owed: Side | null, names: Names, when: 'next' | 'tonight'): string {
  if (!owed) return when === 'next' ? 'The ledger is even. Next time starts level.' : 'The ledger is even tonight.';
  const strength = Math.abs(tilt);
  const words = strength < 0.4 ? 'a little more pull' : strength < 0.75 ? 'more pull' : 'a lot more pull';
  return when === 'next' ? `Next time, ${agentOf(names[owed])} gets ${words}.` : `The ledger gives ${agentOf(names[owed])} ${words} tonight.`;
}

interface LedgerMeterProps {
  names: Names;
  letters: Names;
  /** A's bargaining weight, shown as A's share of the pull. */
  alphaA: number;
  tilt: number;
  owed: Side | null;
  /** Animate from this tilt to `tilt`. */
  from?: number;
  delay?: number;
}

const positionOf = (tilt: number) => 50 - Math.max(-1, Math.min(1, tilt)) * 44;

/** Truces recorded before the server sent a tilt: derive it from the weight (the server's MAX_TILT is 0.15). */
export const tiltOf = (tilt: number | undefined, alphaA: number) => (Number.isFinite(tilt) ? tilt! : (alphaA - 0.5) / 0.15);

/** The fairness ledger as a balance: the marker leans toward whoever is owed. */
export function LedgerMeter({ names, letters, alphaA, tilt: given, owed, from, delay = 0 }: LedgerMeterProps) {
  const tilt = tiltOf(given, alphaA);
  const [shown, setShown] = useState(from ?? tilt);

  useEffect(() => {
    if (from === undefined) {
      setShown(tilt);
      return;
    }
    setShown(from);
    const timer = setTimeout(() => setShown(tilt), delay);
    return () => clearTimeout(timer);
  }, [tilt, from, delay]);

  const pos = positionOf(shown);
  const sentence = pullSentence(tilt, owed, names, 'next');
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
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={Math.round(tilt * 100)}
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
