/*
 * The hero's moving picture: two agents' messages arriving one by one, then
 * the evening they settle on as three pictures. It opens on the finished
 * frame (what a screenshot or a reduced-motion visitor sees) and holds it
 * for 12 seconds, then plays the talk again as one continuous chat: a
 * "from the top" note and the messages arrive below the last plan, which
 * scrolls up and away, so the window is never empty. Off screen, in a hidden
 * tab or when paused it stops, and it resumes from the same frame with the
 * time that frame had left.
 *
 * The messages are the couple demo's recorded run when there is one (its
 * first two and last two), else the synthetic script. The moving feed is
 * hidden from screen readers; a plain summary stands in for it.
 */
import type { Side } from '@contract';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
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

/** How long the finished frame holds: the plan with its pictures, long enough to read and to screenshot. */
const HOLD_MS = 12_000;

/** The loop as frames: a beat after the restart note, typing before each message, time to read it, a long hold on the plan. */
function framesOf(entries: Entry[]): Frame[] {
  const frames: Frame[] = [{ shown: 0, typing: null, ms: 900 }];
  entries.forEach((e, i) => {
    if (e.kind === 'move') {
      frames.push({ shown: i, typing: e.move.side, ms: 1100 });
      frames.push({ shown: i + 1, typing: null, ms: Math.min(3600, 1200 + e.move.message.length * 14) });
    } else frames.push({ shown: i + 1, typing: null, ms: e.kind === 'plan' ? HOLD_MS : 700 });
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

/** Where the loop is: which pass through the talk, and which frame of it. */
interface Pos {
  cycle: number;
  index: number;
}

/**
 * Plays the frames: each waits its time, then the next. Stopping keeps the
 * frame and remembers what was left of its time, so a resume carries on
 * rather than starting the frame (or the loop) over.
 */
function useLoop(frames: Frame[], running: boolean): Pos {
  // The first pass opens on its finished frame.
  const [pos, setPos] = useState<Pos>({ cycle: 0, index: -1 });
  const left = useRef<number | null>(null);
  const index = pos.index < 0 || pos.index >= frames.length ? frames.length - 1 : pos.index;
  const ms = frames[index]?.ms ?? 0;

  useEffect(() => {
    if (!running || !frames.length) return;
    const wait = left.current ?? ms;
    const start = performance.now();
    let fired = false;
    const timer = setTimeout(() => {
      fired = true;
      left.current = null;
      setPos((p) => (index + 1 < frames.length ? { cycle: p.cycle, index: index + 1 } : { cycle: p.cycle + 1, index: 0 }));
    }, wait);
    return () => {
      clearTimeout(timer);
      if (!fired) left.current = Math.max(0, wait - (performance.now() - start));
    };
  }, [running, index, ms, frames.length]);

  return { cycle: pos.cycle, index };
}

/**
 * Bottom-anchored, a new message pushes everything above it up at once. This
 * eases that push: it finds how far the last item of the previous frame
 * moved up, starts the list that far down, and lets it glide into place.
 * Items carry `data-k`; the typing row doesn't, so it never anchors.
 */
function useGlide(ref: RefObject<HTMLDivElement | null>, step: string, on: boolean) {
  const anchor = useRef<{ k: string; d: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fromBottom = (n: HTMLElement) => el.offsetHeight - (n.offsetTop + n.offsetHeight);
    const prev = anchor.current;
    if (on && prev) {
      const node = el.querySelector<HTMLElement>(`[data-k="${prev.k}"]`);
      const moved = node ? fromBottom(node) - prev.d : 0;
      if (moved > 0 && moved < 1000) {
        el.style.transition = 'none';
        el.style.transform = `translateY(${moved}px)`;
        void el.offsetHeight;
        el.style.transition = 'transform 520ms var(--ease-out)';
        el.style.transform = '';
      }
    }
    const items = el.querySelectorAll<HTMLElement>('[data-k]');
    const last = items[items.length - 1];
    anchor.current = last ? { k: last.dataset.k!, d: fromBottom(last) } : null;
  }, [ref, step, on]);
}

export function Negotiation({ story }: { story: Story | null }) {
  const ref = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const onScreen = useOnScreen(ref);
  const [paused, setPaused] = useState(false);
  const entries = useMemo(() => (story ? entriesOf(story.moves) : []), [story]);
  const frames = useMemo(() => framesOf(entries), [entries]);
  const running = Boolean(story) && !reduce && !paused && onScreen;
  const { cycle, index } = useLoop(frames, running);
  const frame = frames[index]!;
  useGlide(list, `${cycle}-${index}`, !reduce);

  const entry = (e: Entry): ReactNode =>
    !story ? null : e.kind === 'move' ? (
      <Bubble move={e.move} first={e.first} story={story} />
    ) : e.kind === 'gap' ? (
      <p className="l-demo__gap enter">
        <span className="sys-pill">
          <Icon name="exchange" size={16} className="sys-pill__icon" />
          More offers back and forth
        </span>
      </p>
    ) : (
      <div className="l-demo__deal enter">
        <p className="sys-pill sys-pill--deal">
          <Icon name={story.how === 'ruled' ? 'gavel' : 'check-circle'} size={16} className="sys-pill__icon" />
          <span className="sys-pill__text">
            <strong>{story.how === 'ruled' ? 'The referee ruled' : 'Both said yes'}</strong> · tonight&rsquo;s plan
          </span>
        </p>
        <PlanCards plan={story.plan} members={story.members} names={story.names} eager />
      </div>
    );
  const item = (key: string, body: ReactNode) => (
    <div key={key} className="l-demo__item" data-k={key}>
      {body}
    </div>
  );

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
          <div className="l-demo__scroll" ref={list}>
            {/* The pass before this one, whole, so the window stays full while this one plays. */}
            {cycle > 0 && entries.map((e, i) => item(`${cycle - 1}-${i}`, entry(e)))}
            {cycle > 0 &&
              item(
                `again-${cycle}`,
                <p className="l-demo__gap enter">
                  <span className="sys-pill">
                    <Icon name="retry" size={16} className="sys-pill__icon" />
                    Again, from the top
                  </span>
                </p>,
              )}
            {entries.slice(0, frame.shown).map((e, i) => item(`${cycle}-${i}`, entry(e)))}
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
        {story?.real ? 'Recorded run.' : 'Invented example.'}
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
