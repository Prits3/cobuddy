import type { Project, Task } from './types';
import { dependsOnTransitively } from './tasks';

export interface Overlap {
  key: string;
  a: Task;
  b: Task;
  shared: string[];
  /** `live` means both tasks are being worked on right now. */
  severity: 'live' | 'possible';
  accepted: boolean;
}

const isGlob = /[*?]/;

/** `src/auth/*`, `./src/auth/` and `src/auth` all describe the same place. */
export function normaliseTarget(target: string): string {
  let value = target.trim().toLowerCase().replace(/\\/g, '/').replace(/^\.\//, '');
  const glob = value.search(isGlob);
  if (glob !== -1) value = value.slice(0, glob);
  return value.replace(/\/+$/, '');
}

function sharedTarget(first: string, second: string): string | null {
  const a = normaliseTarget(first);
  const b = normaliseTarget(second);
  if (!a || !b) return null;
  if (a === b) return first.length >= second.length ? first : second;
  if (b.startsWith(`${a}/`)) return second;
  if (a.startsWith(`${b}/`)) return first;
  return null;
}

export function sharedTargets(a: Task, b: Task): string[] {
  const shared = new Set<string>();
  for (const first of a.touches) {
    for (const second of b.touches) {
      const target = sharedTarget(first, second);
      if (target) shared.add(target);
    }
  }
  return [...shared].sort();
}

function sameOwner(a: Task, b: Task): boolean {
  return Boolean(a.owner && b.owner && a.owner.type === b.owner.type && a.owner.id === b.owner.id);
}

export function overlapKey(a: Task, b: Task, shared: string[]): string {
  return [[a.id, b.id].sort().join('+'), shared.map(normaliseTarget).sort().join('|')].join('::');
}

/**
 * Finds unfinished tasks that may change the same work at the same time.
 * Tasks already linked by a dependency run in order, so they are not overlaps.
 * Accepting an overlap only covers the exact work reviewed: if the shared
 * targets change, the key changes and the overlap is raised again.
 */
export function findOverlaps(project: Project): Overlap[] {
  const open = project.tasks.filter((task) => task.status !== 'done');
  const accepted = new Set(project.overlapDecisions.map((decision) => decision.key));
  const overlaps: Overlap[] = [];

  for (let i = 0; i < open.length; i += 1) {
    for (let j = i + 1; j < open.length; j += 1) {
      const a = open[i];
      const b = open[j];
      if (sameOwner(a, b)) continue;
      if (dependsOnTransitively(project.tasks, a.id, b.id)) continue;
      if (dependsOnTransitively(project.tasks, b.id, a.id)) continue;

      const shared = sharedTargets(a, b);
      if (!shared.length) continue;

      const key = overlapKey(a, b, shared);
      overlaps.push({
        key,
        a,
        b,
        shared,
        severity: a.status === 'active' && b.status === 'active' ? 'live' : 'possible',
        accepted: accepted.has(key),
      });
    }
  }

  return overlaps.sort((x, y) => Number(x.accepted) - Number(y.accepted) || (x.severity === 'live' ? -1 : 1) - (y.severity === 'live' ? -1 : 1));
}

export function overlapsForTask(overlaps: Overlap[], taskId: string): Overlap[] {
  return overlaps.filter((overlap) => overlap.a.id === taskId || overlap.b.id === taskId);
}

export function otherTask(overlap: Overlap, taskId: string): Task {
  return overlap.a.id === taskId ? overlap.b : overlap.a;
}
