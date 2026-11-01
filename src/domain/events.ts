import { nextRef } from './tasks';
import type { Agent, ActivityItem, Connection, Project, Task, TaskKind, ToolId } from './types';

export interface PlanTask {
  key: string;
  title: string;
  summary: string;
  kind: TaskKind;
  dependsOn: string[];
  touches: string[];
}

export type EventKind =
  | 'connected'
  | 'connection-failed'
  | 'connection-lost'
  | 'plan-started'
  | 'plan-ready'
  | 'plan-failed'
  | 'run-started'
  | 'tool'
  | 'file'
  | 'denied'
  | 'handoff'
  | 'run-finished'
  | 'run-blocked'
  | 'run-failed'
  | 'run-stopped';

export interface AgentEvent {
  seq: number;
  at: string;
  projectId: string;
  kind: EventKind;
  text: string;
  tool: ToolId;
  /** True when this came from the agent itself, not from CoBuddy. */
  fromAgent: boolean;
  taskId?: string;
  agentId?: string;
  files?: string[];
  costUsd?: number;
  plan?: PlanTask[];
  workers?: number;
  result?: string;
}

const MAX_ACTIVITY = 400;

function touchConnection(project: Project, event: AgentEvent): Project {
  if (!event.fromAgent) return project;
  const current = project.connections?.[event.tool];
  return {
    ...project,
    connections: {
      ...project.connections,
      [event.tool]: { ...current, live: true, lost: false, note: undefined, lastEventAt: event.at },
    },
  };
}

function setConnection(project: Project, event: AgentEvent, change: Partial<Connection>): Project {
  return {
    ...project,
    connections: { ...project.connections, [event.tool]: { ...project.connections?.[event.tool], ...change } },
  };
}

function ensureAgents(project: Project, tool: ToolId, workers: number, label: string): Agent[] {
  const existing = project.agents.filter((agent) => agent.tool === tool && !agent.manual);
  const personId = (project.people.find((person) => person.isYou) ?? project.people[0]).id;
  const added: Agent[] = [];
  for (let index = existing.length + 1; index <= workers; index += 1) {
    added.push({ id: `agent-${tool}-${index}`, name: `${label} ${index}`, tool, personId });
  }
  return [...project.agents, ...added];
}

/** The agents CoBuddy can actually hand work to right now. */
export function liveAgents(project: Project): Agent[] {
  const counted = new Map<string, number>();
  return project.agents.filter((agent) => {
    const connection = project.connections?.[agent.tool];
    if (agent.isSample || agent.manual || !connection?.live) return false;
    const count = (counted.get(agent.tool) ?? 0) + 1;
    counted.set(agent.tool, count);
    return count <= (connection.workers ?? Infinity);
  });
}

function addPlan(project: Project, event: AgentEvent): Project {
  const agents = liveAgents(project);
  const ids = new Map((event.plan ?? []).map((item, index) => [item.key, `task-${event.seq}-${index + 1}`]));
  const tasks = [...project.tasks];

  (event.plan ?? []).forEach((item, index) => {
    const agent = agents.length ? agents[index % agents.length] : null;
    const task: Task = {
      id: ids.get(item.key)!,
      ref: nextRef(tasks),
      title: item.title,
      summary: item.summary,
      kind: item.kind,
      status: 'queued',
      owner: agent ? { type: 'agent', id: agent.id } : null,
      dependsOn: item.dependsOn.flatMap((key) => ids.get(key) ?? []),
      touches: item.touches,
      latestUpdate: null,
    };
    tasks.push(task);
  });

  return { ...project, tasks };
}

function changeTask(project: Project, taskId: string | undefined, change: (task: Task) => Task): Project {
  return { ...project, tasks: project.tasks.map((task) => (task.id === taskId ? change(task) : task)) };
}

function latest(event: AgentEvent, by: string) {
  return { text: event.text, at: event.at, by };
}

function agentName(project: Project, event: AgentEvent): string {
  return project.agents.find((agent) => agent.id === event.agentId)?.name ?? 'Agent';
}

function finishIfComplete(project: Project): Project {
  const complete = project.tasks.length > 0 && project.tasks.every((task) => task.status === 'done');
  return complete && project.runState === 'running' ? { ...project, runState: 'finished' } : project;
}

/** Applies one event to a project. Events already applied are ignored, so replays are safe. */
export function applyEvent(project: Project, event: AgentEvent): Project {
  if (event.seq <= (project.lastSeq ?? 0)) return project;

  const item: ActivityItem = {
    seq: event.seq,
    at: event.at,
    kind: event.kind,
    text: event.text,
    ...(event.taskId ? { taskId: event.taskId } : {}),
    ...(event.agentId ? { agentId: event.agentId } : {}),
    ...(event.files ? { files: event.files } : {}),
  };

  let next: Project = {
    ...touchConnection(project, event),
    lastSeq: event.seq,
    activity: [...(project.activity ?? []), item].slice(-MAX_ACTIVITY),
    costUsd: (project.costUsd ?? 0) + (event.costUsd ?? 0),
  };

  switch (event.kind) {
    case 'connected':
      next = setConnection(next, event, { live: true, workers: event.workers ?? 1 });
      return { ...next, agents: ensureAgents(next, event.tool, event.workers ?? 1, 'Claude Code') };
    case 'connection-failed':
      return setConnection(next, event, { live: false, note: event.text });
    case 'connection-lost':
      next = setConnection(next, event, { live: false, lost: true, note: event.text });
      return changeTask(next, event.taskId, (task) => ({ ...task, status: 'blocked', latestUpdate: latest(event, 'CoBuddy') }));
    case 'plan-started':
      return { ...next, runState: 'planning' };
    case 'plan-failed':
      return { ...next, runState: 'idle' };
    case 'plan-ready':
      return { ...addPlan(next, event), runState: 'ready' };
    case 'run-started':
      return changeTask(next, event.taskId, (task) => ({
        ...task,
        status: 'active',
        startedAt: event.at,
        owner: event.agentId ? { type: 'agent', id: event.agentId } : task.owner,
        instruction: undefined,
        requeueOnStop: undefined,
        latestUpdate: latest(event, agentName(next, event)),
      }));
    case 'tool':
    case 'denied':
      return changeTask(next, event.taskId, (task) => ({ ...task, latestUpdate: latest(event, agentName(next, event)) }));
    case 'file':
      return changeTask(next, event.taskId, (task) => ({
        ...task,
        changed: [...new Set([...(task.changed ?? []), ...(event.files ?? [])])],
        // What an agent really changes counts for overlaps, not only what was planned.
        touches: [...new Set([...task.touches, ...(event.files ?? [])])],
        latestUpdate: latest(event, agentName(next, event)),
      }));
    case 'run-finished':
      next = changeTask(next, event.taskId, (task) => ({
        ...task,
        status: 'done',
        result: event.result,
        latestUpdate: latest(event, agentName(next, event)),
      }));
      return finishIfComplete(next);
    case 'run-blocked':
    case 'run-failed':
      return changeTask(next, event.taskId, (task) => ({
        ...task,
        status: 'blocked',
        result: event.result ?? task.result,
        latestUpdate: latest(event, agentName(next, event)),
      }));
    case 'run-stopped':
      return changeTask(next, event.taskId, (task) => ({
        ...task,
        status: task.requeueOnStop ? 'queued' : 'blocked',
        requeueOnStop: undefined,
        latestUpdate: latest(event, 'CoBuddy'),
      }));
    default:
      return next;
  }
}
