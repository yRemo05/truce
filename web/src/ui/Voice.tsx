import { Icon, type IconName } from './Icon';

type VoiceKind = 'agent' | 'rules' | 'qloo' | 'referee';

const VOICE: Record<VoiceKind, { icon: IconName; label: string; title: string }> = {
  agent: { icon: 'quote', label: 'AI', title: 'Written by an AI agent' },
  rules: { icon: 'sliders', label: 'Rule-based', title: 'Written by a rule-based agent, not AI' },
  qloo: { icon: 'data', label: 'Qloo', title: "Qloo's taste data" },
  referee: { icon: 'gavel', label: 'Referee', title: "Truce's referee: plain rules, no AI" },
};

/** Where something comes from: an AI agent's words, a rule-based agent's, Qloo's data, or the referee's rules. */
export function Voice({ kind }: { kind: VoiceKind }) {
  const v = VOICE[kind];
  return (
    <span className={`voice voice--${kind}`} title={v.title}>
      <Icon name={v.icon} size={16} />
      <span aria-hidden="true">{v.label}</span>
      <span className="visually-hidden">{v.title}</span>
    </span>
  );
}
