import type { BriefView, Understood } from '@contract';
import { Badge, Icon, InfoTip, SectionHeader, Voice } from '@/ui';
import { EXPLAIN } from '@/lib/glossary';

function Things({ list, veto = false }: { list: Understood[]; veto?: boolean }) {
  return (
    <ul className="understood">
      {list.map((u) => (
        <li key={`${u.said}-${u.matched}`} className="understood__item">
          <Badge variant={veto ? 'veto' : 'secondary'} icon={veto ? 'ban' : undefined}>
            {u.matched}
          </Badge>
          {u.said.toLocaleLowerCase() !== u.matched.toLocaleLowerCase() && <span className="small muted">&ldquo;{u.said}&rdquo;</span>}
        </li>
      ))}
    </ul>
  );
}

/** What a person's agent took from their brief. Private: only shown to the person who wrote it. */
export function BriefSummary({ brief }: { brief: BriefView }) {
  const empty = !brief.wishes.length && !brief.vetoes.length && !brief.note && !brief.unmatched.length;
  return (
    <section className="card brief-summary" aria-labelledby="understood-title">
      <SectionHeader
        icon="quote"
        id="understood-title"
        title="Your agent understood"
        info={<Voice kind="agent" />}
        meta={
          <span className="brief-summary__private">
            <Icon name="eye-off" size={16} />
            Only you see this. Shared screens never show your note.
          </span>
        }
      />
      {brief.wishes.length > 0 && (
        <div className="brief-summary__group">
          <p className="brief-summary__label">You&rsquo;d like</p>
          <Things list={brief.wishes} />
        </div>
      )}
      {brief.vetoes.length > 0 && (
        <div className="brief-summary__group">
          <p className="brief-summary__label">
            Won&rsquo;t happen
            <InfoTip label="What a veto is">{EXPLAIN.veto}</InfoTip>
          </p>
          <Things list={brief.vetoes} veto />
        </div>
      )}
      {brief.note && (
        <div className="brief-summary__group">
          <p className="brief-summary__label">Also noted</p>
          <p>{brief.note}</p>
        </div>
      )}
      {brief.unmatched.length > 0 && (
        <div className="brief-summary__group">
          <p className="brief-summary__label">Qloo couldn&rsquo;t match these; your agent still reads them</p>
          <ul className="understood">
            {brief.unmatched.map((w) => (
              <li key={w}>
                <Badge variant="outline">{w}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
      {empty && <p className="muted">Nothing specific to act on. Your agent will still read your note.</p>}
    </section>
  );
}
