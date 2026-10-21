import { agentOf, type Names } from '@/lib/people';
import { isLastCall, turnsOf, type TruceState } from '@/lib/truce';
import { useTruceCtx } from './context';

function statusOf(state: TruceState, names: Names, latest: number): string {
  if (state.phase === 'settled' || state.phase === 'done') return state.ruled ? 'Truce’s call' : 'Deal reached';
  const { thinking, turns } = state;
  if (thinking && isLastCall(thinking.turn, turns)) return `Last call: ${agentOf(names[thinking.side])} decides`;
  if (thinking) return `Turn ${thinking.turn} of ${turns}`;
  if (latest) return `Turn ${Math.min(latest, turns)} of ${turns}`;
  return state.start ? `Turn 1 of ${turns}` : 'Starting';
}

/** How far the talks are: a line of text and a thin progress bar under the header. */
export function TurnTrack({ state }: { state: TruceState }) {
  const { names } = useTruceCtx();
  const moves = turnsOf(state.feed);
  const latest = Math.max(0, ...moves.map((m) => m.turn));
  const settled = state.phase === 'settled' || state.phase === 'done';
  const steps = state.turns + 1;
  const progress = settled ? 1 : Math.min(1, (state.thinking?.turn ?? latest) / steps);
  const status = statusOf(state, names, latest);
  return (
    <div className="turnbar">
      <div className="wrap turnbar__row">
        <p className="turnbar__status small">{status}</p>
      </div>
      <div
        className="turnbar__track"
        role="progressbar"
        aria-label="Progress of the talks"
        aria-valuemin={0}
        aria-valuemax={steps}
        aria-valuenow={settled ? steps : Math.max(latest, state.thinking?.turn ?? 0)}
        aria-valuetext={status}
      >
        <span className="turnbar__fill" style={{ transform: `scaleX(${progress})` }} />
      </div>
    </div>
  );
}
