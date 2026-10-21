import type { Side } from '@contract';
import { cx } from '@/ui';
import { agentOf, type Names } from '@/lib/people';
import { isLastCall, turnLabel, turnsOf, type TruceState } from '@/lib/truce';
import { useTruceCtx } from './context';

const VERB = { accept: 'accepted', counter: 'offered', decline: 'declined' } as const;

function statusOf(state: TruceState, names: Names, latest: number): string {
  if (state.phase === 'settled' || state.phase === 'done') return state.ruled ? 'Ruled by the referee' : 'Agreed';
  const { thinking, turns } = state;
  if (thinking && isLastCall(thinking.turn, turns)) return `Last call: ${agentOf(names[thinking.side])}`;
  if (thinking) return `Turn ${thinking.turn} of ${turns}`;
  if (latest) return `Turn ${Math.min(latest, turns)} of ${turns}`;
  return state.start ? `Turn 1 of ${turns}` : 'Seating the agents';
}

/** Six turns and a last call, as pips: who moved, who is thinking, where it ended. */
export function TurnTrack({ state }: { state: TruceState }) {
  const { names, letters } = useTruceCtx();
  const { turns, thinking } = state;
  const opener: Side = state.start?.opener ?? 'a';
  const moves = new Map(turnsOf(state.feed).map((m) => [m.turn, m]));
  const settled = state.phase === 'settled' || state.phase === 'done';
  const sideOf = (turn: number): Side => (turn % 2 === 1 ? opener : opener === 'a' ? 'b' : 'a');

  return (
    <div className="turns">
      <ol className="turns__pips" aria-label="Turns">
        {Array.from({ length: turns + 1 }, (_, i) => {
          const turn = i + 1;
          const last = isLastCall(turn, turns);
          const move = moves.get(turn);
          const now = thinking?.turn === turn;
          const unused = last && settled && !move;
          const side = move?.side ?? (now && thinking ? thinking.side : last ? null : sideOf(turn));
          const label = `${turnLabel(turn, turns)}: ${move ? `${agentOf(names[move.side])} ${VERB[move.action]}` : now ? 'thinking' : unused ? 'not needed' : 'to come'}`;
          return (
            <li
              key={turn}
              className={cx(
                'pip',
                last && 'pip--last',
                move && `pip--${move.side}`,
                move && move.action !== 'counter' && `pip--${move.action}`,
                now && 'pip--thinking',
                unused && 'pip--unused',
              )}
              title={label}
            >
              <span aria-hidden="true">{move || now ? side && letters[side] : last ? 'LC' : turn}</span>
              <span className="visually-hidden">{label}</span>
            </li>
          );
        })}
      </ol>
      <p className="turns__status">{statusOf(state, names, Math.max(0, ...moves.keys()))}</p>
    </div>
  );
}
