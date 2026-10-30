/*
 * How it works: five steps, each a small piece of the real interface made
 * with the app's own components rather than an icon. The pieces are pictures
 * (`inert`: not focusable, not announced); each step's text says what it shows.
 * The plan step uses the recorded run's restaurant when there is one.
 */
import type { CardItem, LinkKind } from '@contract';
import type { CSSProperties, ReactNode } from 'react';
import { Avatar, Badge, Chip, Icon, InfoTip, Voice, type IconName } from '@/ui';
import { EXPLAIN } from '@/lib/glossary';
import { agentOf, nameOf } from '@/lib/people';
import { TruceContext } from '@/truce/context';
import { Hours } from '@/truce/Hours';
import { Venue } from '@/truce/Venue';
import { Art } from './Art';
import { Fits } from './PlanCards';
import { Section } from './Section';
import { ctxOf, type Story } from './story';

interface StepProps {
  n: number;
  title: string;
  children: ReactNode;
  /** The piece of interface it shows. */
  frag: ReactNode;
  className?: string;
}

function Step({ n, title, children, frag, className }: StepProps) {
  return (
    // Revealed on scroll, each row's cards a beat apart.
    <li className={`card l-surface l-step ${className ?? ''}`} data-reveal style={{ '--d': `${((n - 1) % 3) * 110}ms` } as CSSProperties}>
      <div className="l-step__text">
        <h3 className="l-step__title">
          <span className="l-step__n" aria-hidden="true">
            {n}
          </span>
          <span className="visually-hidden">Step {n}: </span>
          {title}
        </h3>
        <p className="small muted">{children}</p>
      </div>
      <div className="l-frag" inert>
        {frag}
      </div>
    </li>
  );
}

/** Maya's favourites in the couple demo (src/server/demo.ts); the mock and the synthetic run invent her restaurant. */
const favourites = (real: boolean): { icon: IconName; name: string }[] => [
  { icon: 'film', name: 'In the Mood for Love' },
  { icon: 'film', name: 'Lost in Translation' },
  { icon: 'restaurant', name: real ? 'Carbone New York' : 'Trattoria Sole' },
  { icon: 'music', name: 'Radiohead' },
];

const LINK_LABEL: Partial<Record<LinkKind, { icon: IconName; label: string }>> = {
  maps: { icon: 'pin', label: 'Map' },
  website: { icon: 'link', label: 'Website' },
  phone: { icon: 'phone', label: 'Call' },
};
const BOOKER: Partial<Record<LinkKind, string>> = { resy: 'Resy', opentable: 'OpenTable' };

/** The plan's restaurant as the Decision tab shows it: picture, standing, tonight's hours, booking first. */
function PlanPlace({ story, place }: { story: Story; place: CardItem }) {
  const booking = place.links.find((l) => BOOKER[l.kind]);
  const others = place.links.filter((l) => LINK_LABEL[l.kind]).slice(0, booking ? 1 : 2);
  return (
    <TruceContext.Provider value={ctxOf(story)}>
      <div className="l-place">
        <Art name={place.name} imageUrl={place.imageUrl} slot="restaurant" width={160} height={160} className="l-place__art" />
        <div className="l-place__what">
          <p className="l-plan__kind">
            <Icon name="restaurant" size={16} />
            Restaurant
          </p>
          <p className="l-place__name">{place.name}</p>
          <Venue item={place} />
          <Hours hours={place.hours} />
        </div>
        <div className="l-place__act">
          <Fits scores={place.scores} members={story.members} names={story.names} />
          <span className="act-links">
            {booking && (
              <span className="btn btn--sm btn--primary">
                <Icon name="booking" size={16} />
                <span className="btn__label">
                  Book a table <span className="btn__meta">· {BOOKER[booking.kind]}</span>
                </span>
              </span>
            )}
            {others.map((l) => (
              <span key={l.url} className="btn btn--sm btn--outline">
                <Icon name={LINK_LABEL[l.kind]!.icon} size={16} />
                <span className="btn__label">{LINK_LABEL[l.kind]!.label}</span>
              </span>
            ))}
            <span className="btn btn--sm btn--outline">
              <Icon name="calendar" size={16} />
              <span className="btn__label">Add to calendar</span>
            </span>
          </span>
        </div>
      </div>
    </TruceContext.Provider>
  );
}

export function HowItWorks({ story }: { story: Story }) {
  const a = nameOf(story.names, 'a');
  const b = nameOf(story.names, 'b');
  const place = story.plan.restaurant;
  return (
    <Section
      id="how"
      title="How it works"
      lede="A minute each to set up, about a minute for the agents to agree. For a couple or two to four friends, on one phone or each on your own."
    >
      <ol className="l-steps">
        <Step
          n={1}
          title="Each of you names a few favourites"
          frag={
            <div className="l-fav">
              <p className="l-fav__who">
                <Avatar side="a" letters={nameOf(story.letters, 'a')} size="sm" />
                {a}&rsquo;s favourites
              </p>
              <ul className="l-fav__list">
                {favourites(story.real).map((f) => (
                  <li key={f.name}>
                    <Badge variant="outline" icon={f.icon}>
                      {f.name}
                    </Badge>
                  </li>
                ))}
              </ul>
              <p className="l-fav__found small muted">
                <Icon name="check" size={16} className="l-ok" />
                Found on Qloo
              </p>
            </div>
          }
        >
          Films, restaurants and artists you love. Qloo finds each one, and you confirm the match.
        </Step>

        <Step
          n={2}
          title="Tell your agent about tonight"
          frag={
            <div className="l-brief">
              <p className="l-brief__note">&ldquo;Something cosy tonight. I&rsquo;ve already seen Past Lives.&rdquo;</p>
              <p className="l-brief__as small muted">
                <Voice kind="qloo" />
                Understood as
              </p>
              <ul className="l-brief__tags">
                <li>
                  <Badge variant="success" icon="check">
                    Cozy, ambience
                  </Badge>
                </li>
                <li>
                  <Badge variant="veto" icon="eye-off">
                    Past Lives, seen it
                  </Badge>
                </li>
              </ul>
            </div>
          }
        >
          In plain words. Qloo grounds them: wishes guide your agent, vetoes and &ldquo;I&rsquo;ve seen it&rdquo; are hard rules. Only your
          agent reads your note.
        </Step>

        <Step
          n={3}
          title="Your agents scout and negotiate"
          frag={
            <ul className="l-scout">
              <li>
                <Voice kind="qloo" />
                <span>{agentOf(b)} searches Qloo near the group&rsquo;s taste hotspot</span>
              </li>
              <li>
                <Voice kind="agent" />
                <span>{agentOf(a)} offers a film, a restaurant and music</span>
              </li>
              <li>
                <Voice kind="referee" />
                <span>Checked: real options, nobody below their minimum</span>
              </li>
            </ul>
          }
        >
          One AI agent per person, with Qloo as a tool. They trade whole evenings until everyone says yes. A referee in plain code checks every
          move.
        </Step>

        <Step
          n={4}
          title="You get one plan, ready to act on"
          className="l-step--wide"
          frag={<PlanPlace story={story} place={place} />}
        >
          A film, a restaurant and music, with what you need to go: tonight&rsquo;s opening hours (closed places never appear), ratings,
          booking links, IMDb or Spotify, and a calendar event.
        </Step>

        <Step
          n={5}
          title="Swap one thing, then check in"
          frag={
            <div className="l-after">
              <p className="l-after__line small">
                <Icon name="exchange" size={16} className="muted" />
                <span>
                  {b} asked to swap the film. {a}: <strong>OK with an alternative</strong>
                  <Badge variant="success" icon="check">
                    2 of 2, passed
                  </Badge>
                </span>
              </p>
              <p className="l-after__q small muted">Next day: how was {story.plan.film.name}?</p>
              <div className="l-after__rates">
                <Chip pressed icon="heart">
                  Loved
                </Chip>
                <Chip pressed={false} icon="check">
                  Fine
                </Chip>
                <Chip pressed={false} icon="x">
                  Not for me
                </Chip>
              </div>
            </div>
          }
        >
          Anyone can ask to swap one item; the others vote on it. Next day, a one-tap check-in{' '}
          <InfoTip label="What a check-in does">{EXPLAIN.checkin}</InfoTip> tells the ledger how it really went.
        </Step>
      </ol>
    </Section>
  );
}
