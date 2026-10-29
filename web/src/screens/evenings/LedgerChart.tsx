/*
 * The fairness ledger as a chart (dataviz method).
 *
 * Form: small multiples on one shared scale. One row per person (2–4), one
 * column per evening, oldest left; a column's bar is how far that evening
 * fell short of the person's own best (0–100). A separate panel on the
 * right, row-aligned, shows each person's share of the say next time
 * against the even share (a tick). Two measures, two panels: never one axis
 * for both.
 * Identity: the row (avatar and name on its left) carries the person; their
 * colour only supplements it. The owner's four person colours are muted on
 * purpose and fail a categorical palette's lightness and chroma checks, so
 * colour is never asked to tell people apart on its own.
 * Marks: 12 px bars (16 px when few evenings widen the columns) with a 4 px rounded top, square on a hairline baseline;
 * a zero still shows as a 2 px stub, so "no ground given" differs from "no
 * evening". A made-up earlier evening (demo groups) is an outlined bar, named
 * in the legend and the readout.
 * Interaction: hover, a tap, or the arrow keys on the focused plot pick an
 * evening; the readout line under the plot says its date, picks and every
 * person's number. It rests on the latest evening. The table under
 * "Show every evening" is the full text alternative.
 * Width: as many evenings as fit (28 px each, widening to 48 px when there
 * are few), newest kept; the rest are in the table.
 */
import type { LedgerView, Side } from '@contract';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Avatar, cx, InfoTip, pullSentence } from '@/ui';
import { dayMonth } from '@/lib/format';
import { EXPLAIN } from '@/lib/glossary';
import { listNames, nameOf, type Names } from '@/lib/people';
import { SLOTS } from '@/lib/truce';

/** A column per evening: at least this wide, and wider (up to MAX_COL) when few evenings leave room. */
const COL = 28;
const MAX_COL = 48;
const ROW = 44;
/** Room above a full bar, and under the baseline. */
const TOP = 8;
const FOOT = 6;
const RADIUS = 4;

/** A bar from the baseline up, rounded at its data end only. */
function barPath(x: number, base: number, w: number, h: number): string {
  const r = Math.min(RADIUS, h / 2, w / 2);
  const top = base - h;
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`;
}

const points = (c: number | undefined) => Math.round((c ?? 0) * 100);

interface LedgerChartProps {
  ledger: LedgerView;
  names: Names;
  letters: Names;
  /** The heading's id, for the figure's label. */
  titleId: string;
}

export function LedgerChart({ ledger, names, letters, titleId }: LedgerChartProps) {
  const { members, entries, alpha, tilt, owed } = ledger;
  const plotRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(6 * COL);
  const [active, setActive] = useState<number | null>(null);
  const readoutId = useId();

  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([e]) => setRoom(e?.contentRect.width ?? COL));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fit = Math.max(1, Math.floor(room / COL));
  const shown = entries.slice(-fit);
  const col = Math.max(COL, Math.min(MAX_COL, Math.floor(room / Math.max(shown.length, 1))));
  const bar = col >= 40 ? 16 : 12;
  const hidden = entries.length - shown.length;
  const at = active === null ? shown.length - 1 : Math.min(active, shown.length - 1);
  const pick = shown[at];
  const width = shown.length * col;
  const height = members.length * ROW;
  // One scale for every row: the largest shortfall shown, at least 25, rounded up to 5.
  const top = Math.max(25, Math.ceil(Math.max(0, ...shown.flatMap((e) => members.map((s) => points(e.concession[s])))) / 5) * 5);
  const even = 1 / members.length;
  const anyEarlier = entries.some((e) => e.earlier);

  const colAt = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(shown.length - 1, Math.floor((e.clientX - box.left) / col)));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = shown.length - 1;
    const next = e.key === 'ArrowLeft' ? at - 1 : e.key === 'ArrowRight' ? at + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (next === null) return;
    e.preventDefault();
    setActive(Math.max(0, Math.min(last, next)));
  };

  const readout = pick && (
    <>
      <span className="lchart__when">
        {dayMonth(pick.at)}
        {pick.earlier && ' (made-up earlier evening)'}
      </span>
      <span className="visually-hidden">: </span>
      <span className="lchart__what">{SLOTS.map((s) => pick.evening[s]).filter(Boolean).join(' · ')}</span>
      <span className="visually-hidden">. </span>
      <span className="lchart__values">Short of their best: {listNames(members.map((s) => `${nameOf(names, s)} ${points(pick.concession[s])}`))}</span>
    </>
  );

  return (
    <figure className="lchart" aria-labelledby={titleId}>
      <div className="lchart__grid" style={{ ['--row' as string]: `${ROW}px` }}>
        <span className="lchart__head small muted">
          Short of their best <InfoTip label="What short of their best means">{EXPLAIN.shortfall}</InfoTip>
        </span>
        <span className="lchart__head lchart__head--say small muted">
          Say next time <InfoTip label="What say next time means">{EXPLAIN.say}</InfoTip>
        </span>

        <ul className="lchart__names" aria-hidden="true">
          {members.map((s) => (
            <li key={s} className="lchart__name">
              <Avatar side={s} letters={nameOf(letters, s)} size="sm" />
              <span>{nameOf(names, s)}</span>
            </li>
          ))}
        </ul>

        <div ref={plotRef} className="lchart__plot">
          {entries.length === 0 ? (
            <p className="lchart__none small muted">No evenings yet. The ledger starts even.</p>
          ) : (
            <div
              className="lchart__focus"
              tabIndex={0}
              role="group"
              aria-label={`${entries.length} evening${entries.length > 1 ? 's' : ''}${hidden ? `, the latest ${shown.length} shown` : ''}. Left and right arrows read each one.`}
              aria-describedby={readoutId}
              onKeyDown={onKey}
            >
              <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" onPointerMove={(e) => setActive(colAt(e))} onPointerDown={(e) => setActive(colAt(e))} onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}>
                <rect className="lchart__band" x={at * col + 2} y={0} width={col - 4} height={height} rx={RADIUS} />
                {members.map((s, r) => {
                  const base = (r + 1) * ROW - FOOT;
                  return (
                    <g key={s} className={`p-${s}`}>
                      <line className="lchart__base" x1={0} x2={width} y1={base + 0.5} y2={base + 0.5} />
                      {shown.map((e, i) => {
                        const h = Math.max(2, (points(e.concession[s]) / top) * (ROW - TOP - FOOT));
                        return <path key={e.truceId} className={cx('lchart__bar', e.earlier && 'lchart__bar--earlier', i === at && 'is-on')} d={barPath(i * col + (col - bar) / 2, base, bar, h)} />;
                      })}
                    </g>
                  );
                })}
                <rect className="lchart__hit" x={0} y={0} width={width} height={height} />
              </svg>
              {/* The two ends when there's room for both, else the latest alone. */}
              <div className="lchart__axis small muted" aria-hidden="true" style={{ width: Math.max(width, 48) }}>
                {shown.length >= 4 && <span>{dayMonth(shown[0]!.at)}</span>}
                <span>{pick && dayMonth(shown[shown.length - 1]!.at)}</span>
              </div>
            </div>
          )}
        </div>

        <ul className="lchart__say" aria-label="Share of the say next time">
          {members.map((s) => {
            const share = alpha[s] ?? even;
            return (
              <li key={s} className={cx('lchart__share', owed === s && 'is-owed')}>
                <span className="visually-hidden">{nameOf(names, s)}: </span>
                <span className="lchart__track" aria-hidden="true">
                  <span className={cx('lchart__fill', `p-${s}`)} style={{ transform: `scaleX(${Math.min(1, share / (2 * even))})` }} />
                  <span className="lchart__even" />
                </span>
                <span className="num">{Math.round(share * 100)}%</span>
              </li>
            );
          })}
        </ul>
      </div>

      {pick && (
        <p id={readoutId} className="lchart__readout small" aria-live="polite">
          {readout}
        </p>
      )}
      <p className="lchart__caption small">{pullSentence(tilt, owed, names, members, 'next')}</p>
      {(anyEarlier || hidden > 0) && (
        <p className="lchart__legend small muted">
          {anyEarlier && (
            <span>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <rect x="1.75" y="0.75" width="8.5" height="10.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              Outlined: a made-up earlier evening (demo)
            </span>
          )}
          {hidden > 0 && <span>{hidden} older in the table</span>}
        </p>
      )}

      {entries.length > 0 && (
        <details className="lchart__table">
          <summary className="small">Show every evening</summary>
          <div className="lchart__scroll">
            <table className="small">
              <caption className="visually-hidden">How far each evening fell short of each person’s best, out of 100, oldest first</caption>
              <thead>
                <tr>
                  <th scope="col">Evening</th>
                  {members.map((s) => (
                    <th key={s} scope="col" className="num">
                      {nameOf(names, s)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.truceId}>
                    <th scope="row">
                      {dayMonth(e.at)}
                      {e.earlier && <span className="muted"> (earlier, demo)</span>}
                    </th>
                    {members.map((s: Side) => (
                      <td key={s} className="num">
                        {points(e.concession[s])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Say next time</th>
                  {members.map((s) => (
                    <td key={s} className="num">
                      {Math.round((alpha[s] ?? even) * 100)}%
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </details>
      )}
    </figure>
  );
}
