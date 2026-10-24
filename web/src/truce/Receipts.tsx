/*
 * Qloo receipts, on the Research tab: every call the truce made to Qloo.
 *
 * Inventory, by priority:
 *   primary   — one request and what came back: the call (endpoint, key parameters) and the top three
 *               results with Qloo's affinity and the favourites behind it (the provenance)
 *   secondary — the totals in one line: calls, from cache, Qloo time
 *   secondary — every call by phase, each group collapsed with its count; a call opens to its
 *               endpoint and parameters in monospace
 *   rare      — while running: the list grows, the example waits for scoring; old truces: nothing
 *
 * Icons: data (Qloo), chevron-right (open a group or a call), clock (time).
 */
import type { QlooCall, ReceiptsView } from '@contract';
import { Badge, ErrorNotice, Icon, InfoTip, SectionHeader, Spinner } from '@/ui';
import { EXPLAIN } from '@/lib/glossary';
import { listNames, nameOf, possessive } from '@/lib/people';
import { SLOT_NOUN } from '@/lib/truce';
import { useReceipts } from '@/lib/useReceipts';
import { useTruceCtx } from './context';

const PHASES: { phase: QlooCall['phase']; label: string }[] = [
  { phase: 'gathering', label: 'Gathering options' },
  { phase: 'scouting', label: 'Agents scouting' },
  { phase: 'scoring', label: 'Scoring the options' },
];

/** "412 ms", "1.2 s". */
const duration = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "34 calls · 12 from cache · 9.2 s of Qloo time". */
const totalsLine = ({ calls, cached, ms }: ReceiptsView['totals']) =>
  [plural(calls, 'call'), cached > 0 && `${cached} from cache`, `${duration(ms)} of Qloo time`].filter(Boolean).join(' · ');

/** The server keeps a parameter's first 400 characters; a value that long was cut there. */
const MAX_VALUE = 400;
const cut = (value: string) => value.length >= MAX_VALUE;

/** A long list of ids, cut to the start of its first: "900B6C69…, … (11 in all)", or "(10+ in all)" when the server cut the list. */
function shortValue(value: string): { text: string; all: string | null } {
  const parts = value.split(',');
  if (parts.length < 3) return { text: value, all: null };
  return { text: `${parts[0]!.slice(0, 8)}…, …`, all: cut(value) ? `${parts.length - 1}+` : String(parts.length) };
}

/** A call's parameters, one per line in monospace; long id lists wrap, or are cut to their first when `short`. */
function Params({ params, short = false }: { params: Record<string, string>; short?: boolean }) {
  return (
    <dl className="params">
      {Object.entries(params).map(([key, value]) => {
        const shown = short ? shortValue(value) : { text: cut(value) ? `${value}…` : value, all: null };
        return (
          <div key={key} className="params__row">
            <dt>{key}</dt>
            <dd>
              {shown.text}
              {shown.all !== null && <span className="params__all"> ({shown.all} in all)</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** One call: what it asked in plain words, how many came back, from cache or not, how long; opens to the request itself. */
function Call({ call }: { call: QlooCall }) {
  return (
    <li>
      <details className="rcall">
        <summary className="rcall__head">
          <Icon name="chevron-right" size={16} className="rcall__chevron" />
          <span className="rcall__what">{call.what}</span>
          <span className="rcall__meta">
            {call.cached && <Badge variant="outline">cached</Badge>}
            <span className="num">{call.results === null ? 'failed' : plural(call.results, 'result')}</span>
            <span className="num rcall__ms">{duration(call.ms)}</span>
          </span>
        </summary>
        <div className="rcall__body">
          <p className="mono">GET {call.endpoint}</p>
          <Params params={call.params} />
        </div>
      </details>
    </li>
  );
}

/** One phase's calls, collapsed to a count until opened. */
function PhaseGroup({ label, calls }: { label: string; calls: QlooCall[] }) {
  const cached = calls.filter((c) => c.cached).length;
  const ms = calls.reduce((t, c) => t + c.ms, 0);
  return (
    <details className="rgroup">
      <summary className="rgroup__head">
        <Icon name="chevron-right" size={16} className="rgroup__chevron" />
        <span className="rgroup__label">{label}</span>
        <span className="rgroup__meta small muted num">{[plural(calls.length, 'call'), cached > 0 && `${cached} cached`, duration(ms)].filter(Boolean).join(' · ')}</span>
      </summary>
      <ol className="rgroup__calls">
        {calls.map((call, i) => (
          <Call key={i} call={call} />
        ))}
      </ol>
    </details>
  );
}

/** The provenance: one scoring request as it went to Qloo, and the top three that came back with the favourites behind each. */
function Example({ example }: { example: NonNullable<ReceiptsView['example']> }) {
  const { names } = useTruceCtx();
  const name = nameOf(names, example.side);
  const { call, top } = example;
  return (
    <div className="receipt">
      <h3 className="receipt__title">One request, and what came back</h3>
      <p className="small muted">
        For {possessive(name)} {SLOT_NOUN[example.slot]} scores, Truce asked Qloo to {call.what.charAt(0).toLowerCase() + call.what.slice(1)}.
      </p>
      <div className="receipt__grid">
        <div className="receipt__part">
          <p className="receipt__label small">Request</p>
          <div className="receipt__req">
            <p className="mono">GET {call.endpoint}</p>
            <Params params={call.params} short />
          </div>
        </div>
        <div className="receipt__part">
          <p className="receipt__label small">
            What came back, top {top.length}
            <InfoTip label="What affinity is">{EXPLAIN.affinity}</InfoTip>
          </p>
          <ol className="receipt__top">
            {top.map((r) => (
              <li key={r.name} className="receipt__hit">
                <span className="receipt__name">{r.name}</span>
                <span className="receipt__affinity" role="img" aria-label={`Affinity ${r.affinity.toFixed(3)} of 1`}>
                  <span className="receipt__track" aria-hidden="true">
                    <span className="receipt__fill" style={{ transform: `scaleX(${Math.max(0, Math.min(1, r.affinity))})` }} />
                  </span>
                  {/* Three places: Qloo's top scores often differ only in the third. */}
                  <span className="num receipt__value" aria-hidden="true">
                    {r.affinity.toFixed(3)}
                  </span>
                </span>
                {r.because.length > 0 && <span className="receipt__because small muted">Because of {listNames(r.because)}</span>}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

/** Every Qloo call this truce made, with one of them opened up. Nothing for truces from before receipts were kept. */
export function Receipts({ truceId, phase, running }: { truceId: string; phase: string; running: boolean }) {
  const { view, error, reload } = useReceipts(truceId, phase, running);
  if (!view) return error && !running ? <ErrorNotice error={error} title="Couldn’t load the Qloo receipts" onRetry={reload} /> : null;
  if (view.calls.length === 0 && !running) return null;

  const groups = PHASES.map((p) => ({ ...p, calls: view.calls.filter((c) => c.phase === p.phase) })).filter((g) => g.calls.length > 0);
  return (
    <section className="card research__card receipts" aria-labelledby="receipts-title">
      <SectionHeader
        icon="data"
        id="receipts-title"
        title="Qloo receipts"
        info={<InfoTip label="What the Qloo receipts are">{EXPLAIN.receipts}</InfoTip>}
        meta={view.calls.length ? totalsLine(view.totals) : 'The first calls go out as the truce starts.'}
        actions={running ? <Spinner size={20} label="Still calling Qloo" /> : undefined}
      />
      {view.example ? (
        <Example example={view.example} />
      ) : (
        running && (
          <p className="icon-line small muted">
            <Icon name="clock" size={16} />
            One request and what came back shows here once the options are scored.
          </p>
        )
      )}
      {groups.length > 0 && (
        <div className="receipts__log">
          <h3 className="receipt__title">Every call</h3>
          <div className="receipts__groups">
            {groups.map((g) => (
              <PhaseGroup key={g.phase} label={g.label} calls={g.calls} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
