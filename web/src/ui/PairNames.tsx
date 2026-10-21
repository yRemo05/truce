import type { Side } from '@contract';
import { nameOf, type Names } from '@/lib/people';

/** "Maya & Deniz", "Ömer, Ecrin & Lina". */
export function PairNames({ names, members }: { names: Names; members: readonly Side[] }) {
  const list = members.map((s) => nameOf(names, s));
  return <>{list.length > 1 ? `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}` : list[0]}</>;
}
