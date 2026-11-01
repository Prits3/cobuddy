import type { Project, Task, TaskStatus } from './types';

export function dependsOnTransitively(tasks: Task[], taskId: string, targetId: string): boolean {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const seen = new Set<string>();
  const stack = [...(byId.get(taskId)?.dependsOn ?? [])];

  while (stack.length) {
    const id = stack.pop()!;
    if (id === targetId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(byId.get(id)?.dependsOn ?? []));
  }
  return false;
}

export function dependents(tasks: Task[], taskId: string): Task[] {
  return tasks.filter((task) => task.dependsOn.includes(taskId));
}

/** True when making `taskId` depend on `dependencyId` would create a loop. */
export function wouldCreateCycle(tasks: Task[], taskId: string, dependencyId: string): boolean {
  return taskId === dependencyId || dependsOnTransitively(tasks, dependencyId, taskId);
}

export function addDependency(project: Project, taskId: string, dependencyId: string): Project {
  if (wouldCreateCycle(project.tasks, taskId, dependencyId)) {
    throw new Error('That order would create a loop between tasks.');
  }
  return {
    ...project,
    tasks: project.tasks.map((task) =>
      task.id === taskId && !task.dependsOn.includes(dependencyId)
        ? { ...task, dependsOn: [...task.dependsOn, dependencyId] }
        : task,
    ),
  };
}

export function removeTask(project: Project, taskId: string): Project {
  return {
    ...project,
    tasks: project.tasks
      .filter((task) => task.id !== taskId)
      .map((task) => ({ ...task, dependsOn: task.dependsOn.filter((id) => id !== taskId) })),
  };
}

export function setStatus(project: Project, taskId: string, status: TaskStatus, now: Date): Project {
  return {
    ...project,
    tasks: project.tasks.map((task) => {
      if (task.id !== taskId) return task;
      const startedNow = status === 'active' && !task.startedAt;
      return { ...task, status, ...(startedNow ? { startedAt: now.toISOString() } : {}) };
    }),
  };
}

export function nextRef(tasks: Task[]): string {
  const highest = tasks.reduce((max, task) => Math.max(max, Number(task.ref.slice(2)) || 0), 0);
  return `T-${String(highest + 1).padStart(2, '0')}`;
}

export interface Estimate {
  finishAt: Date;
  minutesLeft: number;
  basis: string;
}

/**
 * Estimates a finish time from reported progress only. Without a start time and
 * at least one finished step there is nothing honest to say, so it returns null.
 */
export function estimateFinish(task: Task, now: Date): Estimate | null {
  if (task.status !== 'active' || !task.startedAt || !task.steps) return null;
  const { done, total } = task.steps;
  if (done < 1 || total <= done) return null;

  const elapsed = now.getTime() - new Date(task.startedAt).getTime();
  if (elapsed <= 0) return null;

  const remaining = (elapsed / done) * (total - done);
  return {
    finishAt: new Date(now.getTime() + remaining),
    minutesLeft: Math.max(1, Math.round(remaining / 60000)),
    basis: `${done} of ${total} steps reported finished`,
  };
}
