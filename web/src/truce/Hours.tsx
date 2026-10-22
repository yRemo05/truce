import type { CardItem } from '@contract';
import { Badge, Icon, InfoTip } from '@/ui';
import { EXPLAIN } from '@/lib/glossary';

/** "Open today 17:00–01:00", or a warning when the listed hours don't cover tonight. */
export function Hours({ hours }: { hours: CardItem['hours'] }) {
  if (!hours) return null;
  if (hours.openTonight === false) {
    return (
      <p className="icon-line small">
        <Badge variant="warning" icon="warning">
          May be closed tonight
        </Badge>
        {hours.today && <span className="muted">Listed hours today: {hours.today}</span>}
        <InfoTip label="About opening hours">{EXPLAIN.openTonight}</InfoTip>
      </p>
    );
  }
  if (!hours.today) return null;
  return (
    <p className="icon-line small">
      <Icon name="clock" size={16} className="muted" />
      <span>Open today {hours.today}</span>
      <InfoTip label="About opening hours">{EXPLAIN.openTonight}</InfoTip>
    </p>
  );
}
