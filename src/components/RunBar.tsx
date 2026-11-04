import { needsPerson } from '../domain/coordinator';
import { liveAgents } from '../domain/events';
import type { Project } from '../domain/types';
import type { LiveProject } from '../live/useLiveProject';
import { timeAgo, useNow } from '../live/useNow';

interface Props {
  project: Project;
  live: LiveProject;
  activityOpen: boolean;
  onToggleActivity: () => void;
  onNewGoal: () => void;
  onConnect: () => void;
  onSelect: (taskId: string) => void;
}

function headline(project: Project, working: number): string {
  switch (project.runState) {
    case 'ready':
      return 'Plan ready. Nothing has started yet.';
    case 'planning':
      return 'Planning…';
    case 'paused':
      return working ? `Paused. ${working} still finishing, and no new work will start.` : 'Paused. No agents are working.';
    case 'finished':
      return 'Every task is reported finished.';
    case 'running':
      return working ? `${working} ${working === 1 ? 'agent' : 'agents'} working` : 'No agents working right now';
    default:
      return 'Not running';
  }
}

export function RunBar({ project, live, activityOpen, onToggleActivity, onNewGoal, onConnect, onSelect }: Props) {
  const agents = liveAgents(project);
  const working = project.tasks.filter((task) => task.status === 'active' && agents.some((agent) => agent.id === task.owner?.id)).length;
  const waiting = needsPerson(project);
  const connected = agents.length > 0;
  const cost = project.costUsd ?? 0;
  const now = useNow();
  const lastEventAt = Object.values(project.connections ?? {}).flatMap((item) => item.lastEventAt ?? []).sort().at(-1);

  return (
    <div className={`run-bar run-${project.runState ?? 'idle'}`}>
      <span className="run-dot" aria-hidden="true" />
      <strong>{headline(project, working)}</strong>

      {waiting.length > 0 && (
        <span className="run-waiting">
          Waiting for you:
          {waiting.map((task) => <button key={task.id} type="button" className="text-button" onClick={() => onSelect(task.id)}>{task.ref}</button>)}
        </span>
      )}
      {live.bridge === 'down' && <span className="run-alert">Lost contact with CoBuddy’s local bridge. Is the server still running?</span>}
      {live.error && <span className="run-alert">{live.error}</span>}

      <span className="spacer" />
      {lastEventAt && <span className="mono-note">Last event {timeAgo(lastEventAt, now)}</span>}
      {cost > 0 && <span className="mono-note" title="Total reported by the agent tool">Reported cost ${cost.toFixed(2)}</span>}
      <button type="button" className={`mini-toggle ${activityOpen ? 'on' : ''}`} aria-pressed={activityOpen} onClick={onToggleActivity}>Activity</button>

      {!connected && <button type="button" className="ghost small" onClick={onConnect}>Reconnect</button>}
      {connected && project.runState === 'ready' && <button type="button" className="primary small" onClick={() => live.setRun('running')}>Start agents</button>}
      {project.runState === 'running' && <button type="button" className="ghost small" onClick={() => live.setRun('paused')}>Pause</button>}
      {project.runState === 'paused' && <button type="button" className="ghost small" onClick={() => live.setRun('running')}>Resume</button>}
      {working > 0 && <button type="button" className="ghost small danger" onClick={live.stopAll}>Stop all</button>}
      {connected && project.runState === 'finished' && <button type="button" className="ghost small" onClick={onNewGoal}>New goal</button>}
    </div>
  );
}
