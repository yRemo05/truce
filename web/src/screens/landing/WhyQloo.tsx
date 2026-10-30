/*
 * Why Qloo: the same shortlist scored for two people (the recorded run's own
 * pool of films and Qloo's scores when there is one, else illustrative), the
 * option both like, a restaurant pulled up by a film, plain words turned into
 * tags, and the receipts. Nothing here is pasted Qloo data: the recorded run
 * arrives from the server at runtime. Above it, the three parts of an evening
 * as photographs, in the order the plan lists them.
 */
import type { CSSProperties } from 'react';
import { Badge, Icon, InfoTip, ScoreMeter, Voice } from '@/ui';
import { EXPLAIN } from '@/lib/glossary';
import { nameOf } from '@/lib/people';
import { SLOT_ICON, SLOT_LABEL, SLOTS } from '@/lib/truce';
import { TruceContext } from '@/truce/context';
import { Because } from '@/truce/Because';
import { Art } from './Art';
import { Photo } from './Photo';
import { Section } from './Section';
import { ctxOf, spectrum, type Story } from './story';

const WORDS: { said: string; became: string; kind: string; veto: boolean }[] = [
  { said: '“cosy”', became: 'Cozy', kind: 'restaurant ambience', veto: false },
  { said: '“nothing scary”', became: 'Horror', kind: 'film genre, left out', veto: true },
  { said: '“I’ve seen Dune”', became: 'Dune (2021)', kind: 'skipped', veto: true },
];

/** One photograph per slot (public/img, credited in CREDITS.md). */
const SCENE = { film: '/img/film.webp', restaurant: '/img/table.webp', music: '/img/music.webp' } as const;
const after = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;

const CALLS: { what: string; detail: string; n: string }[] = [
  { what: 'Films for both of you together', detail: '/v2/insights · urn:entity:movie', n: '20 results' },
  { what: 'Where your taste concentrates', detail: '/v2/insights · urn:heatmap', n: '1 hotspot' },
  { what: '“cosy” as a tag', detail: '/v2/tags', n: '3 results' },
];

export function WhyQloo({ story }: { story: Story }) {
  const [a, b] = story.members as ['a', 'b'];
  const { rows, bridge } = spectrum(story.pool.film, [a, b]);
  const place = story.plan.restaurant;
  return (
    <Section
      id="qloo"
      className="l-why"
      title="Why Qloo"
      lede="To be fair, Truce has to know how much each of you will like the same options. Qloo’s taste graph scores one shared shortlist once per person, so the referee can compute a fair evening instead of asking a model to guess."
    >
      <ul className="l-triad" aria-label="One evening: a film, a restaurant and music">
        {SLOTS.map((slot, i) => (
          <li key={slot}>
            <Photo
              src={SCENE[slot]}
              width={540}
              height={720}
              delay={i * 140}
              caption={
                <>
                  <Icon name={SLOT_ICON[slot]} size={16} />
                  {SLOT_LABEL[slot]}
                </>
              }
            />
          </li>
        ))}
      </ul>

      <div className="l-qloo">
        <figure className="card l-surface l-short" data-reveal>
          <figcaption className="l-card-head">
            <span className="l-card-head__title">
              <Icon name="film" size={20} className="muted" />
              Same shortlist, two tastes
            </span>
            <span className="small muted">
              Fit, 0–100 <InfoTip label="What the fit scores are">{EXPLAIN.affinity}</InfoTip>
            </span>
          </figcaption>
          <ul className="l-short__rows">
            {rows.map((it) => (
              <li key={it.name} className={it === bridge ? 'l-short__row is-bridge' : 'l-short__row'}>
                <Art name={it.name} imageUrl={it.imageUrl} slot="film" width={80} height={120} className="l-short__art" />
                <div className="l-short__name">
                  <p>{it.name}</p>
                  <p className="small muted">
                    {it.disambiguation?.split(',')[0]}
                    {it === bridge && (
                      <Badge variant="success" icon="bridge" className="l-short__badge">
                        Both like it
                      </Badge>
                    )}
                  </p>
                </div>
                <div className="l-short__meters">
                  <ScoreMeter side={a} name={nameOf(story.names, a)} value={it.scores[a] ?? 0} size="sm" />
                  <ScoreMeter side={b} name={nameOf(story.names, b)} value={it.scores[b] ?? 0} size="sm" />
                </div>
              </li>
            ))}
          </ul>
          <p className="l-note small muted">
            {story.real
              ? `Films from the couple demo’s recorded run, scored by Qloo for ${nameOf(story.names, a)} and ${nameOf(story.names, b)}.`
              : 'Illustrative scores.'}{' '}
            No agent sees the other&rsquo;s scores.
          </p>
        </figure>

        <div className="l-qloo__side">
          <section className="card l-surface l-tile" aria-labelledby="cross-title" data-reveal style={after(120)}>
            <h3 id="cross-title" className="l-card-head__title">
              <Icon name="bridge" size={20} className="muted" />
              Taste crosses domains
            </h3>
            <div className="l-cross">
              <Art name={place.name} imageUrl={place.imageUrl} slot="restaurant" width={96} height={96} className="l-cross__art" />
              <div className="l-cross__text">
                <p className="small">
                  A film and a band can pull a restaurant up the list. <strong>{place.name}</strong>
                </p>
                <TruceContext.Provider value={ctxOf(story)}>
                  <Because item={place} side={a} />
                </TruceContext.Provider>
              </div>
            </div>
          </section>

          <section className="card l-surface l-tile" aria-labelledby="words-title" data-reveal style={after(220)}>
            <h3 id="words-title" className="l-card-head__title">
              <Icon name="quote" size={20} className="muted" />
              Plain words become filters
            </h3>
            <ul className="l-words">
              {WORDS.map((w) => (
                <li key={w.said}>
                  <span className="l-words__said">{w.said}</span>
                  <Icon name="arrow-right" size={16} className="muted" />
                  <Badge variant={w.veto ? 'veto' : 'success'} icon={w.veto ? 'ban' : 'check'}>
                    {w.became}
                  </Badge>
                  <span className="small muted">{w.kind}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card l-surface l-tile" aria-labelledby="receipts-title" data-reveal style={after(320)}>
            <h3 id="receipts-title" className="l-card-head__title">
              <Icon name="data" size={20} className="muted" />
              Every call is on the receipts
              <InfoTip label="What the receipts are">{EXPLAIN.receipts}</InfoTip>
            </h3>
            <ul className="l-calls">
              {CALLS.map((c) => (
                <li key={c.detail}>
                  <Voice kind="qloo" />
                  <span className="l-calls__what">
                    {c.what}
                    <span className="mono muted">{c.detail}</span>
                  </span>
                  <span className="small muted num">{c.n}</span>
                </li>
              ))}
            </ul>
            <p className="l-note small muted">Each truce&rsquo;s Research tab lists every Qloo call it made. Illustrative calls.</p>
          </section>
        </div>
      </div>
    </Section>
  );
}
