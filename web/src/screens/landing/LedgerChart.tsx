/*
 * The fairness ledger over a few evenings, illustrative: one couple, five
 * evenings and the next. Two panels on one shared x (never two y-scales on
 * one plot): the share of the say each person's agent had going in (lines,
 * 35–65%), and the ground each gave that evening (paired columns, points on
 * Truce's own scale). Read down a column, then across: whoever gave more
 * ground has more say the next evening.
 *
 * Colours are each person's own (teal, light neutral), always with the name
 * beside them. Hover or arrow keys pick an evening, and the readout under the
 * plot rests on the last one played; every value is also in the hidden table.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { cx } from '@/ui';
import type { Names } from '@/lib/people';

interface Evening {
  label: string;
  /** Each person's share of the say going in, in %. */
  say: Record<'a' | 'b', number>;
  /** Ground each gave that evening (their best evening minus what they got); none yet for the next one. */
  gave: Record<'a' | 'b', number> | null;
}

const EVENINGS: Evening[] = [
  { label: '1', say: { a: 50, b: 50 }, gave: { a: 38, b: 5 } },
  { label: '2', say: { a: 58, b: 42 }, gave: { a: 26, b: 9 } },
  { label: '3', say: { a: 64, b: 36 }, gave: { a: 4, b: 24 } },
  { label: '4', say: { a: 57, b: 43 }, gave: { a: 8, b: 19 } },
  { label: '5', say: { a: 51, b: 49 }, gave: { a: 21, b: 6 } },
  { label: 'Next', say: { a: 56, b: 44 }, gave: null },
];
/** Where the readout rests, so its numbers show before anyone touches the chart. */
const LAST_PLAYED = EVENINGS.findLastIndex((e) => e.gave !== null);
const SIDES: ('a' | 'b')[] = ['a', 'b'];

const H = 296;
const TOP = { y0: 26, y1: 128 };
const LOW = { y0: 176, y1: 252 };
const SAY = { min: 30, max: 70 };
const GAVE_MAX = 40;
const BAR = 12;

const evLabel = (e: Evening) => (e.label === 'Next' ? 'Next evening' : `Evening ${e.label}`);

export function LedgerChart({ names }: { names: Names }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const at = active ?? LAST_PLAYED;
  const name = (s: 'a' | 'b') => names[s] ?? s;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const narrow = w < 480;
  const ml = narrow ? 34 : 40;
  const mr = narrow ? 58 : 76;
  const band = (w - ml - mr) / EVENINGS.length;
  const cx_ = (i: number) => ml + band * (i + 0.5);
  const ySay = (v: number) => TOP.y1 - ((v - SAY.min) / (SAY.max - SAY.min)) * (TOP.y1 - TOP.y0);
  const yGave = (v: number) => LOW.y1 - (v / GAVE_MAX) * (LOW.y1 - LOW.y0);
  const line = (s: 'a' | 'b') => EVENINGS.map((e, i) => `${i ? 'L' : 'M'}${cx_(i).toFixed(1)} ${ySay(e.say[s]).toFixed(1)}`).join(' ');
  /** A column with a 4px rounded top, square on the baseline. */
  const column = (x: number, v: number) => {
    const y = yGave(v);
    const r = Math.min(4, (LOW.y1 - y) / 2, BAR / 2);
    return `M${x} ${LOW.y1}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + BAR - r}Q${x + BAR} ${y} ${x + BAR} ${y + r}V${LOW.y1}Z`;
  };

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - ml) / band);
    setActive(i >= 0 && i < EVENINGS.length ? i : null);
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const last = EVENINGS.length - 1;
    setActive(e.key === 'Home' ? 0 : e.key === 'End' ? last : e.key === 'ArrowRight' ? Math.min(last, at + 1) : Math.max(0, at - 1));
  };

  const shown = EVENINGS[at]!;
  const end = EVENINGS[EVENINGS.length - 1]!;
  const summary = `${name('a')} gave the most ground on evenings 1, 2 and 5, ${name('b')} on 3 and 4; each time, the one who gave more ground had more say the next evening.`;

  return (
    <div className="l-chart">
      <ul className="l-chart__legend small" aria-hidden="true">
        {SIDES.map((s) => (
          <li key={s} className={cx('scorerow__item', `p-${s}`)}>
            <span className="scorerow__dot" />
            {name(s)}
          </li>
        ))}
      </ul>
      <div
        ref={box}
        className="l-chart__plot"
        tabIndex={0}
        role="group"
        aria-label={`Fairness ledger chart. ${summary} Use the arrow keys to read each evening.`}
        onKeyDown={keys}
        onBlur={() => setActive(null)}
      >
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} aria-hidden="true" onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setActive(null)}>
          {/* The current evening's column, behind everything. */}
          <rect className="l-chart__band" x={ml + band * at + 2} y={8} width={band - 4} height={LOW.y1 - 8} rx={6} />

          <text className="l-chart__title" x={0} y={12}>
            Share of the say going in
          </text>
          {[35, 50, 65].map((v) => (
            <g key={v}>
              <line className={cx('l-chart__grid', v === 50 && 'is-mid')} x1={ml} x2={w - mr + 8} y1={ySay(v)} y2={ySay(v)} />
              <text className="l-chart__tick" x={ml - 6} y={ySay(v) + 4} textAnchor="end">
                {v}%
              </text>
            </g>
          ))}
          {SIDES.map((s) => (
            <g key={s} className={`p-${s}`}>
              <path className="l-chart__line" d={line(s)} pathLength={1} />
              {EVENINGS.map((e, i) => (
                <circle key={e.label} style={{ '--i': i } as CSSProperties} className="l-chart__dot" cx={cx_(i)} cy={ySay(e.say[s])} r={at === i ? 5 : 4} />
              ))}
            </g>
          ))}
          {/* Direct labels at the line ends, the larger share above. */}
          {SIDES.map((s) => (
            <text key={s} className="l-chart__end" x={cx_(EVENINGS.length - 1) + 10} y={ySay(end.say[s]) + (end.say[s] >= 50 ? -2 : 12)}>
              {narrow ? '' : `${name(s)} `}
              {end.say[s]}%
            </text>
          ))}

          <text className="l-chart__title" x={0} y={LOW.y0 - 18}>
            Ground given that evening
          </text>
          {[0, 20, 40].map((v) => (
            <g key={v}>
              <line className={cx('l-chart__grid', v === 0 && 'is-base')} x1={ml} x2={w - mr + 8} y1={yGave(v)} y2={yGave(v)} />
              <text className="l-chart__tick" x={ml - 6} y={yGave(v) + 4} textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {EVENINGS.map((e, i) =>
            e.gave ? (
              SIDES.map((s, k) => <path key={s} style={{ '--i': i } as CSSProperties} className={cx('l-chart__col', `p-${s}`)} d={column(cx_(i) - BAR - 1 + k * (BAR + 2), e.gave![s])} />)
            ) : (
              <text key={e.label} className="l-chart__tick" x={cx_(i)} y={LOW.y1 - 6} textAnchor="middle">
                to come
              </text>
            ),
          )}

          {EVENINGS.map((e, i) => (
            <text key={e.label} className={cx('l-chart__x', e.gave === null && 'is-next')} x={cx_(i)} y={H - 18} textAnchor="middle">
              {e.label}
            </text>
          ))}
          <text className="l-chart__tick" x={ml + (band * EVENINGS.length) / 2} y={H - 1} textAnchor="middle">
            Evening
          </text>
        </svg>

        <p className="l-chart__tip small" aria-live="polite">
          <strong>{evLabel(shown)}</strong>
          <span>
            Say going in: {name('a')} <b className="num">{shown.say.a}%</b>, {name('b')} <b className="num">{shown.say.b}%</b>
          </span>
          <span>
            {shown.gave ? (
              <>
                Ground given: {name('a')} <b className="num">{shown.gave.a}</b>, {name('b')} <b className="num">{shown.gave.b}</b>
              </>
            ) : (
              'Not played yet'
            )}
          </span>
        </p>
      </div>

      <div className="visually-hidden">
        <table>
          <caption>Fairness ledger, illustrative. {summary}</caption>
          <thead>
            <tr>
              <th scope="col">Evening</th>
              {SIDES.map((s) => (
                <th key={s} scope="col">
                  {name(s)}&rsquo;s say going in
                </th>
              ))}
              {SIDES.map((s) => (
                <th key={s} scope="col">
                  Ground {name(s)} gave
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {EVENINGS.map((e) => (
              <tr key={e.label}>
                <th scope="row">{evLabel(e)}</th>
                {SIDES.map((s) => (
                  <td key={s}>{e.say[s]}%</td>
                ))}
                {SIDES.map((s) => (
                  <td key={s}>{e.gave ? e.gave[s] : 'not yet'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
