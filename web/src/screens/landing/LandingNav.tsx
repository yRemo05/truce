/*
 * The landing's floating bar, in the shared TopBar's two slots; landing.css turns TopBar's row into
 * the pill, so TopBar and every app screen stay as they are.
 *
 * Inventory, by priority:
 *   primary   — Couple demo
 *   secondary — the three sections, with where you are; My evenings
 *   rare      — the source on GitHub
 *
 * Viewport budget: one row, 56px, at every width. ≥ 896px the pill hugs its content, centred: mark,
 * sections, GitHub, My evenings, Couple demo. Below that the sections and GitHub fold into one menu,
 * My evenings goes icon-only under 480px, and the pill spans the column. Under 368px the mark drops
 * its word. All controls share one height (40px), so the row keeps one baseline.
 *
 * States: nothing is highlighted above the first section or past the last; a busy Couple demo shows
 * its spinner and holds its width; the light and frost are decoration, so the bar works without them.
 *
 * Icons: exchange, data, scale (the sections, matching their cards), menu, github, moon, heart.
 *
 * Layers, bottom to top: the glow (BarLight, under everything), the ring it shows through, and the
 * opaque Frost. Frost is what keeps the text legible whatever scrolls behind the bar. Everything is
 * under the row's content, so a focus ring is never covered. Frost sits in the actions slot but
 * fills the whole bar, the row being its positioned parent.
 */
import { useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent } from 'react';
import { Link } from 'wouter';
import { Button, Frost, Icon, type IconName } from '@/ui';
import { useSection } from './hooks';

const ANCHORS: { id: string; label: string; icon: IconName }[] = [
  { id: 'how', label: 'How it works', icon: 'exchange' },
  { id: 'qloo', label: 'Why Qloo', icon: 'data' },
  { id: 'fairness', label: 'Fairness', icon: 'scale' },
];
const IDS = ANCHORS.map((a) => a.id);
const GITHUB = { href: 'https://github.com/yRemo05/truce', label: 'Truce on GitHub (opens in a new tab)' };

function AnchorItems({ here, onPick }: { here: string | null; onPick?: () => void }) {
  return ANCHORS.map((a) => (
    <li key={a.id}>
      <a className="l-nav__link" href={`#${a.id}`} aria-current={a.id === here ? 'location' : undefined} onClick={onPick}>
        <Icon name={a.icon} size={16} />
        {a.label}
      </a>
    </li>
  ));
}

const idOf = (t: EventTarget) => (t as Element).closest('a')?.getAttribute('href')?.slice(1) ?? null;

/**
 * The section links, and one highlight behind them that slides to the link under the pointer or the
 * keyboard and otherwise rests on the section on screen. It wipes between links with `clip-path`, so
 * nothing lays out and its round ends never stretch. On a phone the links fold into a menu.
 */
export function NavLinks() {
  const here = useSection(IDS);
  const [over, setOver] = useState<string | null>(null);
  const glider = useRef<HTMLSpanElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const target = over ?? here;

  useLayoutEffect(() => {
    const el = glider.current;
    if (!el) return;
    const link = target ? el.parentElement?.querySelector<HTMLElement>(`[href="#${target}"]`) : null;
    if (!link) {
      el.classList.remove('is-on');
      return;
    }
    el.style.setProperty('--x', `${link.offsetLeft}px`);
    el.style.setProperty('--w', `${link.offsetWidth}px`);
    if (el.classList.contains('is-on')) return;
    // Arriving from nothing: settle on the link first, so it fades in there instead of sliding in.
    void el.offsetWidth;
    el.classList.add('is-on');
  }, [target]);

  const hover = (e: PointerEvent) => {
    // Only onto a link: across the gap between two the highlight holds, so it slides instead of blinking.
    const id = e.pointerType === 'mouse' && idOf(e.target);
    if (id) setOver(id);
  };
  const focus = (e: FocusEvent) => {
    if (e.target.matches(':focus-visible')) setOver(idOf(e.target));
  };
  // Only out of the list: tabbing between links keeps the highlight on, so it slides straight to the next.
  const blur = (e: FocusEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setOver(null);
  };

  return (
    <>
      <nav className="l-nav" aria-label="On this page">
        <span ref={glider} className="l-nav__glider" />
        <ul className="l-nav__list" onPointerOver={hover} onPointerLeave={() => setOver(null)} onFocus={focus} onBlur={blur}>
          <AnchorItems here={here} />
        </ul>
      </nav>
      <button type="button" className="btn btn--ghost btn--sm l-nav__icon l-nav__more" popoverTarget="l-sheet" aria-label="On this page">
        <Icon name="menu" size={20} />
      </button>
      <div ref={sheet} id="l-sheet" className="l-sheet" popover="auto">
        <nav aria-label="On this page">
          <ul className="l-sheet__list">
            <AnchorItems here={here} onPick={() => sheet.current?.hidePopover()} />
            <li className="l-sheet__rare">
              <a className="l-nav__link" href={GITHUB.href} target="_blank" rel="noopener noreferrer" aria-label={GITHUB.label}>
                <Icon name="github" size={16} />
                GitHub
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </>
  );
}

/**
 * One light going round the bar. Each run is a box the bar's size, so its `translate` percentages
 * trace the pill's own outline at any width; a soft blob rides at its corner. A conic gradient
 * turning about the centre can't do this on so long a shape: it would crawl along the middle of
 * each long edge and whip round the ends. The first run is the wide glow outside the bar, the
 * second the bright line clipped to the ring.
 */
function BarLight() {
  return (
    <span className="l-light" aria-hidden="true">
      <span className="l-light__run" />
      <span className="l-light__ring">
        <span className="l-light__run" />
      </span>
    </span>
  );
}

export function NavActions({ busy, disabled, onCouple }: { busy: boolean; disabled: boolean; onCouple: () => void }) {
  return (
    <>
      <BarLight />
      <Frost className="l-nav__frost" />
      <a className="btn btn--ghost btn--sm l-nav__icon l-nav__github" href={GITHUB.href} target="_blank" rel="noopener noreferrer" aria-label={GITHUB.label}>
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
