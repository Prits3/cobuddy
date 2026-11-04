import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Handoff } from '../src/domain/coordinator.ts';
import type { AgentEvent } from '../src/domain/events.ts';
import type { ToolId } from '../src/domain/types.ts';
import { adapters } from './agents/index.ts';
import type { AgentAdapter, AgentReport, RunCallbacks, RunHandle } from './agents/types.ts';
import { PING_PROMPT, PLAN_SCHEMA, planPrompt, taskPrompt, validatePlan, type TaskBrief } from './prompts.ts';

type NewEvent = Omit<AgentEvent, 'seq' | 'at' | 'projectId' | 'tool'> & { tool?: ToolId };
type Listener = (event: AgentEvent) => void;

interface ProjectLog {
  events: AgentEvent[];
  seq: number;
  listeners: Set<Listener>;
}

const IDLE_LIMIT_MS = 15 * 60 * 1000;
const CONNECT_LIMIT_MS = 60 * 1000;
const PLAN_LIMIT_MS = 10 * 60 * 1000;
const RUN_ENDS = new Set(['run-finished', 'run-blocked', 'run-failed', 'run-stopped', 'connection-lost']);

const hubs = new Set<Hub>();
let exitHooked = false;

/**
 * Ctrl+C, a terminate signal, a closed terminal and a normal exit all stop the
 * agents too, so none outlives CoBuddy. A signal ends the process without an
 * exit event, so each one is handled here.
 */
function stopAgentsOnExit() {
  if (exitHooked) return;
  exitHooked = true;
  const stopAll = () => hubs.forEach((hub) => hub.shutdown());
  process.on('exit', stopAll);
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]] as const) {
    process.once(signal, () => {
      stopAll();
      process.exit(code);
    });
  }
}

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Keeps each project's real events on disk, and owns the agent processes that produce them. */
export class Hub {
  private logs = new Map<string, ProjectLog>();
  private runs = new Map<string, RunHandle>();
  private stopping = new Set<string>();
  private planning = new Map<string, { stop: () => void; cancelled: boolean }>();

  constructor(private dir = join(process.cwd(), '.cobuddy', 'events')) {
    hubs.add(this);
    stopAgentsOnExit();
    this.reapOrphans();
  }

  private get pidFile() {
    return join(this.dir, 'agents.pids.json');
  }

  private readPids(): { pid: number; parent: number }[] {
    try {
      return JSON.parse(readFileSync(this.pidFile, 'utf8'));
    } catch {
      return [];
    }
  }

  private writePids(pids: { pid: number; parent: number }[]) {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.pidFile, JSON.stringify(pids));
  }

  /**
   * A hard kill can't be intercepted, so it can leave an agent running with
   * nothing watching it. Agents whose CoBuddy has died are stopped at the next
   * start, after checking the process is still the agent and not a reused id.
   */
  private reapOrphans() {
    const keep = this.readPids().filter(({ pid, parent }) => {
      if (!isAlive(pid)) return false;
      if (isAlive(parent) && parent !== process.pid) return true;
      try {
        const name = execFileSync('ps', ['-o', 'comm=', '-p', String(pid)], { encoding: 'utf8' }).trim();
        if (/(^|\/)claude$/.test(name)) process.kill(pid, 'SIGTERM');
      } catch {
        // The process ended while we were looking.
      }
      return false;
    });
    if (existsSync(this.pidFile)) this.writePids(keep);
  }

  private track(pid: number | undefined) {
    if (pid) this.writePids([...this.readPids(), { pid, parent: process.pid }]);
  }

  private untrack(pid: number | undefined) {
    if (pid) this.writePids(this.readPids().filter((item) => item.pid !== pid));
  }

  /** Starts an agent and records it, so it can be found again if CoBuddy is killed. */
  private launch(adapter: AgentAdapter, request: Parameters<AgentAdapter['start']>[0], callbacks: RunCallbacks): RunHandle {
    const handle: RunHandle = adapter.start(request, {
      ...callbacks,
      onExit: (detail) => {
        this.untrack(handle.pid);
        callbacks.onExit(detail);
      },
    });
    this.track(handle.pid);
    return handle;
  }

  private file(projectId: string) {
    return join(this.dir, `${projectId}.jsonl`);
  }

  private log(projectId: string): ProjectLog {
    const known = this.logs.get(projectId);
    if (known) return known;

    const path = this.file(projectId);
    const events: AgentEvent[] = existsSync(path)
      ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
      : [];
    const log: ProjectLog = { events, seq: events.at(-1)?.seq ?? Date.now(), listeners: new Set() };
    this.logs.set(projectId, log);
    this.closeInterrupted(projectId, log);
    return log;
  }

  /** Runs still open in the log belonged to a server that has since gone away. */
  private closeInterrupted(projectId: string, log: ProjectLog) {
    const open = new Map<string, AgentEvent>();
    let planOpen = false;
    for (const event of log.events) {
      if (event.kind === 'run-started' && event.taskId) open.set(event.taskId, event);
      if (RUN_ENDS.has(event.kind) && event.taskId) open.delete(event.taskId);
      if (event.kind === 'plan-started') planOpen = true;
      if (event.kind === 'plan-ready' || event.kind === 'plan-failed') planOpen = false;
    }
    for (const event of open.values()) {
      this.emit(projectId, event.tool, {
        kind: 'connection-lost',
        fromAgent: false,
        taskId: event.taskId,
        agentId: event.agentId,
        text: 'CoBuddy restarted while this agent was working, so its last updates may be missing.',
      });
    }
    if (planOpen) this.emit(projectId, 'claude-code', { kind: 'plan-failed', fromAgent: false, text: 'CoBuddy restarted before the plan finished.' });
  }

  private emit(projectId: string, tool: ToolId, event: NewEvent): AgentEvent {
    const log = this.log(projectId);
    log.seq += 1;
    const full: AgentEvent = { tool, ...event, seq: log.seq, at: new Date().toISOString(), projectId };
    log.events.push(full);
    mkdirSync(this.dir, { recursive: true });
    appendFileSync(this.file(projectId), `${JSON.stringify(full)}\n`);
    log.listeners.forEach((listener) => listener(full));
    return full;
  }

  subscribe(projectId: string, after: number, listener: Listener): () => void {
    const log = this.log(projectId);
    log.events.filter((event) => event.seq > after).forEach(listener);
    log.listeners.add(listener);
    return () => log.listeners.delete(listener);
  }

  private adapter(tool: ToolId): AgentAdapter {
    const adapter = adapters[tool];
    if (!adapter) throw new Error('CoBuddy can’t receive live updates from this tool yet.');
    return adapter;
  }

  /** A tool counts as connected only once a real event has come back from it. */
  connect(projectId: string, tool: ToolId, folder: string, workers: number) {
    const adapter = this.adapter(tool);
    let heard = false;
    let closed = false;
    let timer: NodeJS.Timeout | undefined;
    const fail = (text: string) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      this.emit(projectId, tool, { kind: 'connection-failed', fromAgent: false, text });
    };

    const handle = this.launch(adapter, { mode: 'ping', folder, prompt: PING_PROMPT }, {
      onReport: (report) => {
        if (report.kind === 'session') heard = true;
        if (report.kind === 'finished' && heard && !closed) {
          closed = true;
          clearTimeout(timer);
          this.emit(projectId, tool, { kind: 'connected', fromAgent: true, workers, text: `${adapter.label} answered from this project’s folder.`, costUsd: report.costUsd });
        }
        if (report.kind === 'failed') fail(report.text);
      },
      onExit: (detail) => fail(`${adapter.label} didn’t answer: ${detail}`),
    });
    timer = setTimeout(() => {
      fail(`${adapter.label} didn’t reply within ${CONNECT_LIMIT_MS / 1000} seconds.`);
      handle.stop();
    }, CONNECT_LIMIT_MS);
  }

  plan(projectId: string, tool: ToolId, folder: string, goal: string) {
    const adapter = this.adapter(tool);
    if (this.planning.has(projectId)) return;
    const plan = { stop: () => {}, cancelled: false };
    this.planning.set(projectId, plan);
    this.emit(projectId, tool, { kind: 'plan-started', fromAgent: false, text: `Asked ${adapter.label} to plan the goal.` });

    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const failed = (text: string, costUsd?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.planning.delete(projectId);
      this.emit(projectId, tool, { kind: 'plan-failed', fromAgent: false, text: plan.cancelled ? 'Planning was cancelled.' : text, costUsd });
    };

    const handle = this.launch(adapter, { mode: 'plan', folder, prompt: planPrompt(goal), schema: PLAN_SCHEMA }, {
      onReport: (report) => {
        if (report.kind === 'tool') this.emit(projectId, tool, { kind: 'tool', fromAgent: true, text: report.text });
        if (report.kind === 'failed') failed(report.text, report.costUsd);
        if (report.kind === 'finished') {
          const plan = validatePlan(report.output);
          if (!plan) return failed('The plan that came back wasn’t usable, so nothing was added.', report.costUsd);
          settled = true;
          clearTimeout(timer);
          this.planning.delete(projectId);
          this.emit(projectId, tool, { kind: 'plan-ready', fromAgent: true, plan, costUsd: report.costUsd, text: `Plan ready with ${plan.length} ${plan.length === 1 ? 'task' : 'tasks'}.` });
        }
      },
      onExit: (detail) => failed(`Planning stopped: ${detail}`),
    });
    plan.stop = handle.stop;
    timer = setTimeout(() => {
      failed(`Planning took longer than ${PLAN_LIMIT_MS / 60000} minutes, so CoBuddy stopped it.`);
      handle.stop();
    }, PLAN_LIMIT_MS);
  }

  cancelPlan(projectId: string) {
    const plan = this.planning.get(projectId);
    if (!plan) return false;
    plan.cancelled = true;
    plan.stop();
    return true;
  }

  private key(projectId: string, taskId: string) {
    return `${projectId}:${taskId}`;
  }

  startTask(projectId: string, input: { tool: ToolId; folder: string; taskId: string; agentId: string; agentName: string; brief: TaskBrief; handoffs: Handoff[] }) {
    const { tool, folder, taskId, agentId, agentName, brief, handoffs } = input;
    const adapter = this.adapter(tool);
    const key = this.key(projectId, taskId);
    if (this.runs.has(key)) return;

    const send = (event: Omit<NewEvent, 'taskId' | 'agentId'>) => this.emit(projectId, tool, { ...event, taskId, agentId });

    let idle: NodeJS.Timeout;
    let ended = false;
    let denied = false;
    const end = (event: Omit<NewEvent, 'taskId' | 'agentId'>) => {
      if (ended) return;
      ended = true;
      clearTimeout(idle);
      this.runs.delete(key);
      this.stopping.delete(key);
      send(event);
    };
    const watch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        end({ kind: 'connection-lost', fromAgent: false, text: `No update from ${agentName} for 15 minutes, so CoBuddy stopped waiting.` });
        handle.stop();
      }, IDLE_LIMIT_MS);
    };

    const onReport = (report: AgentReport) => {
      watch();
      if (report.kind === 'session') send({ kind: 'run-started', fromAgent: true, text: `${agentName} started ${brief.ref}.` });
      if (report.kind === 'tool') send({ kind: 'tool', fromAgent: true, text: report.text });
      if (report.kind === 'file') send({ kind: 'file', fromAgent: true, text: report.text, files: report.files });
      if (report.kind === 'denied') {
        denied = true;
        send({ kind: 'denied', fromAgent: true, text: report.text });
      }
      if (report.kind === 'failed') end({ kind: 'run-failed', fromAgent: true, text: report.text, costUsd: report.costUsd });
      if (report.kind === 'finished') {
        const result = report.text.slice(0, 2000);
        end(denied
          ? { kind: 'run-blocked', fromAgent: true, text: 'Stopped short because a permission was refused.', result, costUsd: report.costUsd }
          : { kind: 'run-finished', fromAgent: true, text: `${agentName} reported ${brief.ref} finished.`, result, costUsd: report.costUsd });
      }
    };

    for (const handoff of handoffs) {
      send({ kind: 'handoff', fromAgent: false, text: `CoBuddy passed ${handoff.fromAgent}’s result from ${handoff.ref} to ${agentName}.` });
    }

    const handle = this.launch(adapter, { mode: 'task', folder, prompt: taskPrompt(brief) }, {
      onReport,
      onExit: (detail) => {
        const stopped = this.stopping.has(key);
        end(stopped
          ? { kind: 'run-stopped', fromAgent: false, text: `${agentName} was stopped.` }
          : { kind: 'connection-lost', fromAgent: false, text: `${agentName} ended without finishing: ${detail}` });
      },
    });
    this.runs.set(key, handle);
    watch();
  }

  stopTask(projectId: string, taskId: string) {
    const key = this.key(projectId, taskId);
    const run = this.runs.get(key);
    if (!run) return false;
    this.stopping.add(key);
    run.stop();
    return true;
  }

  shutdown() {
    this.runs.forEach((run) => run.stop());
    this.planning.forEach((plan) => plan.stop());
  }
}
