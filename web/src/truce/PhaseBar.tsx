import { Tabs } from '@/ui';
import { PHASE_LABEL, PHASE_TABS, tabMeta, turnsOf, type PhaseTab, type TruceState } from '@/lib/truce';

interface PhaseBarProps {
  state: TruceState;
  tab: PhaseTab;
  onTab: (tab: PhaseTab) => void;
  /** Tabs with something the reader hasn't seen. */
  unseen: ReadonlySet<PhaseTab>;
}

/** The truce page's sticky second row: Research · Discussion · Decision, and a thin line for how far the talks are. */
export function PhaseBar({ state, tab, onTab, unseen }: PhaseBarProps) {
  const latest = Math.max(0, ...turnsOf(state.feed).map((m) => m.turn));
  const settled = state.phase === 'settled' || state.phase === 'done';
  const steps = state.turns + 1;
  const progress = settled ? 1 : Math.min(1, (state.thinking?.turn ?? latest) / steps);
  return (
    <div className="phasebar">
      <div className="wrap phasebar__row">
        <Tabs
          label="Phases of the truce"
          idBase="phase-tab"
          panelId="phase-panel"
          className="phasebar__tabs"
          value={tab}
          onChange={onTab}
          items={PHASE_TABS.map((t) => ({ value: t, label: PHASE_LABEL[t], meta: tabMeta(state, t), dot: unseen.has(t) }))}
        />
      </div>
      {state.start && (
        <div
          className="turnbar__track"
          role="progressbar"
          aria-label="Progress of the talks"
          aria-valuemin={0}
          aria-valuemax={steps}
          aria-valuenow={settled ? steps : Math.max(latest, state.thinking?.turn ?? 0)}
          aria-valuetext={tabMeta(state, 'discussion')}
        >
          <span className="turnbar__fill" style={{ transform: `scaleX(${progress})` }} />
        </div>
      )}
    </div>
  );
}
