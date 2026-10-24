import { api } from '@/api';

const out = { target: '_blank', rel: 'noopener noreferrer' } as const;

/** The credit line on every page: whose data, whose agents, and the source. */
export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer__row">
        <p className="small muted footer__credits">
          <span>
            Built on{' '}
            <a href="https://www.qloo.com" {...out}>
              Qloo’s taste graph
            </a>
          </span>
          <span aria-hidden="true">·</span>
          <span>Agents by Claude</span>
          <span aria-hidden="true">·</span>
          <span>
            <a href="https://github.com/yRemo05/truce" {...out}>
              Source code
            </a>{' '}
            (AGPL-3.0)
          </span>
        </p>
        {api.kind === 'mock' && <p className="small muted footer__mock">Mock mode: invented scores, no server.</p>}
      </div>
    </footer>
  );
}
