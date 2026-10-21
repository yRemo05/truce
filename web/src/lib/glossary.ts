/** The short explanations behind every ⓘ. One place, so the same term always reads the same. */
export const EXPLAIN = {
  bridge: 'Qloo found this from both of your tastes together, so it’s often the best middle ground.',
  score: 'How well Qloo thinks this fits each person’s taste, compared with tonight’s other options (0–100).',
  ledger: 'Remembers who gave ground last time; that person gets a bit more say next time.',
  lastCall:
    'After the last turn, the agent who didn’t make the final offer can take it or leave it. If they leave it, the referee decides.',
  ruling:
    'When the agents don’t agree, the referee picks the evening that does best by both of you at once, with a little extra say for whoever the ledger favours.',
  minimum:
    'Each agent has a minimum it can’t go below for its person. It starts high and comes down turn by turn, so nobody is talked into a bad evening.',
  referee: 'Plain rules, not AI: it checks every move, replaces invalid ones, and decides when there’s no deal.',
  polish: 'If another evening is at least as good for both of you and better for one, the referee swaps it in.',
  closeness: '100 is the best evening tonight’s options could give that person.',
  pool: 'Qloo suggested these from each of your tastes, and from both together.',
} as const;
