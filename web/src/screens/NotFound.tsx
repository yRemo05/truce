import { ButtonLink, Page } from '@/ui';

const COPY = {
  page: { title: 'Nothing on the table here.', text: 'This page was never part of the negotiation.' },
  truce: { title: 'No truce by that name.', text: 'The link may be mistyped, or the truce was never signed.' },
  pair: { title: 'No pair by that link.', text: 'Ask whoever sent it for a fresh one, or start your own.' },
};

export function NotFound({ what = 'page' }: { what?: keyof typeof COPY }) {
  const copy = COPY[what];
  return (
    <Page title="Not found" className="notfound">
      <p className="eyebrow">Error 404</p>
      <h1 className="display-l">{copy.title}</h1>
      <p className="lede">{copy.text}</p>
      <div className="notfound__actions">
        <ButtonLink variant="primary" icon="arrow-left" href="/">
          Back to Truce
        </ButtonLink>
      </div>
    </Page>
  );
}
