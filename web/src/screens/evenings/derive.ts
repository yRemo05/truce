/**
 * My evenings, derived: where each group's evening is, what's waiting and
 * on whom, its last plan, and what people loved. Pure functions over the
 * server's PairView and this browser's memory.
 */
import type { PairView, Side, Slot } from '@contract';
import type { Stage } from '@/ui';
import type { IconName } from '@/ui/Icon';
import type { FeedbackMemo, GroupMemo, Memory, PlanPick } from '@/lib/evenings';
import { listNames, nameOf, possessive } from '@/lib/people';
import { SLOT_NOUN, SLOTS } from '@/lib/truce';

/* ---------- Where the evening is ---------- */

export const STAGES: readonly Stage[] = [
  { label: 'Favourites', short: 'Picks' },
  { label: 'Tonight’s answers', short: 'Answers' },
  { label: 'Agents talk', short: 'Talks' },
  { label: 'Plan' },
  { label: 'Check-ins' },
];
// Plan (3) is never the stage under way: a decided evening goes straight to its check-ins.
const [PICKS, ANSWERS, TALKS, CHECKINS] = [0, 1, 2, 4];
export const ALL_DONE = STAGES.length;

/** Favourites saved: ready now, or asked tonight's questions again after an evening. */
const hasFavourites = (pair: PairView, s: Side) => Boolean(pair.ready[s] || pair.tonightDue[s]);

/**
 * The stage under way for the group's current evening. After a settled
 * evening, a new one starts once anyone answers tonight's questions; a demo
 * group's people keep their answers, so its evening ends with the check-ins.
 */
export function stageOf(pair: PairView): number {
  const { members, lastTruce: last } = pair;
  if (!members.every((s) => hasFavourites(pair, s))) return PICKS;
  if (last?.status === 'running') return TALKS;
  const allReady = members.every((s) => pair.ready[s]);
  if (!last || last.status === 'failed') return allReady ? TALKS : ANSWERS;
  const checkinsLeft = members.some((s) => !last.checkedIn[s]);
  if (pair.demo) return checkinsLeft ? CHECKINS : ALL_DONE;
  if (allReady) return TALKS;
  if (members.some((s) => pair.ready[s])) return ANSWERS;
  return checkinsLeft ? CHECKINS : ALL_DONE;
}

/** Who still has to act at a stage, in seat order. */
function pendingAt(pair: PairView, stage: number): Side[] {
  const { members, lastTruce: last } = pair;
  if (stage === PICKS) return members.filter((s) => !hasFavourites(pair, s));
  if (stage === ANSWERS) return members.filter((s) => !pair.ready[s]);
  if (stage === CHECKINS && last) return members.filter((s) => !last.checkedIn[s]);
  return [];
}

const whose = (pair: PairView, sides: readonly Side[]) => listNames(sides.map((s) => possessive(nameOf(pair.names, s))));

/** The group's state in one line, with its glyph. */
export function statusOf(pair: PairView): { icon: IconName; text: string } {
  const stage = stageOf(pair);
  const pending = pendingAt(pair, stage);
  const last = pair.lastTruce;
  if (last?.openSwap) return { icon: last.openSwap.kind === 'replan' ? 'retry' : 'exchange', text: `A vote is open: waiting for ${listNames(last.openSwap.waiting.map((s) => nameOf(pair.names, s)))}.` };
  switch (stage) {
    case PICKS:
      return { icon: 'hourglass', text: `Waiting for ${whose(pair, pending)} favourites.` };
    case ANSWERS:
      return { icon: 'hourglass', text: `A new evening: waiting for ${whose(pair, pending)} answers.` };
    case TALKS:
      return last?.status === 'running'
        ? { icon: 'eye', text: 'The agents are talking now.' }
        : last?.status === 'failed'
          ? { icon: 'warning', text: 'The last truce stopped early.' }
          : { icon: 'play', text: 'Everyone’s ready to start.' };
    case CHECKINS:
      return { icon: 'heart', text: `Planned. Waiting for ${whose(pair, pending)} check-in${pending.length > 1 ? 's' : ''}.` };
    default:
      return { icon: 'check-circle', text: 'Everyone has checked in.' };
  }
}

/* ---------- Waiting on you ---------- */

export interface WaitAction {
  label: string;
  href: string;
  /** The full action, for a screen reader: "Check in as Maya". */
  aria?: string;
}

/** Most urgent first. */
const URGENCY = ['vote', 'checkin', 'start', 'running', 'picks', 'answers'] as const;

export interface WaitItem {
  key: string;
  /** Its place in URGENCY. */
  rank: number;
  pairId: string;
  icon: IconName;
  title: string;
  detail: string;
  actions: WaitAction[];
}

const groupLabel = (pair: Pick<PairView, 'names' | 'members'>) => listNames(pair.members.map((s) => nameOf(pair.names, s)));

/** One action per person when this browser doesn't know who you are; just yours when it does. */
function perPerson(pair: PairView, sides: readonly Side[], mine: Side | null, href: (s: Side) => string, verb: string, label: string): WaitAction[] {
  if (mine) return sides.includes(mine) ? [{ label, href: href(mine) }] : [];
  return sides.map((s) => ({ label: nameOf(pair.names, s), href: href(s), aria: `${verb} as ${nameOf(pair.names, s)}` }));
}

/**
 * What a group is waiting for that someone here can do, most urgent first:
 * a vote, the check-ins, starting the truce, watching it, tonight's answers.
 * With a known "you", only what's on you; else each person's own action.
 */
export function waitingIn(pair: PairView, mine: Side | null): WaitItem[] {
  const out: WaitItem[] = [];
  const last = pair.lastTruce;
  const group = groupLabel(pair);
  const add = (kind: (typeof URGENCY)[number], icon: IconName, title: string, detail: string, actions: WaitAction[]) => {
    if (actions.length) out.push({ key: `${pair.id}:${kind}`, rank: URGENCY.indexOf(kind), pairId: pair.id, icon, title, detail, actions });
  };

  const open = last?.openSwap;
  if (last && open && open.waiting.length > 0) {
    const asker = nameOf(pair.names, open.side);
    const what = open.kind === 'replan' ? `${possessive(asker)} request to plan again` : `${possessive(asker)} swap of the ${open.slot ? SLOT_NOUN[open.slot] : 'item'}`;
    const voting = mine ? (open.waiting.includes(mine) ? [mine] : []) : open.waiting;
    add('vote', open.kind === 'replan' ? 'retry' : 'exchange', `Vote on ${what}`, mine ? group : `${group} · waiting for ${listNames(open.waiting.map((s) => nameOf(pair.names, s)))}`, voting.length ? [{ label: 'Vote', href: `/t/${last.id}?tab=decision`, aria: `Vote on ${what}` }] : []);
  }

  if (last?.status === 'done') {
    const due = pair.members.filter((s) => !last.checkedIn[s]);
    add('checkin', 'heart', 'How was the evening?', open ? `${group} · once the vote is settled` : group, perPerson(pair, due, mine, (s) => `/truces/${last.id}/checkin/${s}`, 'Check in', 'Check in'));
  }

  const running = last?.status === 'running';
  if (running) add('running', 'eye', 'The agents are talking now', group, [{ label: 'Watch', href: `/t/${last.id}`, aria: `Watch ${possessive(group)} truce` }]);

  if (!running && !pair.demo) {
    if (pair.members.every((s) => pair.ready[s]) && stageOf(pair) === TALKS) {
      add('start', 'play', 'Everyone’s ready', group, [{ label: 'Start the truce', href: `/p/${pair.id}` }]);
    }
    const picking = pair.members.filter((s) => !hasFavourites(pair, s));
    add('picks', 'pencil', 'Favourites to pick', group, perPerson(pair, picking, mine, (s) => `/p/${pair.id}/${s}`, 'Add favourites', 'Add favourites'));
    const answering = pair.members.filter((s) => pair.tonightDue[s] && !pair.ready[s]);
    add('answers', 'hourglass', 'Tonight’s questions, for a new evening', group, perPerson(pair, answering, mine, (s) => `/p/${pair.id}/${s}`, 'Answer', 'Answer'));
  }
  return out;
}

/* ---------- The last plan ---------- */

export interface LastPlan {
  truceId: string;
  /** When it was planned; null when only the memory knows it. */
  at: string | null;
  picks: PlanPick[];
  /** A made-up earlier evening of a demo group: names only. */
  earlier: boolean;
  /** Not opened in this browser yet: names from the ledger, no pictures. */
  namesOnly: boolean;
}

/** The group's latest evening: its pictures from this browser's snapshot, else its names from the ledger. */
export function lastPlanOf(pair: PairView, memory: Memory): LastPlan | null {
  const entries = pair.ledger.entries;
  const latest = entries.findLast((e) => !e.earlier) ?? entries[entries.length - 1];
  const doneId = pair.lastTruce?.status === 'done' ? pair.lastTruce.id : null;
  const truceId = doneId ?? latest?.truceId ?? null;
  if (!truceId) return null;
  const snap = memory.plans.find((p) => p.truceId === truceId);
  const entry = entries.find((e) => e.truceId === truceId);
  if (snap) return { truceId, at: entry?.at ?? snap.savedAt, picks: SLOTS.flatMap((s) => snap.picks.filter((p) => p.slot === s)), earlier: false, namesOnly: false };
  if (!entry) return null;
  const picks = SLOTS.filter((s) => entry.evening[s]).map((s): PlanPick => ({ slot: s, id: `${entry.truceId}:${s}`, name: entry.evening[s], imageUrl: null }));
  return { truceId, at: entry.at, picks, earlier: entry.earlier, namesOnly: true };
}

/* ---------- Loved ---------- */

export interface LovedItem {
  pick: PlanPick;
  /** The latest evening it was loved on: the tile opens it. */
  truceId: string;
  pairId: string;
  /** Everyone who loved it, across evenings, in the order they did. */
  by: string[];
  /** How many evenings it was loved on. */
  evenings: number;
  at: string;
}

/**
 * Picks people loved in check-ins sent from this browser, per slot, newest
 * first: one tile per item, naming everyone who loved it and opening the
 * latest evening it was loved on.
 */
export function lovedShelf(memory: Memory): Record<Slot, LovedItem[]> {
  const groups = new Map<string, GroupMemo>(memory.groups.map((g) => [g.pairId, g]));
  const byItem = new Map<string, LovedItem & { truces: Set<string> }>();
  const loved = (f: FeedbackMemo) => (f.went ? f.picks.filter((p) => f.ratings[p.slot] === 'loved') : []);
  // Oldest first, so the newest evening wins the link.
  const feedback = [...memory.feedback].sort((a, b) => a.at.localeCompare(b.at));
  for (const f of feedback) {
    const g = groups.get(f.pairId);
    const who = g ? nameOf(g.names, f.side) : '';
    for (const pick of loved(f)) {
      const key = `${pick.slot}:${pick.id}`;
      const item = byItem.get(key) ?? { pick, truceId: f.truceId, pairId: f.pairId, by: [], evenings: 0, at: f.at, truces: new Set<string>() };
      if (who && !item.by.includes(who)) item.by.push(who);
      item.truces.add(f.truceId);
      Object.assign(item, { truceId: f.truceId, pairId: f.pairId, at: f.at, pick, evenings: item.truces.size });
      byItem.set(key, item);
    }
  }
  const shelf: Record<Slot, LovedItem[]> = { film: [], restaurant: [], music: [] };
  for (const { truces: _, ...item } of byItem.values()) shelf[item.pick.slot].push(item);
  for (const s of SLOTS) shelf[s].sort((a, b) => b.at.localeCompare(a.at));
  return shelf;
}
