import { ButtonLink, Page } from '@/ui';

const COPY = {
  page: { title: 'Page not found', text: 'This page doesn’t exist.' },
  truce: { title: 'Truce not found', text: 'The link may be mistyped, or this truce never started.' },
  pair: { title: 'Link not found', text: 'Ask whoever sent it for a fresh link, or start your own.' },
};

export function NotFound({ what = 'page' }: { what?: keyof typeof COPY }) {
  const copy = COPY[what];
  return (
    <Page title="Not found" className="notfound">
      <div className="card notfound__card">
        <h1 className="h2">{copy.title}</h1>
        <p className="muted">{copy.text}</p>
        <ButtonLink variant="primary" icon="home" href="/">
          Go to Truce
        </ButtonLink>
      </div>
    </Page>
  );
}
