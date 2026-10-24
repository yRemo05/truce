import type { Side, Slot, SwapReason, SwapsView } from '@contract';
import { useState, type FormEvent } from 'react';
import { useLocation } from 'wouter';
import { api } from '@/api';
import { Avatar, Button, Chip, ErrorNotice, Icon, Sheet, Thumb, type IconName } from '@/ui';
import { nameOf } from '@/lib/people';
import { isFact, KIND_ICON, REASONS, reasonLabel, replanLine, usedLine, voteRule } from '@/lib/swaps';
import { SLOT_LABEL, SLOT_NOUN } from '@/lib/truce';
import { useSwapCall, type Swaps } from '@/lib/useSwaps';
import { useTruceCtx } from './context';

/** What the sheet asks for: one item swapped, or the evening planned again. */
export type Ask = { kind: 'swap'; slot: Slot } | { kind: 'replan' };

interface SwapSheetProps {
  ask: Ask | null;
  swaps: Swaps;
  truceId: string;
  onClose: () => void;
}

/** "Why swap the film?" or "Plan tonight again?": who's asking, why, and in one line what happens next. */
export function SwapSheet({ ask, swaps, truceId, onClose }: SwapSheetProps) {
  const title = ask?.kind === 'swap' ? `Why swap the ${SLOT_NOUN[ask.slot]}?` : 'Plan tonight again?';
  return (
    <Sheet open={ask !== null} onClose={onClose} title={title} icon={KIND_ICON[ask?.kind ?? 'swap']}>
      {ask && swaps.view && <AskForm ask={ask} view={swaps.view} swaps={swaps} truceId={truceId} onClose={onClose} />}
    </Sheet>
  );
}

interface AskFormProps {
  ask: Ask;
  view: SwapsView;
  swaps: Swaps;
  truceId: string;
  onClose: () => void;
}

function AskForm({ ask, view, swaps, truceId, onClose }: AskFormProps) {
  const { members, names, letters, mine, items } = useTruceCtx();
  const [, navigate] = useLocation();
  const [side, setSide] = useState<Side | null>(mine);
  const [reason, setReason] = useState<SwapReason | null>(null);
  const call = useSwapCall(swaps);
  const item = ask.kind === 'swap' && view.bundle ? items[view.bundle[ask.slot]] : undefined;

  const tasteUsed = side !== null && !view.canAsk[side];
  // Choosing someone who has used their taste swap takes back a taste reason.
  const choose = (s: Side) => {
    setSide(s);
    if (reason && !isFact(reason) && !view.canAsk[s]) setReason(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!side) return;
    if (ask.kind === 'swap') {
      if (!reason) return;
      if (await call.run('ask', () => api.askSwap(truceId, { kind: 'swap', side, slot: ask.slot, reason }))) onClose();
      return;
    }
    const next = await call.run('ask', () => api.askSwap(truceId, { kind: 'replan', side }));
    if (!next) return;
    const asked = next.swaps.findLast((s) => s.kind === 'replan' && s.side === side);
    if (asked?.status === 'replanned' && asked.truceId) navigate(`/t/${asked.truceId}`);
    else onClose();
  };

  // Every swap asks the others; only a replan nothing else can solve starts at once.
  const instant = ask.kind === 'replan' && view.replanNow;
  const other = members.length === 2 && side ? members.find((s) => s !== side) : undefined;
  const submitLabel = instant ? 'Plan again' : other ? `Ask ${nameOf(names, other)}` : 'Ask the group';
  const submitIcon: IconName = instant ? KIND_ICON.replan : 'users';
  const whatNext = (): { icon: IconName; text: string } | null => {
    if (ask.kind === 'swap' && reason === null) return null;
    if (instant) return { icon: 'retry', text: 'Starts now, because what can’t happen has nothing to replace it.' };
    const fact = ask.kind === 'swap' && reason !== null && isFact(reason);
    return { icon: 'users', text: voteRule(ask.kind, side, members, names, view.needed, view.voteMinutes, fact) };
  };
  const next = whatNext();

  return (
    <form className="ask" onSubmit={submit}>
      {item && (
        <div className="ask__item">
          <Thumb name={item.name} imageUrl={item.imageUrl} slot={item.slot} />
          <span className="ask__item-text">
            <span className="ask__item-name">{item.name}</span>
            <span className="small muted">{SLOT_LABEL[item.slot]} in tonight’s plan</span>
          </span>
        </div>
      )}
      {ask.kind === 'replan' && <p className="small">{replanLine(view)}</p>}

      {mine === null && (
        <fieldset className="ask__group">
          <legend className="ask__legend">Who’s asking?</legend>
          <div className="ask__chips">
            {members.map((s) => (
              <Chip key={s} pressed={side === s} onClick={() => choose(s)}>
                <Avatar side={s} letters={nameOf(letters, s)} size="sm" />
                {nameOf(names, s)}
              </Chip>
            ))}
          </div>
        </fieldset>
      )}

      {ask.kind === 'swap' && (
        <fieldset className="ask__group">
          <legend className={mine === null ? 'ask__legend' : 'visually-hidden'}>Why?</legend>
          <div className="ask__chips">
            {REASONS[ask.slot].map((r) => (
              <Chip key={r} pressed={reason === r} disabled={!isFact(r) && tasteUsed} onClick={() => setReason(r)}>
                {reasonLabel(ask.slot, r)}
              </Chip>
            ))}
          </div>
          {tasteUsed && side && (
            <p className="ask__note icon-line icon-line--text small muted">
              <Icon name="ban" size={16} />
              <span>{usedLine(side, mine, names)} Something that can’t happen can still go to {other ? nameOf(names, other) : 'the group'}.</span>
            </p>
          )}
        </fieldset>
      )}

      <p className="ask__next icon-line icon-line--text small" aria-live="polite">
        {next ? (
          <>
            <Icon name={next.icon} size={16} className="ask__next-icon" />
            <span>{next.text}</span>
          </>
        ) : (
          <span className="muted">Pick a reason to see what happens.</span>
        )}
      </p>

      {call.error && <ErrorNotice error={call.error} title="Couldn’t send the request" />}

      <div className="ask__actions">
        <Button variant="ghost" icon="x" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" icon={submitIcon} busy={call.busy === 'ask'} disabled={!side || (ask.kind === 'swap' && !reason)}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
