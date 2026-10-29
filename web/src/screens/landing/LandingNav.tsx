/*
 * The landing's own navigation, in the shared TopBar's two slots: anchor
 * links in its context slot (hidden on a phone), and GitHub, My evenings and
 * the couple demo in its actions. The bar's glass is fake (Frost): the bar is
 * sticky and the backdrop fixed, so the pre-blurred photo never has to move,
 * and no live blur runs over the scrolling page. Frost sits in the actions
 * slot but fills the whole bar, the header being its positioned parent.
 */
import { Button, Frost, Icon } from '@/ui';
import { Link } from 'wouter';

const ANCHORS = [
  { href: '#how', label: 'How it works' },
  { href: '#qloo', label: 'Why Qloo' },
  { href: '#fairness', label: 'Fairness' },
];

export function NavLinks() {
  return (
    <nav className="l-nav" aria-label="On this page">
      <ul className="l-nav__list">
        {ANCHORS.map((a) => (
          <li key={a.href}>
            <a className="l-nav__link" href={a.href}>
              {a.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function NavActions({ busy, disabled, onCouple }: { busy: boolean; disabled: boolean; onCouple: () => void }) {
  return (
    <>
      <Frost className="l-nav__frost" />
      <a
        className="btn btn--ghost btn--sm l-nav__icon"
        href="https://github.com/yRemo05/truce"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Truce on GitHub (opens in a new tab)"
      >
        <Icon name="github" size={20} />
      </a>
      <Link href="/evenings" className="btn btn--ghost btn--sm btn--compact topbar__link">
        <Icon name="moon" size={16} />
        <span className="btn__label">My evenings</span>
      </Link>
      <Button size="sm" variant="primary" icon="heart" busy={busy} disabled={disabled} onClick={onCouple}>
        Couple demo
      </Button>
    </>
  );
}
