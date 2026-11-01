import { connectionState } from '../domain/coordinator';
import { CONNECTION_LABEL, TOOL_LABEL, type Agent, type Person, type Project } from '../domain/types';
import { timeAgo, useNow } from '../live/useNow';
import { OwnerGlyph, type ResolvedOwner } from './icons';

export type OwnerFilter = { type: 'person' | 'agent'; id: string } | null;

interface Props {
  project: Project;
  filter: OwnerFilter;
  onFilter: (filter: OwnerFilter) => void;
  onConnect: () => void;
  onAddPerson: () => void;
}

function openCount(project: Project, match: (owner: NonNullable<Project['tasks'][number]['owner']>) => boolean) {
  return project.tasks.filter((task) => task.owner && task.status !== 'done' && match(task.owner)).length;
}

export function Roster({ project, filter, onFilter, onConnect, onAddPerson }: Props) {
  const now = useNow();

  const agentDetail = (agent: Agent) => {
    if (agent.isSample) return `${TOOL_LABEL[agent.tool]} · sample`;
    const connection = project.connections?.[agent.tool];
    if (agent.manual || !connection) return 'Manual placeholder · no live sync';
    const state = connectionState(project, agent.tool, 'installed', true);
    const working = project.tasks.find((task) => task.status === 'active' && task.owner?.id === agent.id);
    const label = working ? `Working on ${working.ref}` : state === 'connected' ? 'Connected' : CONNECTION_LABEL[state];
    return `${label}${connection.lastEventAt ? ` · ${timeAgo(connection.lastEventAt, now)}` : ''}`;
  };

  const toggle = (next: NonNullable<OwnerFilter>) =>
    onFilter(filter?.type === next.type && filter.id === next.id ? null : next);

  const row = (owner: ResolvedOwner, item: Person | Agent, type: 'person' | 'agent', detail: string, count: number) => (
    <button
      type="button"
      className={`roster-row ${type === 'agent' ? 'agent' : ''} ${filter?.id === item.id && filter.type === type ? 'on' : ''}`}
      aria-pressed={filter?.id === item.id && filter.type === type}
      onClick={() => toggle({ type, id: item.id })}
    >
      <OwnerGlyph owner={owner} />
      <span className="roster-text">
        <strong>{owner.name}</strong>
        <span>{detail}</span>
      </span>
      <span className="roster-count" title="Open tasks">{count}</span>
    </button>
  );

  return (
    <aside className="roster" aria-label="People and agents">
      <div className="roster-head">
        <h2 className="eyebrow">People &amp; agents</h2>
        <span className="eyebrow-note">Open tasks</span>
      </div>

      <div className="roster-scroll">
        {project.people.map((person) => {
          const agents = project.agents.filter((agent) => agent.personId === person.id);
          const personDetail = [person.isYou ? 'You' : null, person.role].filter(Boolean).join(' · ') || 'Teammate';
          return (
            <div className="roster-group" key={person.id}>
              {row({ type: 'person', person, name: person.name }, person, 'person', personDetail, openCount(project, (owner) => owner.type === 'person' && owner.id === person.id))}
              {agents.map((agent) => (
                <div key={agent.id}>
                  {row(
                    { type: 'agent', agent, name: agent.name, person },
                    agent,
                    'agent',
                    agentDetail(agent),
                    openCount(project, (owner) => owner.type === 'agent' && owner.id === agent.id),
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="roster-foot">
        <button type="button" className="ghost full" onClick={onConnect}>Connect agents</button>
        {project.mode === 'team' && <button type="button" className="ghost full" onClick={onAddPerson}>Add teammate</button>}
        <p className="hint">Only work CoBuddy starts in this project’s folder appears here. It doesn’t read your other agent conversations.</p>
      </div>
    </aside>
  );
}
