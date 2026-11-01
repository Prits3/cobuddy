import { liveAgents } from './events';
import { checkStart } from './gate';
import { findOverlaps } from './overlaps';
import type { Agent, ConnectionState, Project, Task, ToolId } from './types';

type Presence = 'installed' | 'traces' | 'absent';

export interface Handoff {
  ref: string;
  title: string;
  fromAgent: string;
  result: string;
}

export interface Dispatch {
  task: Task;
  agent: Agent;
  handoffs: Handoff[];
}

function handoffsFor(project: Project, task: Task): Handoff[] {
  return project.tasks
    .filter((candidate) => task.dependsOn.includes(candidate.id) && candidate.result)
    .map((candidate) => ({
      ref: candidate.ref,
      title: candidate.title,
      fromAgent: project.agents.find((agent) => agent.id === candidate.owner?.id)?.name ?? 'A person',
      result: candidate.result!,
    }));
}

/**
 * Chooses the tasks that can start now. A task goes to a free, connected agent
 * only when its dependencies are finished and it can't collide with moving work.
 */
export function nextDispatches(project: Project, inFlight: ReadonlySet<string>): Dispatch[] {
  if (project.runState !== 'running') return [];

  const agents = liveAgents(project);
  const busy = new Set(
    project.tasks
      .filter((task) => task.owner?.type === 'agent' && (task.status === 'active' || inFlight.has(task.id)))
      .map((task) => task.owner!.id),
  );

  let simulated = {
    ...project,
    tasks: project.tasks.map((task) => (inFlight.has(task.id) ? { ...task, status: 'active' as const } : task)),
  };
  const dispatches: Dispatch[] = [];

  for (const task of project.tasks) {
    if (task.status !== 'queued' || inFlight.has(task.id) || task.owner?.type === 'person') continue;
    if (project.agents.some((agent) => agent.manual && agent.id === task.owner?.id)) continue;
    if (!checkStart(simulated, findOverlaps(simulated), task.id).allowed) continue;

    const owner = agents.find((agent) => agent.id === task.owner?.id && !busy.has(agent.id));
    const agent = owner ?? agents.find((candidate) => !busy.has(candidate.id));
    if (!agent) continue;

    busy.add(agent.id);
    dispatches.push({ task, agent, handoffs: handoffsFor(project, task) });
    simulated = {
      ...simulated,
      tasks: simulated.tasks.map((item) =>
        item.id === task.id ? { ...item, status: 'active', owner: { type: 'agent', id: agent.id } } : item,
      ),
    };
  }

  return dispatches;
}

/** Tasks that won't move again until a person does something. */
export function needsPerson(project: Project): Task[] {
  return project.tasks.filter((task) => task.status === 'blocked');
}

/**
 * A tool's link to CoBuddy, which only a real event can make `connected`.
 * Whether the tool is on this computer is a separate fact: see `presenceState`.
 */
export function connectionState(
  project: Project,
  tool: ToolId,
  presence: Presence | undefined,
  supported: boolean,
): ConnectionState {
  const connection = project.connections?.[tool];
  if (connection?.lost) return 'lost';
  if (connection?.live) return 'connected';
  if (!supported) return 'unsupported';
  return presence === 'installed' ? 'needs-permission' : 'not-installed';
}

export function presenceState(presence: Presence | undefined): ConnectionState {
  return presence === 'installed' ? 'found' : 'not-installed';
}
