import type { Side, SwapView } from '@contract';
import type { ReactNode } from 'react';
import { useLocation } from 'wouter';
import { api } from '@/api';
import { Badge, Button, cx, ErrorNotice, Icon, InfoTip, Notice, PersonRow, SectionHeader, type IconName } from '@/ui';
import { EXPLAIN } from '@/lib/glossary';
import { nameOf, possessive, type Names } from '@/lib/people';
import { askedLine, canVote, isFact, KIND_ICON, pendingOf, replanLine, thenAgents, timeLeft, yesCount, type Asked } from '@/lib/swaps';
import { SLOT_ICON } from '@/lib/truce';
import { useNow } from '@/lib/useNow';
import { useSwapCall, type Swaps } from '@/lib/useSwaps';
import { useTruceCtx } from './context';

type Vote = 'yes' | 'no';

/** One answer, worded for what is being asked: its button, its short form on a row, and how it reads back once cast. */
interface Answer {
  label: string;
  short: string;
  icon: IconName;
  said: string;
}

function answersFor(swap: SwapView, keep: string | undefined): { question: string } & Record<Vote, Answer> {
  if (swap.kind === 'replan' || !swap.slot) {
    return {
      question: 'Are you OK with planning again?',
      yes: { label: 'Plan again', short: 'OK', icon: KIND_ICON.replan, said: 'You’re OK with planning again.' },
      no: { label: 'Keep tonight’s plan', short: 'Keep', icon: 'calendar', said: 'You’d keep tonight’s plan.' },
    };
  }
  if (swap.reason && isFact(swap.reason)) {
    return {
      question: `Is ${keep ?? 'it'} really off tonight?`,
      yes: { label: 'OK, swap it', short: 'OK', icon: KIND_ICON.swap, said: 'You’re OK with swapping it.' },
      no: { label: `Keep ${keep ?? 'it'}`, short: 'Keep', icon: SLOT_ICON[swap.slot], said: `You’d keep ${keep ?? 'it'}.` },
    };
  }
  return {
    question: 'Are you OK with an alternative?',
    yes: { label: 'OK with an alternative', short: 'OK', icon: KIND_ICON.swap, said: 'You’re OK with an alternative.' },
    no: { label: `Keep ${keep ?? 'it'}`, short: 'Keep', icon: SLOT_ICON[swap.slot], said: `You’d keep ${keep ?? 'it'}.` },
  };
}

const ANSWER: Record<'yes' | 'no' | 'waiting', { icon: IconName; label: string }> = {
  yes: { icon: 'check', label: 'OK' },
  no: { icon: 'x', label: 'keep' },
  waiting: { icon: 'hourglass', label: 'waiting' },
};

/**
 * How far the vote has got: "2 of 3 needed", then everyone with their answer
 * (✓ OK, ✕ keep, ⧗ waiting), then the time left before the agents answer.
 * No dot separators, so a phone can wrap it anywhere.
 */
function Tally({ swap }: { swap: SwapView }) {
  const { members, names } = useTruceCtx();
  const now = useNow(swap.deadline !== null);
  const pending = pendingOf(swap, members);
  const left = swap.deadline ? timeLeft(swap.deadline, now) : null;
  return (
    <div className="tally">
      <p className="tally__votes small" aria-live="polite">
        <strong className="num">
          {yesCount(swap)} of {swap.needed} needed
        </strong>
        {members.map((s) => {
          const answer = swap.votes[s]?.vote ?? 'waiting';
          return (
            <span key={s} className={cx('tally__who', `tally__who--${answer}`)}>
              {nameOf(names, s)}
              <Icon name={ANSWER[answer].icon} size={16} label={ANSWER[answer].label} />
            </span>
          );
        })}
      </p>
      {pending.length > 0 && swap.deadline && (
        <p className="icon-line icon-line--text small muted num">
          <Icon name="clock" size={16} />
          {left ? `${left}, ${thenAgents(pending, names)}.` : 'Time’s up. The agents are answering now.'}
        </p>
      )}
    </div>
  );
}

interface VoteCardProps {
  swap: SwapView;
  swaps: Swaps;
  truceId: string;
}

/**
 * An open request, at the top of Decision: who asked and why, the question,
 * the answers, and how far the vote has got. With a remembered "me", only
 * that person's answer; with none (a shared phone, a guest, a demo), one
 * compact row per person still to answer, so anyone can play everyone.
 */
export function VoteCard({ swap, swaps, truceId }: VoteCardProps) {
  const { members, names, letters, mine, items } = useTruceCtx();
  const call = useSwapCall(swaps);
  const [, navigate] = useLocation();
  const view = swaps.view!;
  const pending = pendingOf(swap, members);
  const keep = swap.from?.name ?? (swap.slot && view.bundle ? items[view.bundle[swap.slot]]?.name : undefined);
  const a = answersFor(swap, keep);
  const asker = nameOf(names, swap.side);
  const busy = call.busy !== null;
  const vote = async (side: Side, v: Vote) => {
    const next = await call.run(`${side}:${v}`, () => api.vote(truceId, swap.id, side, v));
    const settled = next?.swaps.find((s) => s.id === swap.id);
    if (settled?.status === 'replanned' && settled.truceId) navigate(`/t/${settled.truceId}`);
  };

  const answers = (side: Side, compact: boolean) =>
    (['yes', 'no'] as const).map((v) => (
      <Button
        key={v}
        size={compact ? 'sm' : 'md'}
        icon={a[v].icon}
        busy={call.busy === `${side}:${v}`}
        disabled={busy}
        aria-label={compact ? `${nameOf(names, side)}: ${a[v].label}` : undefined}
        onClick={() => void vote(side, v)}
      >
        {compact ? a[v].short : a[v].label}
      </Button>
    ));

  const myVote = mine ? swap.votes[mine] : undefined;
  let ask: ReactNode = null;
  if (mine === null) {
    ask = (
      <ul className="people">
        {pending.map((s) => (
          <PersonRow
            key={s}
            side={s}
            letters={nameOf(letters, s)}
            name={nameOf(names, s)}
            status={
              <Badge variant="secondary" icon="hourglass">
                Waiting
              </Badge>
            }
            actions={answers(s, true)}
          />
        ))}
      </ul>
    );
  } else if (pending.includes(mine)) {
    ask = <div className="vote-card__answers">{answers(mine, false)}</div>;
  } else if (myVote && mine !== swap.side) {
    ask = (
      <p className="vote-card__mine icon-line small">
        <Icon name={myVote.vote === 'yes' ? 'check' : 'x'} size={16} />
        {a[myVote.vote].said}
      </p>
    );
  }
  // The question shows wherever someone here can still answer it.
  const asking = mine === null || pending.includes(mine);

  return (
    <section className="card vote-card enter" aria-labelledby="vote-title">
      <SectionHeader
        icon={KIND_ICON[swap.kind]}
        id="vote-title"
        title={askedLine(swap, names)}
        meta={
          swap.kind === 'swap' && swap.reason && isFact(swap.reason) ? (
            'If it can’t happen, it has to change: the referee picks the fairest replacement, and the ledger makes up any loss.'
          ) : swap.kind === 'swap' ? (
            <>
              Whatever replaces it, you won’t end up below your minimum. <InfoTip label="What your minimum is">{EXPLAIN.floor}</InfoTip>
            </>
          ) : (
            replanLine(view)
          )
        }
      />
      {ask && (
        <div className="vote-card__ask">
          {asking && <p className="vote-card__q">{a.question}</p>}
          {ask}
        </div>
      )}
      <div className="vote-card__foot">
        <Tally swap={swap} />
        {(mine === null || mine === swap.side) && (
          <Button
            size="sm"
            variant="ghost"
            icon="x"
            busy={call.busy === 'cancel'}
            disabled={busy}
            aria-label={mine === null ? `Withdraw ${possessive(asker)} request` : 'Withdraw your request'}
            onClick={() => void call.run('cancel', () => api.cancelSwap(truceId, swap.id, swap.side))}
          >
            Withdraw
          </Button>
        )}
      </div>
      {call.error && <ErrorNotice error={call.error} title="Couldn’t send that" />}
    </section>
  );
}

/** An open request in one line: on the truce's other tabs, and on the group page. */
export function SwapBanner({ swap, names, action, children }: { swap: Asked; names: Names; action: ReactNode; children?: ReactNode }) {
  return (
    <Notice icon={KIND_ICON[swap.kind]} title={askedLine(swap, names)} action={action}>
      {children}
    </Notice>
  );
}

/** The truce page's banner, on the tabs other than Decision. */
export function VoteBanner({ swap, onOpen }: { swap: SwapView; onOpen: () => void }) {
  const { members, names, mine } = useTruceCtx();
  return (
    <SwapBanner
      swap={swap}
      names={names}
      action={
        <Button size="sm" iconEnd="arrow-right" onClick={onOpen}>
          {canVote({ waiting: pendingOf(swap, members) }, mine) ? 'Vote' : 'See the vote'}
        </Button>
      }
    />
  );
}
