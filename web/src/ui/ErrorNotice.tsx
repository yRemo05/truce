import type { ReactNode } from 'react';
import type { ApiError } from '@/api';
import { Button } from './Button';
import { Notice } from './Notice';

/** A failed request, said plainly: what happened, when to try again, and the way out. */
export function ErrorNotice({ error, title, onRetry, action }: { error: ApiError; title: string; onRetry?: () => void; action?: ReactNode }) {
  const retry = onRetry && (
    <Button size="sm" icon="retry" onClick={onRetry}>
      Try again
    </Button>
  );
  return (
    <Notice tone="error" live title={title} action={action ?? retry}>
      {error.message}
      {error.retryAfterSeconds ? ` Try again in ${error.retryAfterSeconds} seconds.` : ''}
    </Notice>
  );
}
