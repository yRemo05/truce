import type { Side } from '@contract';
import type { ReactNode } from 'react';
import { Avatar } from './Avatar';

interface PersonRowProps {
  side: Side;
  letters: string;
  name: string;
  /** A status chip beside the name. */
  status: ReactNode;
  /** Actions on the right, in the same order on every list. */
  actions?: ReactNode;
}

/** One person in a list: their mark, name and status, and what to do next. */
export function PersonRow({ side, letters, name, status, actions }: PersonRowProps) {
  return (
    <li className="person">
      <Avatar side={side} letters={letters} size="lg" />
      <div className="person__text">
        <p className="person__name">{name}</p>
        {status}
      </div>
      {actions && <div className="person__actions">{actions}</div>}
    </li>
  );
}
