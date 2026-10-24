/** The short explanations behind every ⓘ. One place, so the same term always reads the same. */
export const EXPLAIN = {
  bridge: 'Qloo found this from everyone’s tastes together, so it’s often the best middle ground.',
  score: 'How well Qloo thinks this fits each person’s taste, compared with tonight’s other options (0–100).',
  ledger: 'Remembers who gave ground last time; that person gets a bit more say next time.',
  lastCall:
    'After the last turn, everyone who hasn’t said yes to the final offer gets one last chance to take it, in turn. If anyone leaves it, the referee decides.',
  ruling:
    'When the agents don’t agree, the referee picks the evening that does best by everyone at once, with a little extra say for whoever the ledger favours.',
  minimum:
    'Each agent has a minimum it can’t go below for its person. It starts high and comes down turn by turn, so nobody is talked into a bad evening.',
  rulesMode: 'Today’s AI budget is used up, so the agents follow simple rules: same referee, same fairness.',
  referee: 'Plain rules, not AI: it checks every move, replaces invalid ones, and decides when there’s no deal.',
  shortlist:
    'In the final round the referee shows each agent evenings it has checked everyone can accept. The agent still decides, and still needs everyone’s yes.',
  polish: 'If another evening is at least as good for everyone and better for someone, the referee swaps it in.',
  closeness: '100 is the best evening tonight’s options could give that person.',
  pool: 'Qloo suggested these from each person’s taste, from everyone’s together, and from what the agents scouted.',
  brief: 'A note for your agent about tonight. It’s private: only your agent reads it, and nobody else sees it.',
  veto: 'Something someone ruled out in their note. It’s kept out of the evening entirely.',
  scout: 'Before the talks, each agent searches Qloo for things its person would like tonight and adds the best finds.',
  hotspot: 'An area Qloo links to the group’s taste, so the agent looked for restaurants there first.',
  openTonight: 'From the restaurant’s listed hours for today, in its own time zone. Check before you go.',
  checkin:
    'Tell Truce how the evening really went. The ledger then counts how it went, not just Qloo’s prediction, and your agent learns what to suggest again.',
  portrait: 'The taste words Qloo connects with each person’s favourites.',
  swap:
    'Anyone can ask to change one item of the evening. If it can’t happen, it swaps at once; if it’s a matter of taste, the group votes. Each of you has one taste swap per evening.',
  floor: 'The least each person may end up with, set by the fair evening. A swap never takes anyone below it.',
  receipts: 'Every call Truce made to Qloo for this evening. The key never leaves the server, and no personal data is sent.',
  affinity: 'Qloo’s measure of how well an option fits someone’s favourites, from 0 to 1. Truce turns it into the 0–100 fit scores.',
} as const;
