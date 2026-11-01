import type { Overlap } from './overlaps';
import { overlapsForTask, otherTask } from './overlaps';
import type { Project, Task } from './types';

export interface StartCheck {
  allowed: boolean;
  unfinishedDependencies: Task[];
  unresolvedOverlaps: Overlap[];
}

/**
 * A task cannot be moved to Working while it would silently collide with other
 * work: its dependencies must be finished, and any overlap with a task that is
 * already moving must be resolved or accepted by a person first.
 */
export function checkStart(project: Project, overlaps: Overlap[], taskId: string): StartCheck {
  const task = project.tasks.find((candidate) => candidate.id === taskId);
  if (!task) return { allowed: false, unfinishedDependencies: [], unresolvedOverlaps: [] };

  const unfinishedDependencies = project.tasks.filter(
    (candidate) => task.dependsOn.includes(candidate.id) && candidate.status !== 'done',
  );
  const unresolvedOverlaps = overlapsForTask(overlaps, taskId).filter(
    (overlap) => !overlap.accepted && otherTask(overlap, taskId).status !== 'queued',
  );

  return {
    allowed: !unfinishedDependencies.length && !unresolvedOverlaps.length,
    unfinishedDependencies,
    unresolvedOverlaps,
  };
}
