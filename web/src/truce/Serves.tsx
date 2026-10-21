import type { CardItem } from '@contract';
import { cx, Icon } from '@/ui';
import { listNames, nameOf } from '@/lib/people';
import { useTruceCtx } from './context';

/**
 * "Serves Ramen for Maya · Meze for Lina and Ada": the foods people named
 * that this restaurant serves. Food names stay as Qloo gives them; people who
 * named the same food share one entry. Nothing when it serves none of them.
 */
export function Serves({ item, compact = false }: { item: CardItem; compact?: boolean }) {
  const { names, members } = useTruceCtx();
  const byFood = new Map<string, string[]>();
  for (const side of members) {
    for (const food of item.serves?.[side] ?? []) byFood.set(food, [...(byFood.get(food) ?? []), nameOf(names, side)]);
  }
  if (!byFood.size) return null;
  const text = `Serves ${[...byFood].map(([food, who]) => `${food} for ${listNames(who)}`).join(' · ')}`;
  return (
    <span className={cx('serves', compact ? 'serves--compact' : 'small')}>
      {!compact && <Icon name="food" size={16} className="serves__icon" />}
      <span>{text}</span>
    </span>
  );
}
