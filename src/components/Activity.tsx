import type { ActivityItem, Project } from '../domain/types';
import { timeAgo, useNow } from '../live/useNow';

const NOT_SHOWN = new Set(['connected']);

function author(item: ActivityItem, agentName?: string): string {
  if (item.kind === 'handoff') return 'Routed by CoBuddy';
  if (agentName) return agentName;
  return item.kind === 'tool' || item.kind === 'plan-ready' ? 'Planning agent' : 'CoBuddy';
}

function Row({ item, project, showTask, onSelect }: { item: ActivityItem; project: Project; showTask: boolean; onSelect?: (id: string) => void }) {
  const now = useNow();
  const task = project.tasks.find((candidate) => candidate.id === item.taskId);
  const agent = project.agents.find((candidate) => candidate.id === item.agentId);
  return (
    <li className={`activity-row activity-${item.kind}`}>
      <p>{item.text}</p>
      <span>
        {author(item, agent?.name)}
        {showTask && task && (
          <>
            {' · '}
            <button type="button" className="text-button" onClick={() => onSelect?.(task.id)}>{task.ref}</button>
          </>
        )}
        {' · '}{timeAgo(item.at, now)}
      </span>
    </li>
  );
}

/** Newest first. Only events CoBuddy really received or routed ever appear here. */
export function ActivityList({ project, taskId, limit, onSelect }: { project: Project; taskId?: string; limit?: number; onSelect?: (id: string) => void }) {
  const items = (project.activity ?? [])
    .filter((item) => (taskId ? item.taskId === taskId : !NOT_SHOWN.has(item.kind)))
    .slice(-(limit ?? 200))
    .reverse();

  if (!items.length) return <p className="hint">Nothing received yet.</p>;
  return <ul className="activity-list">{items.map((item) => <Row key={item.seq} item={item} project={project} showTask={!taskId} onSelect={onSelect} />)}</ul>;
}

export function ActivityPanel({ project, onSelect, onClose }: { project: Project; onSelect: (id: string) => void; onClose: () => void }) {
  return (
    <aside className="activity-panel" aria-label="Project activity">
      <header className="panel-head">
        <span className="panel-ref">Activity</span>
        <button type="button" className="icon-button" aria-label="Close activity" onClick={onClose}>×</button>
      </header>
      <div className="panel-scroll">
        <ActivityList project={project} onSelect={onSelect} />
      </div>
      <p className="hint activity-foot">Tool names, file names and agent summaries only. Agents’ reasoning isn’t shown.</p>
    </aside>
  );
}
