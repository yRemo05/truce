import type { Side } from '@contract';
import { useEffect, useState } from 'react';
import { agentOf, type Names } from '@/lib/people';
import { Avatar } from './Avatar';

/**
 * Whom the ledger favours, and how strongly, in words. `owed` is the server's
 * verdict on who; `tilt` (−1 favours B fully, 1 favours A) says how much.
 */
export function pullSentence(tilt: number, owed: Side | null, names: Names, when: 'next' | 'tonight'): string {
  if (!owed) return when === 'next' ? 'It’s even, so next time starts level.' : 'The ledger is even tonight.';
  const strength = Math.abs(tilt);
  const words = strength < 0.4 ? 'a little more say' : strength < 0.75 ? 'more say' : 'a lot more say';
  return when === 'next' ? `Next time, ${agentOf(names[owed])} gets ${words}.` : `${agentOf(names[owed])} has ${words} tonight.`;
}

interface LedgerMeterProps {
  names: Names;
  letters: Names;
  /** A's share of the say in the next truce, 0–1 (B's is the rest). */
  alphaA: number;
  tilt: number;
  owed: Side | null;
  /** Animate from this share to `alphaA`. */
  from?: number;
  delay?: number;
}

/** The fairness ledger as each person's share of the say next time. */
export function LedgerMeter({ names, letters, alphaA, tilt, owed, from, delay = 0 }: LedgerMeterProps) {
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

  const pctA = Math.round(alphaA * 100);
  const sentence = pullSentence(tilt, owed, names, 'next');

  return (
    <div className="ledger">
      <div
        className="ledger__bar"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pctA}
        aria-valuetext={`${names.a} ${pctA}%, ${names.b} ${100 - pctA}%. ${sentence}`}
        aria-label="Share of the say next time"
      >
        <span className="ledger__part ledger__part--a" style={{ flexGrow: shown }} />
        <span className="ledger__part ledger__part--b" style={{ flexGrow: 1 - shown }} />
      </div>
      <div className="ledger__legend" aria-hidden="true">
        <span>
          <Avatar side="a" letters={letters.a} size="sm" />
          {names.a} <span className="num">{pctA}%</span>
        </span>
        <span>
          {names.b} <span className="num">{100 - pctA}%</span>
          <Avatar side="b" letters={letters.b} size="sm" />
        </span>
      </div>
      <p className="ledger__caption small">{sentence}</p>
    </div>
  );
}
