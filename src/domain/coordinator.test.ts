import { describe, expect, it } from 'vitest';
import { connectionState, nextDispatches } from './coordinator';
import { applyEvent, liveAgents, type AgentEvent } from './events';
import { findOverlaps } from './overlaps';
import type { Project, Task } from './types';

let seq = 0;
const event = (kind: AgentEvent['kind'], extra: Partial<AgentEvent> = {}): AgentEvent => ({
  seq: (seq += 1),
  at: '2026-11-01T10:00:00.000Z',
  projectId: 'p',
  kind,
  text: kind,
  tool: 'claude-code',
  fromAgent: true,
  ...extra,
});

function task(id: string, overrides: Partial<Task> = {}): Task {
  return { id, ref: `T-${id}`, title: id, summary: '', kind: 'code', status: 'queued', owner: null, dependsOn: [], touches: [], latestUpdate: null, ...overrides };
}

function project(overrides: Partial<Project> = {}): Project {
  return { id: 'p', name: 'P', description: '', mode: 'solo', createdAt: '', isSample: false, people: [{ id: 'me', name: 'Me', isYou: true }], agents: [], tasks: [], overlapDecisions: [], ...overrides };
}

const connected = (overrides: Partial<Project> = {}) => ({ ...applyEvent(project(), event('connected', { workers: 2 })), ...overrides });
const agentIds = (dispatches: ReturnType<typeof nextDispatches>) => dispatches.map((item) => item.agent.id);

describe('connection states', () => {
  it('never says connected from detection alone', () => {
    expect(connectionState(project(), 'claude-code', 'installed', true)).toBe('needs-permission');
    expect(connectionState(project(), 'claude-code', 'absent', true)).toBe('not-installed');
  });

  it('never suggests installing a tool will add live updates', () => {
    expect(connectionState(project(), 'cursor', 'installed', false)).toBe('unsupported');
    expect(connectionState(project(), 'codex', 'absent', false)).toBe('unsupported');
  });

  it('says connected only after a real event', () => {
    const after = connected();
    expect(connectionState(after, 'claude-code', 'installed', true)).toBe('connected');
    expect(after.connections?.['claude-code']?.lastEventAt).toBe('2026-11-01T10:00:00.000Z');
  });

  it('isn’t connected by CoBuddy’s own events', () => {
    const after = applyEvent(project(), event('handoff', { fromAgent: false }));
    expect(connectionState(after, 'claude-code', 'installed', true)).toBe('needs-permission');
  });

  it('stays unconnected when the test fails', () => {
    const after = applyEvent(project(), event('connection-failed', { fromAgent: false, text: 'Please sign in' }));
    expect(connectionState(after, 'claude-code', 'installed', true)).toBe('needs-permission');
    expect(after.connections?.['claude-code']?.note).toBe('Please sign in');
  });

  it('stays connected through a pause, which belongs to the run', () => {
    expect(connectionState(connected({ runState: 'paused' }), 'claude-code', 'installed', true)).toBe('connected');
  });

  it('shows a lost connection', () => {
    const lost = applyEvent(connected(), event('connection-lost', { fromAgent: false }));
    expect(connectionState(lost, 'claude-code', 'installed', true)).toBe('lost');
    expect(liveAgents(lost)).toEqual([]);
  });
});

describe('applying events', () => {
  it('ignores events it has already seen', () => {
    const first = event('plan-started');
    const once = applyEvent(project(), first);
    expect(applyEvent(once, first)).toBe(once);
  });

  it('creates the graph from a plan, with nothing started', () => {
    const plan = [
      { key: 'a', title: 'A', summary: '', kind: 'code' as const, dependsOn: [], touches: [] },
      { key: 'b', title: 'B', summary: '', kind: 'code' as const, dependsOn: ['a'], touches: [] },
    ];
    const after = applyEvent(connected(), event('plan-ready', { plan }));
    expect(after.runState).toBe('ready');
    expect(after.tasks.map((item) => item.status)).toEqual(['queued', 'queued']);
    expect(after.tasks[1].dependsOn).toEqual([after.tasks[0].id]);
    expect(after.tasks.map((item) => item.owner?.id)).toEqual(['agent-claude-code-1', 'agent-claude-code-2']);
  });

  it('moves a task only when the agent reports it', () => {
    const start = connected({ tasks: [task('a')], runState: 'running' });
    expect(start.tasks[0].status).toBe('queued');
    const started = applyEvent(start, event('run-started', { taskId: 'a', agentId: 'agent-claude-code-1' }));
    expect(started.tasks[0].status).toBe('active');
    const finished = applyEvent(started, event('run-finished', { taskId: 'a', result: 'Done it', costUsd: 0.25 }));
    expect(finished.tasks[0]).toMatchObject({ status: 'done', result: 'Done it' });
    expect(finished.runState).toBe('finished');
    expect(finished.costUsd).toBe(0.25);
  });

  it('blocks a task when a run fails or is refused', () => {
    const start = connected({ tasks: [task('a', { status: 'active' }), task('b', { status: 'active' })] });
    const after = applyEvent(applyEvent(start, event('run-failed', { taskId: 'a' })), event('run-blocked', { taskId: 'b' }));
    expect(after.tasks.map((item) => item.status)).toEqual(['blocked', 'blocked']);
  });

  it('counts files really changed towards overlaps', () => {
    const start = connected({
      tasks: [task('a', { status: 'active', owner: { type: 'agent', id: 'one' } }), task('b', { status: 'active', owner: { type: 'agent', id: 'two' }, touches: ['src/x.ts'] })],
    });
    expect(findOverlaps(start)).toHaveLength(0);
    const after = applyEvent(start, event('file', { taskId: 'a', files: ['src/x.ts'] }));
    expect(after.tasks[0].changed).toEqual(['src/x.ts']);
    expect(findOverlaps(after)[0].severity).toBe('live');
  });

  it('requeues a stopped task only when asked to', () => {
    const start = connected({ tasks: [task('a', { status: 'active' }), task('b', { status: 'active', requeueOnStop: true })] });
    const after = applyEvent(applyEvent(start, event('run-stopped', { taskId: 'a', fromAgent: false })), event('run-stopped', { taskId: 'b', fromAgent: false }));
    expect(after.tasks.map((item) => item.status)).toEqual(['blocked', 'queued']);
  });
});

describe('handing out work', () => {
  const none = new Set<string>();

  it('does nothing until a person starts the run', () => {
    expect(nextDispatches(connected({ tasks: [task('a')], runState: 'ready' }), none)).toEqual([]);
    expect(nextDispatches(connected({ tasks: [task('a')], runState: 'paused' }), none)).toEqual([]);
  });

  it('does nothing without a connected agent', () => {
    expect(nextDispatches(project({ tasks: [task('a')], runState: 'running' }), none)).toEqual([]);
  });

  it('never uses a sample or hand-added agent', () => {
    const agents = [{ id: 'hand', name: 'Hand', tool: 'other' as const, personId: 'me' }];
    expect(nextDispatches(project({ agents, tasks: [task('a', { owner: { type: 'agent', id: 'hand' } })], runState: 'running' }), none)).toEqual([]);
  });

  const placeholder = { id: 'hand', name: 'Hand', tool: 'claude-code' as const, personId: 'me', manual: true };

  it('never treats a manual placeholder as connected, even for a connected tool', () => {
    const start = connected();
    const withPlaceholder = { ...start, agents: [placeholder, ...start.agents] };
    expect(liveAgents(withPlaceholder).map((agent) => agent.id)).toEqual(['agent-claude-code-1', 'agent-claude-code-2']);
  });

  it('leaves a manual placeholder’s tasks alone', () => {
    const start = connected({ tasks: [task('a', { owner: { type: 'agent', id: 'hand' } })], runState: 'running' });
    expect(nextDispatches({ ...start, agents: [...start.agents, placeholder] }, none)).toEqual([]);
  });

  it('runs no more agents than the person allowed', () => {
    const wide = connected();
    const narrowed = applyEvent(wide, event('connected', { workers: 1 }));
    expect(nextDispatches({ ...narrowed, tasks: [task('a'), task('b')], runState: 'running' }, none)).toHaveLength(1);
  });

  it('gives each free agent one task', () => {
    const start = connected({ tasks: [task('a'), task('b'), task('c')], runState: 'running' });
    expect(agentIds(nextDispatches(start, none))).toEqual(['agent-claude-code-1', 'agent-claude-code-2']);
  });

  it('waits for dependencies', () => {
    const start = connected({ tasks: [task('a'), task('b', { dependsOn: ['a'] })], runState: 'running' });
    expect(nextDispatches(start, none).map((item) => item.task.id)).toEqual(['a']);
  });

  it('doesn’t start one task twice', () => {
    const start = connected({ tasks: [task('a')], runState: 'running' });
    expect(nextDispatches(start, new Set(['a']))).toEqual([]);
  });

  it('won’t run two overlapping tasks together', () => {
    const start = connected({ tasks: [task('a', { touches: ['src/x.ts'] }), task('b', { touches: ['src/x.ts'] })], runState: 'running' });
    expect(nextDispatches(start, none).map((item) => item.task.id)).toEqual(['a']);
  });

  it('leaves a person’s tasks alone', () => {
    const start = connected({ tasks: [task('a', { owner: { type: 'person', id: 'me' } })], runState: 'running' });
    expect(nextDispatches(start, none)).toEqual([]);
  });

  it('hands a finished task’s result to the next agent', () => {
    const start = connected({
      tasks: [task('a', { status: 'done', result: 'Built the API', owner: { type: 'agent', id: 'agent-claude-code-1' } }), task('b', { dependsOn: ['a'] })],
      runState: 'running',
    });
    expect(nextDispatches(start, none)[0].handoffs).toEqual([{ ref: 'T-a', title: 'a', fromAgent: 'Claude Code 1', result: 'Built the API' }]);
  });
});
