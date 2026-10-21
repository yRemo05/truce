import type { Names } from '@/lib/people';

/** "Maya & Deniz", with the Caslon italic ampersand. */
export function PairNames({ names }: { names: Names }) {
  return (
    <>
      {names.a}
      <span className="amp"> &amp; </span>
      {names.b}
    </>
  );
}
