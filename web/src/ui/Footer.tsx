import { api } from '@/api';

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer__row">
        <p className="small muted">Taste data from Qloo.</p>
        {api.kind === 'mock' && (
          <p className="small muted footer__mock">Mock mode: invented scores, no server.</p>
        )}
      </div>
    </footer>
  );
}
