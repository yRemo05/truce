/*
 * The hero's moving picture: two agents' messages arriving one by one, then
 * the evening they settle on as three pictures. It opens on the finished
 * frame (what a screenshot or a reduced-motion visitor sees), then replays
 * from the first message, holds on the plan and loops. It rests off screen,
 * in a hidden tab, and when paused.
 *
 * The messages are the couple demo's recorded run when there is one (its
 * first two and last two), else the synthetic script. The moving feed is
 * hidden from screen readers; a plain summary stands in for it.
 */
import type { Side } from '@contract';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, cx, Frost, Icon, Skeleton, Voice } from '@/ui';
import { agentOf, groupNames, nameOf } from '@/lib/people';
import { SLOT_LABEL, SLOTS } from '@/lib/truce';
import { useOnScreen, useReducedMotion } from './hooks';
import { PlanCards } from './PlanCards';
import type { Story } from './story';

type Move = Story['moves'][number];
type Entry = { kind: 'move'; move: Move; first: boolean } | { kind: 'gap' } | { kind: 'plan' };
interface Frame {
  shown: number;
  typing: Side | null;
  ms: number;
}

const SAID: Record<Move['action'], { text: string; icon: 'check' | 'x' | 'exchange'; tone: string }> = {
  accept: { text: 'Says yes', icon: 'check', tone: 'bubble__said--yes' },
  counter: { text: 'New offer', icon: 'exchange', tone: '' },
  declined: { text: 'Says no', icon: 'x', tone: 'bubble__said--no' },
};

/** The first two and last two messages, with a quiet marker where some were left out. */
function entriesOf(moves: Story['moves']): Entry[] {
  const picked: (Move | null)[] = moves.length > 4 ? [moves[0]!, moves[1]!, null, moves[moves.length - 2]!, moves[moves.length - 1]!] : moves;
  const out: Entry[] = [];
  let last: Side | null = null;
  for (const m of picked) {
    if (!m) {
      out.push({ kind: 'gap' });
      last = null;
      continue;
    }
    out.push({ kind: 'move', move: m, first: m.side !== last });
    last = m.side;
  }
  out.push({ kind: 'plan' });
  return out;
}

/** The loop as frames: a beat of typing before each message, time to read it, a long hold on the plan. */
function framesOf(entries: Entry[]): Frame[] {
  const frames: Frame[] = [{ shown: 0, typing: null, ms: 500 }];
  entries.forEach((e, i) => {
    if (e.kind === 'move') {
      frames.push({ shown: i, typing: e.move.side, ms: 1100 });
      frames.push({ shown: i + 1, typing: null, ms: Math.min(3600, 1200 + e.move.message.length * 14) });
    } else frames.push({ shown: i + 1, typing: null, ms: e.kind === 'plan' ? 8000 : 700 });
  });
  return frames;
}

function Bubble({ move, first, story }: { move: Move; first: boolean; story: Story }) {
  const said = SAID[move.action];
  return (
    <article className={cx('bubble-row bubble-row--in enter', first && 'is-first', `p-${move.side}`)}>
      <span className="bubble-row__avatar">{first && <Avatar side={move.side} letters={nameOf(story.letters, move.side)} size="sm" />}</span>
      <div className="bubble">
        {first && (
          <p className="bubble__who">
            <span className="bubble__name">{agentOf(nameOf(story.names, move.side))}</span>
            <Voice kind="agent" />
          </p>
        )}
        <p className="bubble__text">{move.message}</p>
        <p className="bubble__foot">
          <span className={cx('bubble__said', said.tone)}>
            <Icon name={said.icon} size={16} />
            {said.text}
          </span>
        </p>
      </div>
    </article>
  );
}

function Typing({ side, story }: { side: Side; story: Story }) {
  return (
    <div className={cx('bubble-row bubble-row--in bubble-row--typing is-first enter', `p-${side}`)}>
      <span className="bubble-row__avatar">
        <Avatar side={side} letters={nameOf(story.letters, side)} size="sm" />
      </span>
      <div className="bubble">
        <p className="typing">
          {agentOf(nameOf(story.names, side))} is typing
          <span className="typing__dots">
            <span />
            <span />
            <span />
          </span>
        </p>
      </div>
    </div>
  );
}

export function Negotiation({ story }: { story: Story | null }) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const onScreen = useOnScreen(ref);
  const [paused, setPaused] = useState(false);
  const entries = useMemo(() => (story ? entriesOf(story.moves) : []), [story]);
  const frames = useMemo(() => framesOf(entries), [entries]);
  // Start on the finished frame; the loop begins after its hold.
  const [at, setAt] = useState(-1);
  const index = at < 0 || at >= frames.length ? frames.length - 1 : at;
  const frame = frames[index]!;
  const running = Boolean(story) && !reduce && !paused && onScreen;

  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => setAt((index + 1) % frames.length), frame.ms);
    return () => clearTimeout(timer);
  }, [running, index, frame.ms, frames.length]);

  const status = frame.shown >= entries.length ? (story?.how === 'ruled' ? 'Referee’s ruling' : 'Agreed') : 'Negotiating';
  const done = status !== 'Negotiating';

  return (
    <figure ref={ref} className="l-demo" aria-labelledby="demo-caption">
      <Frost />
      <header className="l-demo__bar">
        {story ? (
          <>
            <span className="l-demo__people" aria-hidden="true">
              {story.members.map((s) => (
                <Avatar key={s} side={s} letters={nameOf(story.letters, s)} size="sm" />
              ))}
            </span>
            <span className="l-demo__who">
              <strong>{groupNames(story.names, story.members)}</strong>
              <span className="muted"> · {story.location}</span>
            </span>
          </>
        ) : (
          <Skeleton w="11rem" h="1rem" />
        )}
        <span className={cx('l-demo__status', done && 'is-done')} aria-hidden="true">
          <Icon name={done ? 'check-circle' : 'exchange'} size={16} />
          {status}
        </span>
        {!reduce && (
          <button
            type="button"
            className="btn btn--ghost btn--sm l-demo__pause"
            aria-pressed={paused}
            aria-label={paused ? 'Play the example negotiation' : 'Pause the example negotiation'}
            onClick={() => setPaused((p) => !p)}
          >
            <Icon name={paused ? 'play' : 'pause'} size={16} />
          </button>
        )}
      </header>

      <div className="l-demo__feed" aria-hidden="true">
        {story ? (
          <div className="l-demo__scroll" key={frame.shown === 0 ? 'start' : 'run'}>
            {entries.slice(0, frame.shown).map((e, i) =>
              e.kind === 'move' ? (
                <Bubble key={i} move={e.move} first={e.first} story={story} />
              ) : e.kind === 'gap' ? (
                <p key={i} className="l-demo__gap enter">
                  <span className="sys-pill">
                    <Icon name="exchange" size={16} className="sys-pill__icon" />
                    More offers back and forth
                  </span>
                </p>
              ) : (
                <div key={i} className="l-demo__deal enter">
                  <p className="sys-pill sys-pill--deal">
                    <Icon name={story.how === 'ruled' ? 'gavel' : 'check-circle'} size={16} className="sys-pill__icon" />
                    <span className="sys-pill__text">
                      <strong>{story.how === 'ruled' ? 'The referee ruled' : 'Both said yes'}</strong> · tonight&rsquo;s plan
                    </span>
                  </p>
                  <PlanCards plan={story.plan} members={story.members} names={story.names} eager />
                </div>
              ),
            )}
            {frame.typing && <Typing side={frame.typing} story={story} />}
          </div>
        ) : (
          <div className="l-demo__scroll">
            <div className="l-demo__skel-bubble">
              <Skeleton w="82%" h="5rem" />
            </div>
            <div className="l-demo__skel-bubble">
              <Skeleton w="64%" h="4rem" delay={120} />
            </div>
            <div className="l-plan l-demo__skel-plan">
              {SLOTS.map((s, i) => (
                <Skeleton key={s} h="100%" delay={200 + i * 80} />
              ))}
            </div>
          </div>
        )}
      </div>

      <figcaption id="demo-caption" className="l-demo__caption small muted">
        {story?.real ? 'The couple demo’s recorded run: the agents’ own messages and Qloo’s picks.' : 'An example negotiation, invented for this page.'}
        {story && (
          <span className="visually-hidden">
            {' '}
            {groupNames(story.names, story.members)}&rsquo;s agents traded offers and {story.how === 'ruled' ? 'the referee ruled' : 'agreed on'}:{' '}
            {SLOTS.map((s) => `${SLOT_LABEL[s]}: ${story.plan[s].name}`).join(', ')}.
          </span>
        )}
      </figcaption>
    </figure>
  );
}
