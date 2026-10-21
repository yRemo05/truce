import type { PerSide, Side } from '@contract';
import { useEffect, useState } from 'react';
import { agentOf, nameOf, type Names } from '@/lib/people';
import { Avatar } from './Avatar';
import { cx } from './cx';

/**
 * Whom the ledger favours, and how strongly, in words. `owed` is the server's
 * verdict on who; their `tilt` (−1…1) says how much.
 */
export function pullSentence(tilt: PerSide<number>, owed: Side | null, names: Names, members: readonly Side[], when: 'next' | 'tonight'): string {
  if (!owed) {
    const even = members.length > 2 ? 'everyone has an equal say' : 'it starts level';
    return when === 'next' ? `It’s even, so next time ${even}.` : 'The ledger is even tonight.';
  }
  const agent = agentOf(nameOf(names, owed));
  if (members.length > 2) return when === 'next' ? `Next time, ${agent} has the most say.` : `${agent} has the most say tonight.`;
  const strength = Math.abs(tilt[owed] ?? 0);
  const words = strength < 0.4 ? 'a little more say' : strength < 0.75 ? 'more say' : 'a lot more say';
  return when === 'next' ? `Next time, ${agent} gets ${words}.` : `${agent} has ${words} tonight.`;
}

interface LedgerMeterProps {
  members: readonly Side[];
  names: Names;
  letters: Names;
  /** Each person's share of the say in the next truce; they sum to 1. */
  alpha: PerSide<number>;
  tilt: PerSide<number>;
  owed: Side | null;
  /** Animate from these shares to `alpha`. */
  from?: PerSide<number>;
  delay?: number;
}

/**
 * The fairness ledger as each person's share of the say next time: one split
 * bar for a couple, a short bar each for a group.
 */
export function LedgerMeter({ members, names, letters, alpha, tilt, owed, from, delay = 0 }: LedgerMeterProps) {
  const [shown, setShown] = useState(from ?? alpha);

  useEffect(() => {
    if (from === undefined) {
      setShown(alpha);
      return;
    }
    setShown(from);
    const timer = setTimeout(() => setShown(alpha), delay);
    return () => clearTimeout(timer);
  }, [alpha, from, delay]);

  const even = 1 / Math.max(members.length, 1);
  const pct = (s: Side) => Math.round((alpha[s] ?? even) * 100);
  const sentence = pullSentence(tilt, owed, names, members, 'next');
  const valueText = `${members.map((s) => `${nameOf(names, s)} ${pct(s)}%`).join(', ')}. ${sentence}`;

  if (members.length === 2) {
    const [a, b] = members as [Side, Side];
    return (
      <div className="ledger">
        <div className="ledger__bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct(a)} aria-valuetext={valueText} aria-label="Share of the say next time">
          <span className={cx('ledger__part', `p-${a}`)} style={{ flexGrow: shown[a] ?? even }} />
          <span className={cx('ledger__part', `p-${b}`)} style={{ flexGrow: shown[b] ?? even }} />
        </div>
        <div className="ledger__legend" aria-hidden="true">
          <span>
            <Avatar side={a} letters={nameOf(letters, a)} size="sm" />
            {nameOf(names, a)} <span className="num">{pct(a)}%</span>
          </span>
          <span>
            {nameOf(names, b)} <span className="num">{pct(b)}%</span>
            <Avatar side={b} letters={nameOf(letters, b)} size="sm" />
          </span>
        </div>
        <p className="ledger__caption small">{sentence}</p>
      </div>
    );
  }

  return (
    <div className="ledger">
      <ul className="ledger__rows" aria-label="Share of the say next time">
        {members.map((s) => (
          <li key={s} className="ledger__row">
            <Avatar side={s} letters={nameOf(letters, s)} size="sm" />
            <span className="ledger__name">{nameOf(names, s)}</span>
            <span className="ledger__track" aria-hidden="true">
              <span className={cx('ledger__fill', `p-${s}`)} style={{ transform: `scaleX(${Math.min(1, (shown[s] ?? even) * 2)})` }} />
            </span>
            <span className="num ledger__pct">{pct(s)}%</span>
          </li>
        ))}
      </ul>
      <p className="ledger__caption small">{sentence}</p>
    </div>
  );
}
