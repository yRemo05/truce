import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

interface SectionHeaderProps {
  icon?: IconName;
  title: ReactNode;
  /** An InfoTip, or anything else that belongs right after the title. */
  info?: ReactNode;
  /** A short line under the title. */
  meta?: ReactNode;
  actions?: ReactNode;
  id?: string;
  className?: string;
}

/** The one section header: glyph, title, an optional ⓘ, a line of context, actions on the right. */
export function SectionHeader({ icon, title, info, meta, actions, id, className }: SectionHeaderProps) {
  return (
    <header className={cx('section-head', className)}>
      <div className="section-head__text">
        <div className="section-head__line">
          <h2 className="section-head__title" id={id}>
            {icon && <Icon name={icon} size={20} className="section-head__icon" />}
            <span>{title}</span>
          </h2>
          {info}
        </div>
        {meta && <p className="section-head__meta small muted">{meta}</p>}
      </div>
      {actions && <div className="section-head__actions">{actions}</div>}
    </header>
  );
}
