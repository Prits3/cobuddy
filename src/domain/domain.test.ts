import { describe, expect, it } from 'vitest';
import { checkStart } from './gate';
import { findOverlaps, normaliseTarget, sharedTargets } from './overlaps';
import { addDependency, estimateFinish, nextRef, removeTask, setStatus, wouldCreateCycle } from './tasks';
import type { Project, Task } from './types';

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    ref: `T-${id}`,
    title: id,
    summary: '',
    kind: 'code',
    status: 'queued',
    owner: { type: 'agent', id: `agent-${id}` },
    dependsOn: [],
    touches: [],
    latestUpdate: null,
    ...overrides,
  };
}

function project(tasks: Task[]): Project {
  return {
    id: 'p',
    name: 'Test',
    description: '',
    mode: 'team',
    createdAt: '2026-01-01T00:00:00.000Z',
    isSample: false,
    people: [],
    agents: [],
    tasks,
    overlapDecisions: [],
  };
}

describe('overlap detection', () => {
  it('treats folder spellings as the same target', () => {
    expect(normaliseTarget('./src/Auth/*')).toBe('src/auth');
    expect(normaliseTarget('src\\auth\\')).toBe('src/auth');
  });

  it('matches a file inside a folder, but not a folder with a similar name', () => {
    const folder = task('a', { touches: ['src/auth/'] });
    expect(sharedTargets(folder, task('b', { touches: ['src/auth/login.ts'] }))).toEqual(['src/auth/login.ts']);
    expect(sharedTargets(folder, task('c', { touches: ['src/authz/login.ts'] }))).toEqual([]);
  });

  it('matches named non-code work', () => {
    const first = task('a', { touches: ['Pricing page copy'] });
    expect(sharedTargets(first, task('b', { touches: ['pricing page copy'] }))).toHaveLength(1);
  });

  it('marks an overlap live only when both tasks are being worked on', () => {
    const touches = ['src/api.ts'];
    const live = findOverlaps(project([task('a', { status: 'active', touches }), task('b', { status: 'active', touches })]));
    const possible = findOverlaps(project([task('a', { status: 'active', touches }), task('b', { touches })]));
    expect(live[0].severity).toBe('live');
    expect(possible[0].severity).toBe('possible');
  });

  it('ignores finished tasks, shared owners and tasks that run in order', () => {
    const touches = ['src/api.ts'];
    const owner = { type: 'agent', id: 'same' } as const;
    expect(findOverlaps(project([task('a', { status: 'done', touches }), task('b', { touches })]))).toEqual([]);
    expect(findOverlaps(project([task('a', { owner, touches }), task('b', { owner, touches })]))).toEqual([]);
    expect(
      findOverlaps(
        project([
          task('a', { touches }),
          task('b', { dependsOn: ['a'] }),
          task('c', { dependsOn: ['b'], touches }),
        ]),
      ),
    ).toEqual([]);
  });

  it('raises an accepted overlap again when the shared work changes', () => {
    const base = project([task('a', { touches: ['src/api.ts'] }), task('b', { touches: ['src/api.ts'] })]);
    const [overlap] = findOverlaps(base);
    const decided = { ...base, overlapDecisions: [{ key: overlap.key, note: '', at: '', by: '' }] };
    expect(findOverlaps(decided)[0].accepted).toBe(true);

    const changed = {
      ...decided,
      tasks: decided.tasks.map((item) => ({ ...item, touches: ['src/api.ts', 'src/db.ts'] })),
    };
    expect(findOverlaps(changed)[0].accepted).toBe(false);
  });
});

describe('starting a task', () => {
  it('stops a task whose dependency is unfinished', () => {
    const base = project([task('a'), task('b', { dependsOn: ['a'] })]);
    const check = checkStart(base, findOverlaps(base), 'b');
    expect(check.allowed).toBe(false);
    expect(check.unfinishedDependencies.map((item) => item.id)).toEqual(['a']);
  });

  it('stops a task that overlaps moving work until a person decides', () => {
    const touches = ['src/api.ts'];
    const base = project([task('a', { status: 'active', touches }), task('b', { touches })]);
    const overlaps = findOverlaps(base);
    expect(checkStart(base, overlaps, 'b').allowed).toBe(false);

    const decided = { ...base, overlapDecisions: [{ key: overlaps[0].key, note: '', at: '', by: '' }] };
    expect(checkStart(decided, findOverlaps(decided), 'b').allowed).toBe(true);
  });

  it('allows a task once the other task is put in order before it', () => {
    const touches = ['src/api.ts'];
    const base = project([task('a', { status: 'active', touches }), task('b', { touches })]);
    const ordered = addDependency(base, 'b', 'a');
    const finished = setStatus(ordered, 'a', 'done', new Date());
    expect(checkStart(finished, findOverlaps(finished), 'b').allowed).toBe(true);
  });
});

describe('dependencies', () => {
  it('refuses to create a loop', () => {
    const tasks = [task('a'), task('b', { dependsOn: ['a'] }), task('c', { dependsOn: ['b'] })];
    expect(wouldCreateCycle(tasks, 'a', 'c')).toBe(true);
    expect(wouldCreateCycle(tasks, 'a', 'a')).toBe(true);
    expect(wouldCreateCycle(tasks, 'c', 'a')).toBe(false);
    expect(() => addDependency(project(tasks), 'a', 'c')).toThrow();
  });

  it('removes links to a deleted task', () => {
    const result = removeTask(project([task('a'), task('b', { dependsOn: ['a'] })]), 'a');
    expect(result.tasks.map((item) => item.dependsOn)).toEqual([[]]);
  });

  it('continues numbering from the highest reference', () => {
    expect(nextRef([task('a', { ref: 'T-02' }), task('b', { ref: 'T-09' })])).toBe('T-10');
    expect(nextRef([])).toBe('T-01');
  });
});

describe('finish estimates', () => {
  const now = new Date('2026-01-01T12:00:00.000Z');
  const startedAt = '2026-01-01T11:00:00.000Z';

  it('estimates from reported steps and elapsed time', () => {
    const estimate = estimateFinish(task('a', { status: 'active', startedAt, steps: { done: 2, total: 4 } }), now);
    expect(estimate?.minutesLeft).toBe(60);
    expect(estimate?.finishAt.toISOString()).toBe('2026-01-01T13:00:00.000Z');
  });

  it('gives no estimate without enough information', () => {
    expect(estimateFinish(task('a', { status: 'active', startedAt }), now)).toBeNull();
    expect(estimateFinish(task('a', { status: 'active', steps: { done: 1, total: 4 } }), now)).toBeNull();
    expect(estimateFinish(task('a', { status: 'active', startedAt, steps: { done: 0, total: 4 } }), now)).toBeNull();
    expect(estimateFinish(task('a', { status: 'review', startedAt, steps: { done: 1, total: 4 } }), now)).toBeNull();
  });
});
