import type { Agent, OwnerRef, Person, Project, TaskStatus, ToolId } from '../domain/types';

export function StatusIcon({ status, size = 14 }: { status: TaskStatus; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': true };
  switch (status) {
    case 'queued':
      return <svg {...common}><circle cx="8" cy="8" r="5.5" strokeDasharray="2.6 2.6" /></svg>;
    case 'active':
      return <svg {...common} className="icon-working"><circle cx="8" cy="8" r="5.5" opacity=".28" /><path d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5" strokeLinecap="round" /></svg>;
    case 'blocked':
      return <svg {...common}><path d="M5.5 2h5L14 5.5v5L10.5 14h-5L2 10.5v-5z" /><path d="M5 8h6" strokeLinecap="round" /></svg>;
    case 'review':
      return <svg {...common}><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="1.7" fill="currentColor" stroke="none" /></svg>;
    case 'done':
      return <svg {...common}><path d="M2.5 8.5 6.5 12.5 13.5 4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
}

export function WarningIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M8 2 15 14H1z" strokeLinejoin="round" />
      <path d="M8 6.500v3.500M8 12v.2" strokeLinecap="round" />
    </svg>
  );
}

const TOOL_MONOGRAM: Record<ToolId, string> = {
  'claude-code': 'CC',
  codex: 'CX',
  'github-copilot': 'GH',
  cursor: 'CU',
  windsurf: 'WS',
  other: 'AI',
};

export type ResolvedOwner =
  | { type: 'person'; person: Person; name: string }
  | { type: 'agent'; agent: Agent; name: string; person?: Person }
  | { type: 'none'; name: string };

export function resolveOwner(project: Project, owner: OwnerRef): ResolvedOwner {
  if (owner?.type === 'person') {
    const person = project.people.find((item) => item.id === owner.id);
    if (person) return { type: 'person', person, name: person.name };
  }
  if (owner?.type === 'agent') {
    const agent = project.agents.find((item) => item.id === owner.id);
    if (agent) {
      return { type: 'agent', agent, name: agent.name, person: project.people.find((item) => item.id === agent.personId) };
    }
  }
  return { type: 'none', name: 'Unassigned' };
}

export function OwnerGlyph({ owner }: { owner: ResolvedOwner }) {
  if (owner.type === 'agent') {
    if (owner.agent.manual) return <span className="glyph glyph-manual" title="Manual placeholder: no live sync">{TOOL_MONOGRAM[owner.agent.tool]}</span>;
    return <span className="glyph glyph-agent" title="Agent">{TOOL_MONOGRAM[owner.agent.tool]}</span>;
  }
  if (owner.type === 'person') {
    const initial = owner.name.replace(/^Sample /, '').charAt(0).toUpperCase();
    return <span className="glyph glyph-person" title="Person">{initial}</span>;
  }
  return <span className="glyph glyph-none" title="Unassigned">–</span>;
}
