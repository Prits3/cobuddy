import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Handoff } from '../src/domain/coordinator.ts';
import type { AgentEvent } from '../src/domain/events.ts';
import type { ToolId } from '../src/domain/types.ts';
import { adapters } from './agents/index.ts';
import type { AgentAdapter, AgentReport, RunHandle } from './agents/types.ts';
import { PING_PROMPT, PLAN_SCHEMA, planPrompt, taskPrompt, validatePlan, type TaskBrief } from './prompts.ts';

type NewEvent = Omit<AgentEvent, 'seq' | 'at' | 'projectId' | 'tool'> & { tool?: ToolId };
type Listener = (event: AgentEvent) => void;

interface ProjectLog {
  events: AgentEvent[];
  seq: number;
  listeners: Set<Listener>;
}

const IDLE_LIMIT_MS = 15 * 60 * 1000;
const RUN_ENDS = new Set(['run-finished', 'run-blocked', 'run-failed', 'run-stopped', 'connection-lost']);

/** Keeps each project's real events on disk, and owns the agent processes that produce them. */
export class Hub {
  private logs = new Map<string, ProjectLog>();
  private runs = new Map<string, RunHandle>();
  private stopping = new Set<string>();
  private planning = new Set<string>();

  constructor(private dir = join(process.cwd(), '.cobuddy', 'events')) {}

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
    const fail = (text: string) => {
      if (closed) return;
      closed = true;
      this.emit(projectId, tool, { kind: 'connection-failed', fromAgent: false, text });
    };

    adapter.start({ mode: 'ping', folder, prompt: PING_PROMPT }, {
      onReport: (report) => {
        if (report.kind === 'session') heard = true;
        if (report.kind === 'finished' && heard && !closed) {
          closed = true;
          this.emit(projectId, tool, { kind: 'connected', fromAgent: true, workers, text: `${adapter.label} answered from this project’s folder.`, costUsd: report.costUsd });
        }
        if (report.kind === 'failed') fail(report.text);
      },
      onExit: (detail) => fail(`${adapter.label} didn’t answer: ${detail}`),
    });
  }

  plan(projectId: string, tool: ToolId, folder: string, goal: string) {
    const adapter = this.adapter(tool);
    if (this.planning.has(projectId)) return;
    this.planning.add(projectId);
    this.emit(projectId, tool, { kind: 'plan-started', fromAgent: false, text: `Asked ${adapter.label} to plan the goal.` });

    let settled = false;
    const failed = (text: string, costUsd?: number) => {
      if (settled) return;
      settled = true;
      this.planning.delete(projectId);
      this.emit(projectId, tool, { kind: 'plan-failed', fromAgent: false, text, costUsd });
    };

    adapter.start({ mode: 'plan', folder, prompt: planPrompt(goal), schema: PLAN_SCHEMA }, {
      onReport: (report) => {
        if (report.kind === 'tool') this.emit(projectId, tool, { kind: 'tool', fromAgent: true, text: report.text });
        if (report.kind === 'failed') failed(report.text, report.costUsd);
        if (report.kind === 'finished') {
          const plan = validatePlan(report.output);
          if (!plan) return failed('The plan that came back wasn’t usable, so nothing was added.', report.costUsd);
          settled = true;
          this.planning.delete(projectId);
          this.emit(projectId, tool, { kind: 'plan-ready', fromAgent: true, plan, costUsd: report.costUsd, text: `Plan ready with ${plan.length} ${plan.length === 1 ? 'task' : 'tasks'}.` });
        }
      },
      onExit: (detail) => failed(`Planning stopped: ${detail}`),
    });
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

    const handle = adapter.start({ mode: 'task', folder, prompt: taskPrompt(brief) }, {
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
  }
}
