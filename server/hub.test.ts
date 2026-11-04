import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '../src/domain/events.ts';
import { adapters } from './agents/index.ts';
import type { RunCallbacks } from './agents/types.ts';
import { Hub } from './hub.ts';

let latest: RunCallbacks;
let stopped = false;
let dir: string;
const real = adapters['claude-code']!;

beforeEach(() => {
  stopped = false;
  dir = mkdtempSync(join(tmpdir(), 'cobuddy-hub-'));
  adapters['claude-code'] = {
    ...real,
    start: (_request, callbacks) => {
      latest = callbacks;
      return { stop: () => void (stopped = true) };
    },
  };
});

function watch(hub: Hub, after = 0) {
  const events: AgentEvent[] = [];
  hub.subscribe('p', after, (event) => events.push(event));
  return events;
}

const start = (hub: Hub) =>
  hub.startTask('p', {
    tool: 'claude-code',
    folder: '/work',
    taskId: 't',
    agentId: 'a',
    agentName: 'Claude Code 1',
    handoffs: [],
    brief: { goal: 'g', ref: 'T-01', title: 't', summary: '', touches: [], handoffs: [] },
  });

const kinds = (events: AgentEvent[]) => events.map((event) => event.kind);

describe('connecting', () => {
  it('says connected only after the agent really answers', () => {
    const hub = new Hub(dir);
    const events = watch(hub);
    hub.connect('p', 'claude-code', '/work', 2);
    expect(events).toEqual([]);
    latest.onReport({ kind: 'session' });
    expect(events).toEqual([]);
    latest.onReport({ kind: 'finished', text: 'ready' });
    expect(kinds(events)).toEqual(['connected']);
    expect(events[0].fromAgent).toBe(true);
  });

  it('reports a failed test, such as being signed out', () => {
    const hub = new Hub(dir);
    const events = watch(hub);
    hub.connect('p', 'claude-code', '/work', 1);
    latest.onReport({ kind: 'failed', text: 'Please run /login' });
    latest.onExit('exit code 1');
    expect(kinds(events)).toEqual(['connection-failed']);
    expect(events[0].text).toBe('Please run /login');
  });

  it('reports a tool that never starts', () => {
    const hub = new Hub(dir);
    const events = watch(hub);
    hub.connect('p', 'claude-code', '/work', 1);
    latest.onExit('spawn claude ENOENT');
    expect(kinds(events)).toEqual(['connection-failed']);
  });

  it('refuses tools with no adapter', () => {
    expect(() => new Hub(dir).connect('p', 'cursor', '/work', 1)).toThrow();
  });
});

describe('time limits and cancelling', () => {
  it('fails a connection test that never answers', () => {
    vi.useFakeTimers();
    const hub = new Hub(dir);
    const events = watch(hub);
    hub.connect('p', 'claude-code', '/work', 1);
    vi.advanceTimersByTime(61_000);
    expect(kinds(events)).toEqual(['connection-failed']);
    expect(stopped).toBe(true);
    vi.useRealTimers();
  });

  it('cancels a plan on request and says so', () => {
    const hub = new Hub(dir);
    const events = watch(hub);
    hub.plan('p', 'claude-code', '/work', 'goal');
    expect(hub.cancelPlan('p')).toBe(true);
    expect(stopped).toBe(true);
    latest.onExit('exit code 143');
    expect(kinds(events)).toEqual(['plan-started', 'plan-failed']);
    expect(events[1].text).toBe('Planning was cancelled.');
    expect(hub.cancelPlan('p')).toBe(false);
  });

  it('gives up on a plan that never finishes', () => {
    vi.useFakeTimers();
    const hub = new Hub(dir);
    const events = watch(hub);
    hub.plan('p', 'claude-code', '/work', 'goal');
    vi.advanceTimersByTime(11 * 60_000);
    expect(kinds(events)).toEqual(['plan-started', 'plan-failed']);
    vi.useRealTimers();
  });
});

describe('planning', () => {
  it('adds nothing when the plan isn’t usable', () => {
    const hub = new Hub(dir);
    const events = watch(hub);
    hub.plan('p', 'claude-code', '/work', 'goal');
    latest.onReport({ kind: 'finished', text: 'done', output: { tasks: [] } });
    expect(kinds(events)).toEqual(['plan-started', 'plan-failed']);
  });
});

describe('running a task', () => {
  it('blocks a task, not finishes it, when a permission was refused', () => {
    const hub = new Hub(dir);
    const events = watch(hub);
    start(hub);
    latest.onReport({ kind: 'session' });
    latest.onReport({ kind: 'denied', text: 'Write was refused outside the project folder' });
    latest.onReport({ kind: 'finished', text: 'I could not do it' });
    expect(kinds(events)).toEqual(['run-started', 'denied', 'run-blocked']);
  });

  it('only marks a task started once the agent reports in', () => {
    const hub = new Hub(dir);
    const events = watch(hub);
    start(hub);
    expect(events).toEqual([]);
  });

  it('reports an agent that dies as a lost connection, not a finish', () => {
    const hub = new Hub(dir);
    const events = watch(hub);
    start(hub);
    latest.onReport({ kind: 'session' });
    latest.onExit('exit code 137');
    expect(kinds(events)).toEqual(['run-started', 'connection-lost']);
  });

  it('reports a stop asked for by a person as a stop', () => {
    const hub = new Hub(dir);
    const events = watch(hub);
    start(hub);
    expect(hub.stopTask('p', 't')).toBe(true);
    expect(stopped).toBe(true);
    latest.onExit('exit code 143');
    expect(kinds(events)).toEqual(['run-stopped']);
  });

  it('won’t run one task twice', () => {
    const hub = new Hub(dir);
    start(hub);
    const first = latest;
    start(hub);
    expect(latest).toBe(first);
  });

  it('doesn’t report a run twice when the process exits after finishing', () => {
    const hub = new Hub(dir);
    const events = watch(hub);
    start(hub);
    latest.onReport({ kind: 'finished', text: 'Done' });
    latest.onExit('exit code 0');
    expect(kinds(events)).toEqual(['run-finished']);
  });
});

describe('agents left behind by a hard kill', () => {
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  function leftover(name: string, parent: number) {
    const bin = join(dir, name);
    symlinkSync('/bin/sleep', bin);
    const child = spawn(bin, ['60'], { stdio: 'ignore' });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'agents.pids.json'), JSON.stringify([{ pid: child.pid, parent }]));
    return child;
  }

  it('stops an agent whose CoBuddy has died', async () => {
    const child = leftover('claude', 2147483646);
    new Hub(dir);
    await wait(400);
    expect(alive(child.pid!)).toBe(false);
  });

  it('leaves alone a process that isn’t an agent, even with a dead parent', async () => {
    const child = leftover('something-else', 2147483646);
    new Hub(dir);
    await wait(400);
    expect(alive(child.pid!)).toBe(true);
    child.kill();
  });

  it('leaves alone an agent whose CoBuddy is still running', async () => {
    const child = leftover('claude', process.ppid);
    new Hub(dir);
    await wait(400);
    expect(alive(child.pid!)).toBe(true);
    child.kill();
  });
});

describe('after a restart', () => {
  it('replays only what a page hasn’t seen', () => {
    const hub = new Hub(dir);
    const events = watch(hub);
    hub.plan('p', 'claude-code', '/work', 'goal');
    latest.onReport({ kind: 'failed', text: 'no' });
    expect(watch(new Hub(dir), events[0].seq).map((event) => event.seq)).toEqual([events[1].seq]);
  });

  it('marks work that was in progress as lost', () => {
    const before = new Hub(dir);
    start(before);
    latest.onReport({ kind: 'session' });

    const replayed = watch(new Hub(dir));
    expect(kinds(replayed)).toEqual(['run-started', 'connection-lost']);
    expect(replayed.at(-1)?.fromAgent).toBe(false);
  });

  it('closes a plan that was interrupted', () => {
    const before = new Hub(dir);
    before.plan('p', 'claude-code', '/work', 'goal');
    expect(kinds(watch(new Hub(dir)))).toEqual(['plan-started', 'plan-failed']);
  });
});
