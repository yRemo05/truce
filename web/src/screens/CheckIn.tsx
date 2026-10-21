/*
 * Next-day check-in (/truces/:truceId/checkin/:side).
 *
 * Inventory, by priority:
 *   primary   — Did you go? (Yes / We didn't go)
 *   secondary — if yes, each pick: Loved / Fine / Not for me (all optional)
 *   primary   — Send
 *   after     — what changed: the ledger in plain words, and what the agent learned
 *
 * Viewport budget: the question, the three picks and Send fit one screen at
 * 1440×900 and at 390×844. One narrow column (40rem): it's a short form.
 * Icons: check / x (went), heart / check / x (ratings), film / restaurant /
 * music (slots), scale (ledger), plus / ban (learned), arrow-right (back).
 */
import type { CardItem, CheckinResult, LedgerView, Rating, Side, Slot, StreamEvent, TruceView } from '@contract';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/api';
import { Avatar, Button, ButtonLink, Chip, ErrorNotice, Icon, InfoTip, LedgerMeter, Notice, Page, SectionHeader, Skeleton, Thumb, type IconName } from '@/ui';
import { EXPLAIN } from '@/lib/glossary';
import { monograms, nameOf, possessive, type Names } from '@/lib/people';
import { SLOT_ICON, SLOT_LABEL, SLOTS } from '@/lib/truce';
import { useAction } from '@/lib/useAction';
import { NotFound } from './NotFound';

const RATINGS: { value: Rating; label: string; icon: IconName }[] = [
  { value: 'loved', label: 'Loved', icon: 'heart' },
  { value: 'fine', label: 'Fine', icon: 'check' },
  { value: 'not_for_me', label: 'Not for me', icon: 'x' },
];

type Done = Extract<StreamEvent, { type: 'done' }>;

/** The evening's three picks, as the pool described them. */
function picksOf(view: TruceView): CardItem[] | null {
  const done = view.events.find((e): e is Done => e.type === 'done');
  const pool = view.events.find((e) => e.type === 'pool');
  if (!done || !pool || pool.type !== 'pool') return null;
  return SLOTS.map((s) => pool.items[s].find((i) => i.id === done.result.bundle[s])).filter((i): i is CardItem => Boolean(i));
}

function Result({ result, before, went, view, side, letters }: { result: CheckinResult; before: LedgerView | null; went: boolean; view: TruceView; side: Side; letters: Names }) {
  const name = nameOf(view.names, side);
  const { loved, avoided } = result.learned;
  const share = (l: { alpha: LedgerView['alpha'] } | null) => (l ? Math.round((l.alpha[side] ?? 0) * 100) : null);
  const [was, now] = [share(before), share(result.ledger)];
  return (
    <div className="checkin__body">
      <header className="checkin__head">
        <h1 className="h2">Thanks, {name}</h1>
        <p className="muted">
          {!went
            ? 'Nothing changes: the ledger only counts evenings that happened.'
            : was !== null && now !== null && was !== now
              ? `The ledger now counts how the evening really went: ${possessive(name)} say next time moves from ${was}% to ${now}%.`
              : 'The ledger now counts how the evening really went.'}
        </p>
      </header>
      {went && (
        <section className="card checkin__card" aria-labelledby="ledger-title">
          <SectionHeader icon="scale" id="ledger-title" title="Fairness ledger" info={<InfoTip label="What the fairness ledger does">{EXPLAIN.ledger}</InfoTip>} />
          <LedgerMeter
            members={view.members}
            names={view.names}
            letters={letters}
            alpha={result.ledger.alpha}
            tilt={result.ledger.tilt}
            owed={result.ledger.owed}
            from={before?.alpha}
            delay={400}
          />
        </section>
      )}
      {(loved.length > 0 || avoided.length > 0) && (
        <section className="card checkin__card" aria-labelledby="learned-title">
          <SectionHeader icon="quote" id="learned-title" title={`What ${possessive(name)} agent learned`} />
          {loved.length > 0 && (
            <p className="checkin__learned">
              <Icon name="plus" size={16} className="muted" />
              <span>
                Added to {possessive(name)} favourites: <strong>{loved.map((s) => s.name).join(', ')}</strong>
              </span>
            </p>
          )}
          {avoided.length > 0 && (
            <p className="checkin__learned">
              <Icon name="ban" size={16} className="muted" />
              <span>
                Won&rsquo;t be suggested again: <strong>{avoided.map((s) => s.name).join(', ')}</strong>
              </span>
            </p>
          )}
        </section>
      )}
      <div className="checkin__actions">
        <ButtonLink variant="primary" iconEnd="arrow-right" href={`/p/${view.pairId}`}>
          Back to the group
        </ButtonLink>
      </div>
    </div>
  );
}

export function CheckIn({ truceId, side }: { truceId: string; side: Side }) {
  const [view, setView] = useState<TruceView | null>(null);
  const [before, setBefore] = useState<LedgerView | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [went, setWent] = useState<boolean | null>(null);
  const [ratings, setRatings] = useState<Partial<Record<Slot, Rating>>>({});
  const [result, setResult] = useState<CheckinResult | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getTruce(truceId)
      .then(async (v) => {
        if (!alive) return;
        setView(v);
        setLoadError(null);
        // The ledger as it stands, so the result can show it moving.
        const pair = await api.getPair(v.pairId).catch(() => null);
        if (alive && pair) setBefore(pair.ledger);
      })
      .catch((err: unknown) => alive && setLoadError(ApiError.from(err)));
    return () => {
      alive = false;
    };
  }, [truceId, attempt]);

  const send = useAction(async () => {
    if (went === null) return;
    setResult(await api.checkin(truceId, side, { went, ratings: went ? ratings : {} }));
  });

  if (loadError?.status === 404) return <NotFound what="truce" />;
  if (view && !view.members.includes(side)) return <NotFound what="truce" />;

  const name = view ? nameOf(view.names, side) : '';
  const letters = view ? monograms(view.names, view.members) : {};
  const picks = view ? picksOf(view) : null;

  return (
    <Page
      title={name ? `${possessive(name)} check-in` : 'Check-in'}
      className="checkin"
      context={
        view && (
          <span className="side__who">
            <Avatar side={side} letters={nameOf(letters, side)} size="sm" />
            <span className="side__who-name">{possessive(name)} check-in</span>
          </span>
        )
      }
    >
      {loadError && <ErrorNotice error={loadError} title="Couldn't load this evening" onRetry={() => setAttempt((n) => n + 1)} />}
      {!view && !loadError && (
        <div className="checkin__body" aria-hidden="true">
          <Skeleton w="16rem" h="1.75rem" />
          <Skeleton h="3rem" delay={80} />
          <Skeleton h="10rem" delay={120} />
        </div>
      )}

      {view && result && went !== null && <Result result={result} before={before} went={went} view={view} side={side} letters={letters} />}

      {view && !result && view.status !== 'done' && (
        <div className="checkin__body">
          <Notice tone="info" title="This evening isn’t planned yet">
            Check in once the agents have agreed on a plan.
          </Notice>
          <ButtonLink variant="primary" icon="eye" href={`/t/${truceId}`}>
            Watch the talks
          </ButtonLink>
        </div>
      )}

      {view && !result && view.status === 'done' && (
        <form
          className="checkin__body"
          onSubmit={(e) => {
            e.preventDefault();
            void send.run();
          }}
        >
          <header className="checkin__head">
            <h1 className="h2">{name}, how was the evening?</h1>
            <p className="muted">
              The ledger counts how it really went, not just Qloo&rsquo;s prediction.
              <InfoTip label="What a check-in does">{EXPLAIN.checkin}</InfoTip>
            </p>
          </header>
          {view.checkedIn[side] && (
            <Notice tone="info" title="You already checked in">
              Answering again replaces your last answer.
            </Notice>
          )}

          <fieldset className="checkin__went">
            <legend className="checkin__q">Did you go?</legend>
            <div className="examples">
              <Chip pressed={went === true} icon="check" onClick={() => setWent(true)}>
                Yes, we went
              </Chip>
              <Chip pressed={went === false} icon="x" onClick={() => setWent(false)}>
                We didn&rsquo;t go
              </Chip>
            </div>
          </fieldset>

          {went && picks && (
            <section className="card checkin__card" aria-labelledby="picks-title">
              <SectionHeader icon="heart" id="picks-title" title="How was each pick?" meta="All optional. Skip one and it stays as Qloo predicted." />
              <ul className="checkin__picks">
                {picks.map((item) => (
                  <li key={item.slot} className="checkin__pick">
                    <Thumb name={item.name} imageUrl={item.imageUrl} slot={item.slot} />
                    <p className="checkin__pick-name">
                      <span className="small muted checkin__slot">
                        <Icon name={SLOT_ICON[item.slot]} size={16} />
                        {SLOT_LABEL[item.slot]}
                      </span>
                      <span>{item.name}</span>
                    </p>
                    <div className="checkin__rates" role="group" aria-label={`How was ${item.name}?`}>
                      {RATINGS.map((r) => (
                        <Chip
                          key={r.value}
                          icon={r.icon}
                          pressed={ratings[item.slot] === r.value}
                          onClick={() =>
                            setRatings((all) => ({ ...all, [item.slot]: all[item.slot] === r.value ? undefined : r.value }))
                          }
                        >
                          {r.label}
                        </Chip>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {send.error && <ErrorNotice error={send.error} title="Couldn't send your check-in" />}
          <div className="checkin__actions">
            <Button type="submit" variant="primary" icon="check" busy={send.busy} disabled={went === null}>
              Send
            </Button>
            {went === null && <span className="small muted">Pick an answer first.</span>}
          </div>
        </form>
      )}
    </Page>
  );
}

