import type { PairView } from '@contract';
import { Avatar, Badge, Button, ButtonLink, ErrorNotice, Icon, InfoTip, PairNames, Poster, Skeleton, StageStrip } from '@/ui';
import type { GroupMemo, Memory } from '@/lib/evenings';
import { dayMonth, timeAgo } from '@/lib/format';
import { EXPLAIN } from '@/lib/glossary';
import { groupNames, modeLabel, monograms, nameOf } from '@/lib/people';
import { SLOTS } from '@/lib/truce';
import { lastPlanOf, STAGES, stageOf, statusOf } from './derive';
import { LedgerChart } from './LedgerChart';
import type { PairLoad } from './usePairs';

interface GroupCardProps {
  memo: GroupMemo;
  load: PairLoad | undefined;
  memory: Memory;
  onRetry: () => void;
  onForget: () => void;
}

/**
 * One remembered group: who and where, where its evening is, its last plan
 * as pictures, and its fairness ledger as a chart. The header comes from
 * this browser's memory, so it shows at once; the rest waits for the server.
 */
export function GroupCard({ memo, load, memory, onRetry, onForget }: GroupCardProps) {
  // The server's names and place win once loaded; the memory's until then.
  const pair = load?.status === 'ok' ? load.pair : null;
  const names = pair?.names ?? memo.names;
  const members = pair?.members ?? memo.members;
  const letters = monograms(names, members);
  const id = `group-${memo.pairId}`;
  const label = groupNames(names, members);

  return (
    <article className="card group" aria-labelledby={`${id}-title`}>
      <header className="group__head">
        <span className="group__faces" aria-hidden="true">
          {members.map((s) => (
            <Avatar key={s} side={s} letters={nameOf(letters, s)} />
          ))}
        </span>
        <div className="group__who">
          <h3 id={`${id}-title`} className="group__title">
            <PairNames names={names} members={members} />
          </h3>
          <p className="group__meta small muted">
            <span className="icon-line">
              <Icon name="pin" size={16} />
              {pair?.location ?? memo.location}
            </span>
            <span aria-hidden="true">·</span>
            <span>{modeLabel(memo.mode)}</span>
            <span aria-hidden="true">·</span>
            <span>Seen {timeAgo(memo.seenAt)}</span>
            {memo.demo && (
              <Badge variant="outline" icon="play">
                Demo
              </Badge>
            )}
          </p>
        </div>
        <div className="group__actions">
          <ButtonLink size="sm" iconEnd="arrow-right" href={`/p/${memo.pairId}`} aria-label={`Open ${label}`}>
            Open
          </ButtonLink>
          <Button size="sm" variant="ghost" icon="trash" onClick={onForget} aria-label={`Forget ${label} in this browser`} className="btn--compact">
            Forget
          </Button>
        </div>
      </header>

      {load?.status === 'error' ? (
        <ErrorNotice error={load.error} title="Couldn't load this group" onRetry={onRetry} />
      ) : !pair ? (
        <GroupSkeleton rows={members.length} />
      ) : (
        <div className="group__body">
          <div className="group__now">
            <StageStrip stages={STAGES} current={stageOf(pair)} label="Where this evening is" />
            <StatusLine pair={pair} />
            <LastPlan pair={pair} memory={memory} id={id} />
          </div>
          <section className="group__ledger" aria-labelledby={`${id}-ledger`}>
            <h4 id={`${id}-ledger`} className="group__label">
              <Icon name="scale" size={16} />
              Fairness ledger
              <InfoTip label="What the fairness ledger does">{EXPLAIN.ledger}</InfoTip>
            </h4>
            <LedgerChart ledger={pair.ledger} names={pair.names} letters={letters} titleId={`${id}-ledger`} />
          </section>
        </div>
      )}
    </article>
  );
}

function StatusLine({ pair }: { pair: PairView }) {
  const { icon, text } = statusOf(pair);
  return (
    <p className="group__status icon-line icon-line--text small">
      <Icon name={icon} size={16} />
      <span>{text}</span>
    </p>
  );
}

function LastPlan({ pair, memory, id }: { pair: PairView; memory: Memory; id: string }) {
  const plan = lastPlanOf(pair, memory);
  return (
    <section className="group__plan" aria-labelledby={`${id}-plan`}>
      <h4 id={`${id}-plan`} className="group__label">
        <Icon name="calendar" size={16} />
        {plan?.earlier ? 'Last evening' : 'Last plan'}
        {plan?.at && <span className="muted group__label-meta">{dayMonth(plan.at)}</span>}
        {plan?.earlier && <Badge variant="outline">earlier (demo)</Badge>}
      </h4>
      {plan ? (
        <ul className="group__posters">
          {SLOTS.map((slot) => {
            const p = plan.picks.find((x) => x.slot === slot);
            return (
              p && (
                <li key={slot}>
                  <Poster slot={slot} name={p.name} imageUrl={p.imageUrl} href={plan.earlier ? undefined : `/t/${plan.truceId}?tab=decision`} />
                </li>
              )
            );
          })}
        </ul>
      ) : (
        <p className="small muted">No plan yet. It shows here once the agents agree.</p>
      )}
    </section>
  );
}

/** The loaded card's shape, while the server answers. */
function GroupSkeleton({ rows }: { rows: number }) {
  return (
    <div className="group__body" aria-hidden="true">
      <div className="group__now">
        <Skeleton h="1.75rem" />
        <Skeleton w="70%" h="1rem" delay={60} />
        <div className="group__posters">
          {[0, 1, 2].map((i) => (
            <span key={i} className="poster">
              <span className="thumb thumb--fill skeleton" />
              <Skeleton w="80%" h="0.875rem" delay={i * 60} />
            </span>
          ))}
        </div>
      </div>
      <div className="group__ledger">
        <Skeleton w="9rem" h="1rem" />
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} h="1.75rem" delay={80 + i * 60} />
        ))}
        <Skeleton w="60%" h="0.875rem" delay={200} />
      </div>
    </div>
  );
}
