import { Icon, type IconName } from './Icon';

type VoiceKind = 'agent' | 'qloo' | 'referee';

const VOICE: Record<VoiceKind, { icon: IconName; label: string; title: string }> = {
  agent: { icon: 'quote', label: 'Agent', title: 'Written by an AI agent' },
  qloo: { icon: 'data', label: 'Qloo', title: "Qloo's taste data" },
  referee: { icon: 'gavel', label: 'Referee', title: "Truce's referee, in plain code" },
};

/** Marks who is speaking: an agent's words, Qloo's data, or the referee. */
export function Voice({ kind, children }: { kind: VoiceKind; children?: string }) {
  const v = VOICE[kind];
  return (
    <span className={`voice voice--${kind}`} title={v.title}>
      <Icon name={v.icon} size={16} />
      <span>{children ?? v.label}</span>
    </span>
  );
}
