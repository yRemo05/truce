/**
 * Which person this browser filled in for a group, so the chat can put that
 * person's agent on the right, as "yours". A convenience for one viewer, kept
 * in localStorage; when it's unavailable everyone simply sits on the left.
 * A shared phone that filled in more than one person has no single "you".
 */
import type { Side } from '@contract';
import { isSide } from './people';

const SHARED = 'shared';
const key = (pairId: string) => `truce:mine:${pairId}`;

export function rememberSide(pairId: string, side: Side) {
  try {
    const was = localStorage.getItem(key(pairId));
    localStorage.setItem(key(pairId), was && was !== side ? SHARED : side);
  } catch {
    /* private mode or storage off: no "yours" in the chat */
  }
}

export function mySide(pairId: string): Side | null {
  try {
    const side = localStorage.getItem(key(pairId));
    return side && isSide(side) ? side : null;
  } catch {
    return null;
  }
}
