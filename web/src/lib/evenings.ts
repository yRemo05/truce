/**
 * My evenings: what this browser remembers about the groups it has opened,
 * kept in localStorage and nowhere else.
 *
 * - Groups: id, names, mode, place, demo kind and when they were last seen.
 *   Only ids and display names: the link is the key, so nothing secret is kept.
 * - Plans: each decided evening's three picks (name, picture, slot) by truce,
 *   so the dashboard needn't fetch event logs to show them.
 * - Feedback: a check-in sent from this browser, per person: their ratings
 *   with the picks' names and pictures, and what their agent learned.
 *
 * At most MAX_GROUPS groups, newest first, and one copy per demo kind (every
 * demo click makes a fresh copy). Forgetting a group forgets its plans and
 * feedback too. With storage off or full, the memory lives for this tab only.
 */
import type { CheckinInput, CheckinResult, Mode, PairView, PerSide, Rating, Seed, Side, Slot } from '@contract';
import { useSyncExternalStore } from 'react';
import { forgetSide, mySide, rememberSide } from './mine';

const KEY = 'truce:evenings:v1';
export const MAX_GROUPS = 20;
/** Plans kept per group, newest first: the dashboard shows the latest, the shelf links to the rest. */
const PLANS_PER_GROUP = 12;

export interface GroupMemo {
  pairId: string;
  mode: Mode;
  members: Side[];
  names: PerSide<string>;
  location: string;
  demo: PairView['demo'];
  /** ISO time this browser last opened the group. */
  seenAt: string;
}

export interface PlanPick {
  slot: Slot;
  id: string;
  name: string;
  imageUrl: string | null;
}

export interface PlanMemo {
  truceId: string;
  pairId: string;
  picks: PlanPick[];
  savedAt: string;
}

export interface FeedbackMemo {
  truceId: string;
  pairId: string;
  side: Side;
  went: boolean;
  ratings: Partial<Record<Slot, Rating>>;
  /** The evening's picks as rated, with their pictures. */
  picks: PlanPick[];
  /** What the agent learned: loved picks became favourites. */
  loved: Seed[];
  at: string;
}

export interface Memory {
  groups: GroupMemo[];
  plans: PlanMemo[];
  feedback: FeedbackMemo[];
}

/** One group's share of the memory, as forgetting removes it and Undo puts it back. */
export type GroupSlice = { group: GroupMemo; plans: PlanMemo[]; feedback: FeedbackMemo[]; mine: Side | null };

/** What a group page, a truce or a check-in knows about its group. */
export type GroupInfo = Pick<GroupMemo, 'pairId' | 'mode' | 'members' | 'names' | 'location' | 'demo'>;

const EMPTY: Memory = { groups: [], plans: [], feedback: [] };

/* ---------- The store: localStorage when it works, this tab's copy when it doesn't ---------- */

let tabCopy: string | null = null;
let storageOff = false;
let lastRaw: string | null | undefined;
let snapshot: Memory = EMPTY;
const listeners = new Set<() => void>();

function load(): string | null {
  if (storageOff) return tabCopy;
  try {
    return localStorage.getItem(KEY);
  } catch {
    storageOff = true;
    return tabCopy;
  }
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

/** Whatever was stored, kept only where it has the expected shape: storage is anyone's to edit. */
function parse(raw: string | null): Memory {
  if (!raw) return EMPTY;
  try {
    const data: unknown = JSON.parse(raw);
    if (!isObject(data)) return EMPTY;
    const list = <T>(x: unknown, ok: (y: Record<string, unknown>) => boolean) => (Array.isArray(x) ? (x.filter((y) => isObject(y) && ok(y)) as T[]) : []);
    return {
      groups: list<GroupMemo>(data.groups, (g) => typeof g.pairId === 'string' && Array.isArray(g.members) && isObject(g.names) && typeof g.seenAt === 'string'),
      plans: list<PlanMemo>(data.plans, (p) => typeof p.truceId === 'string' && typeof p.pairId === 'string' && Array.isArray(p.picks)),
      feedback: list<FeedbackMemo>(data.feedback, (f) => typeof f.truceId === 'string' && typeof f.side === 'string' && isObject(f.ratings) && Array.isArray(f.picks)),
    };
  } catch {
    return EMPTY;
  }
}

function read(): Memory {
  const raw = load();
  if (raw !== lastRaw) {
    lastRaw = raw;
    snapshot = parse(raw);
  }
  return snapshot;
}

function write(next: Memory) {
  const raw = JSON.stringify(next);
  tabCopy = raw;
  if (!storageOff) {
    try {
      localStorage.setItem(KEY, raw);
    } catch {
      // Private mode or full: keep going on this tab's copy.
      storageOff = true;
    }
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab remembered or forgot something.
  const other = (e: StorageEvent) => e.key === KEY && listener();
  window.addEventListener('storage', other);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', other);
  };
}

/** The memory, kept current as this tab or another one changes it. */
export function useEvenings(): Memory {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

/* ---------- Changes ---------- */

/** Keeps the plans and feedback of remembered groups only. */
function prune(m: Memory): Memory {
  const kept = new Set(m.groups.map((g) => g.pairId));
  const perGroup = new Map<string, number>();
  const plans = m.plans.filter((p) => {
    if (!kept.has(p.pairId)) return false;
    const n = (perGroup.get(p.pairId) ?? 0) + 1;
    perGroup.set(p.pairId, n);
    return n <= PLANS_PER_GROUP;
  });
  return { groups: m.groups, plans, feedback: m.feedback.filter((f) => kept.has(f.pairId)) };
}

const sameGroup = (a: GroupMemo, b: GroupInfo) =>
  a.mode === b.mode && a.location === b.location && a.demo === b.demo && JSON.stringify(a.names) === JSON.stringify(b.names) && a.members.join() === b.members.join();

/**
 * Remembers a group as seen now, first in the list. A demo copy replaces
 * any older copy of the same demo. `touch: false` adds a group not yet
 * remembered without moving one that is.
 */
export function rememberGroup(info: GroupInfo, { touch = true } = {}) {
  const m = read();
  const was = m.groups.find((g) => g.pairId === info.pairId);
  if (was && !touch) return;
  // A poll that brings nothing new, within the minute: no write.
  if (was && sameGroup(was, info) && m.groups[0] === was && Date.now() - Date.parse(was.seenAt) < 60_000) return;
  const group: GroupMemo = { ...info, members: [...info.members], names: { ...info.names }, seenAt: new Date().toISOString() };
  const others = m.groups.filter((g) => g.pairId !== info.pairId && !(info.demo && g.demo === info.demo));
  write(prune({ ...m, groups: [group, ...others].slice(0, MAX_GROUPS) }));
}

/** Saves a decided evening's picks; the latest version wins (a swap changes one). */
export function rememberPlan(truceId: string, pairId: string, picks: PlanPick[]) {
  const m = read();
  const was = m.plans.find((p) => p.truceId === truceId);
  if (was && JSON.stringify(was.picks) === JSON.stringify(picks)) return;
  const plan: PlanMemo = { truceId, pairId, picks, savedAt: was?.savedAt ?? new Date().toISOString() };
  write(prune({ ...m, plans: [plan, ...m.plans.filter((p) => p.truceId !== truceId)] }));
}

/** Saves how the evening went for one person, as sent from this browser; answering again replaces it. */
export function rememberCheckin(group: GroupInfo, truceId: string, side: Side, input: CheckinInput, picks: PlanPick[], learned: CheckinResult['learned']) {
  rememberGroup(group, { touch: false });
  const m = read();
  const entry: FeedbackMemo = {
    truceId,
    pairId: group.pairId,
    side,
    went: input.went,
    ratings: input.went ? { ...input.ratings } : {},
    picks,
    loved: learned.loved,
    at: new Date().toISOString(),
  };
  write(prune({ ...m, feedback: [entry, ...m.feedback.filter((f) => !(f.truceId === truceId && f.side === side))] }));
}

/** Forgets a group, its plans and its feedback, and which person this browser was in it. Returns what it removed, for Undo. */
export function forgetGroup(pairId: string): GroupSlice | null {
  const m = read();
  const group = m.groups.find((g) => g.pairId === pairId);
  if (!group) return null;
  const slice: GroupSlice = { group, plans: m.plans.filter((p) => p.pairId === pairId), feedback: m.feedback.filter((f) => f.pairId === pairId), mine: mySide(pairId) };
  write({ groups: m.groups.filter((g) => g !== group), plans: m.plans.filter((p) => p.pairId !== pairId), feedback: m.feedback.filter((f) => f.pairId !== pairId) });
  forgetSide(pairId);
  return slice;
}

/** Puts a forgotten group back where it was in the list (by when it was seen). */
export function restoreGroup(slice: GroupSlice) {
  const m = read();
  if (m.groups.some((g) => g.pairId === slice.group.pairId)) return;
  const groups = [...m.groups, slice.group].sort((a, b) => b.seenAt.localeCompare(a.seenAt)).slice(0, MAX_GROUPS);
  write(prune({ groups, plans: [...m.plans, ...slice.plans], feedback: [...m.feedback, ...slice.feedback] }));
  if (slice.mine) rememberSide(slice.group.pairId, slice.mine);
}

/** A group whose link no longer opens (a demo copy deleted after three days): gone without a word. */
export function dropGroup(pairId: string) {
  const m = read();
  if (!m.groups.some((g) => g.pairId === pairId)) return;
  write(prune({ ...m, groups: m.groups.filter((g) => g.pairId !== pairId) }));
  forgetSide(pairId);
}

/** A group's details as the memory keeps them, from a group page or a truce. */
export const groupInfo = (g: { mode: Mode; members: Side[]; names: PerSide<string>; location: string; demo: PairView['demo'] }, pairId: string): GroupInfo => ({
  pairId,
  mode: g.mode,
  members: g.members,
  names: g.names,
  location: g.location,
  demo: g.demo,
});
