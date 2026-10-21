import type { CardItem, Side, Slot } from '@contract';
import { Button, ButtonLink, cx, ErrorNotice, Icon, LedgerMeter, PairNames, ScoreMeter, Seal, Thumb, tiltOf, Voice } from '@/ui';
import { longDate } from '@/lib/format';
import { agentOf, possessive, SIDES, type Names } from '@/lib/people';
import { absolute, canShare, copyText, shareLink } from '@/lib/share';
import { gaveGround, isLastCall, SLOTS, type TruceState } from '@/lib/truce';
import { useStartTruce } from '@/lib/useAction';
import { useFlash } from '@/lib/useFlash';
import { useTruceCtx } from './context';
import { placeLine } from './Evening';

const ARTICLE: Record<Slot, { numeral: string; title: string }> = {
  film: { numeral: 'I', title: 'The film' },
  restaurant: { numeral: 'II', title: 'The table' },
  music: { numeral: 'III', title: 'The music' },
};

/** The first few items of a comma-separated Qloo list. */
const firstOf = (list: string | undefined, n = 2) =>
  list
    ?.split(',')
    .slice(0, n)
    .map((s) => s.trim())
    .join(', ');

/** Qloo's cuisine field is sometimes a paragraph; only a short one is a label. */
const shortOnly = (text: string | undefined) => (text && text.length <= 32 ? text : undefined);

/** The line under each article's name. */
const DETAIL: Record<Slot, (item: CardItem) => (string | null | undefined)[]> = {
  film: (i) => [i.disambiguation, firstOf(i.facts.genres), i.facts.minutes && `${i.facts.minutes} min`],
  restaurant: (i) => [shortOnly(i.facts.cuisine), i.facts.price],
  music: (i) => [firstOf(i.facts.genres) ?? i.disambiguation],
};

function Article({ item, index, animate }: { item: CardItem; index: number; animate: boolean }) {
  const { names } = useTruceCtx();
  const { numeral, title } = ARTICLE[item.slot];
  const detail = DETAIL[item.slot](item).filter(Boolean).join(' · ');
  const place = item.slot === 'restaurant' ? placeLine(item) : null;
  const address = place && item.disambiguation !== place ? item.disambiguation : null;
  return (
    <li className={cx('article', animate && 'enter')} style={{ ['--delay' as string]: `${220 + index * 120}ms` }}>
      <Thumb name={item.name} imageUrl={item.imageUrl} slot={item.slot} size="lg" className="article__thumb" />
      <div className="article__text">
        <p className="eyebrow">
          <span className="article__numeral">{numeral}.</span> {title}
        </p>
        <h3 className="article__name">{item.name}</h3>
        {detail && <p className="article__detail small muted">{detail}</p>}
        {place && (
          <p className="article__place small">
            <Icon name="pin" size={16} />
            <span>
              {place}
              {address && <span className="muted"> · {address}</span>}
            </span>
          </p>
        )}
        <p className="article__fit data">
          <span className="visually-hidden">Qloo fit: </span>
          {names.a} {item.scores.a} · {names.b} {item.scores.b}
        </p>
      </div>
    </li>
  );
}

function groundLine(concession: Record<Side, number>, names: Names): string {
  const side = gaveGround(concession);
  if (!side) return 'You met in the middle tonight.';
  const gap = Math.abs(concession.a - concession.b);
  return `${names[side]} gave ${gap < 0.1 ? 'a little more' : gap < 0.25 ? 'more' : 'a lot more'} ground tonight.`;
}

function ShareButton({ text }: { text: string }) {
  const [state, setState] = useFlash<'idle' | 'copied' | 'failed'>('idle');
  const share = async () => {
    const url = absolute(window.location.pathname);
    if (canShare() && (await shareLink({ title: 'Our truce', text, url }))) return;
    setState((await copyText(url)) ? 'copied' : 'failed');
  };
  return (
    <>
      <Button icon={state === 'copied' ? 'check' : 'share'} onClick={share}>
        {state === 'copied' ? 'Link copied' : state === 'failed' ? 'Copy the address bar' : 'Share the plan'}
      </Button>
      <span className="visually-hidden" role="status">
        {state === 'copied' ? 'Link copied.' : state === 'failed' ? 'Copying failed. Copy the address from the address bar.' : ''}
      </span>
    </>
  );
}

export function Plan({ state, pairId, date, stamp }: { state: TruceState; pairId: string; date: string | null; stamp: boolean }) {
  const { names, letters, turns } = useTruceCtx();
  const again = useStartTruce(pairId);
  const result = state.result!;
  const items = SLOTS.map((s) => state.items[result.bundle[s]]).filter((x): x is CardItem => Boolean(x));
  // Two first-class endings: the agents' deal, or the referee's ruling.
  const verdict = state.ruled ? 'Truce’s call.' : 'You chose this together.';
  const how = state.ruled
    ? 'No deal by the last call, so the referee picked the fairest evening in the pool, weighted by the ledger.'
    : `Your agents agreed ${isLastCall(result.turnsUsed, turns) ? 'on the last call' : `on turn ${result.turnsUsed}`}${result.polished ? ', then the referee polished it' : ''}.`;

  return (
    <section className={cx('plan', stamp && 'plan--live')} aria-labelledby="plan-title">
      <div className="plan__sheet">
        <Seal letters={[letters.a, letters.b]} kind={state.ruled ? 'ruled' : 'agreed'} size={96} stamp={stamp} delay={stamp ? 760 : 0} className="plan__seal" />
        <p className="eyebrow plan__eyebrow">
          The terms{date && <> · {longDate(date)}</>}
        </p>
        <h2 id="plan-title" className="display-l plan__title">
          <PairNames names={names} />, tonight
        </h2>
        <p className={cx('plan__verdict', state.ruled && 'plan__verdict--ruled')}>
          <Icon name={state.ruled ? 'gavel' : 'check-circle'} size={20} />
          {verdict}
        </p>
        <p className="plan__how">{how}</p>

        <ol className="plan__articles">
          {items.map((item, i) => (
            <Article key={item.slot} item={item} index={i} animate={stamp} />
          ))}
        </ol>

        <div className="plan__grid">
          <div className={cx('plan__block', stamp && 'enter')} style={{ ['--delay' as string]: '640ms' }}>
            <p className="plan__label">
              How close each of you got <Voice kind="qloo" />
            </p>
            <div className="plan__close">
              {SIDES.map((side) => {
                const close = Math.round((1 - result.concession[side]) * 100);
                return (
                  <ScoreMeter
                    key={side}
                    side={side}
                    name={names[side]}
                    value={close}
                    size="lg"
                    label={`${names[side]}: ${close} of 100, where 100 is ${possessive(names[side])} best evening in this pool`}
                  />
                );
              })}
            </div>
            <p className="plan__note small">
              100 is each person&rsquo;s own best evening in this pool. {groundLine(result.concession, names)}
            </p>
          </div>

          {state.ledger && (
            <div className={cx('plan__block', stamp && 'enter')} style={{ ['--delay' as string]: '900ms' }}>
              <p className="plan__label">
                The ledger <Voice kind="referee" />
              </p>
              <LedgerMeter
                names={names}
                letters={letters}
                alphaA={state.ledger.after.alphaA}
                tilt={state.ledger.after.tilt}
                owed={state.ledger.after.owed}
                from={stamp ? tiltOf(state.ledger.before.tilt, state.ledger.before.alphaA) : undefined}
                delay={stamp ? 1500 : 0}
              />
            </div>
          )}
        </div>
      </div>

      <div className="plan__actions">
        <Button variant="primary" icon="plus" busy={again.busy} onClick={() => void again.run()}>
          New truce
        </Button>
        <ShareButton text={`${names.a} & ${names.b}: ${items.map((i) => i.name).join(', ')}. Settled by Truce.`} />
        <ButtonLink variant="quiet" icon="home" href={`/p/${pairId}`}>
          Pair page
        </ButtonLink>
      </div>
      <p className="plan__hint small muted">
        New truce runs again with the same picks
        {state.ledger?.after.owed ? `, with ${agentOf(names[state.ledger.after.owed])} leaning on the ledger` : ''}.
      </p>
      {again.error && <ErrorNotice error={again.error} title="Couldn't start another truce" />}
    </section>
  );
}
