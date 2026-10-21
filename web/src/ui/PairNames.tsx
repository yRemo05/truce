import type { Names } from '@/lib/people';

/** "Maya & Deniz". */
export function PairNames({ names }: { names: Names }) {
  return (
    <>
      {names.a} &amp; {names.b}
    </>
  );
}
