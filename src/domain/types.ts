export type ProjectMode = 'solo' | 'team';
export type TaskStatus = 'queued' | 'active' | 'blocked' | 'review' | 'done';
export type TaskKind = 'code' | 'research' | 'writing' | 'design' | 'docs';
export type ToolId = 'claude-code' | 'codex' | 'github-copilot' | 'cursor' | 'windsurf' | 'other';

export interface Person {
  id: string;
  name: string;
  role?: string;
  isYou?: boolean;
  isSample?: boolean;
}

export interface Agent {
  id: string;
  name: string;
  tool: ToolId;
  /** The person responsible for this agent. */
  personId: string;
  isSample?: boolean;
  /** Added by hand. It has no live sync, and CoBuddy never gives it work. */
  manual?: boolean;
}

export type OwnerRef = { type: 'person' | 'agent'; id: string } | null;

export interface TaskUpdate {
  text: string;
  at: string;
  by: string;
}

export interface Task {
  id: string;
  /** Short reference shown on the node, such as T-04. */
  ref: string;
  title: string;
  summary: string;
  kind: TaskKind;
  status: TaskStatus;
  owner: OwnerRef;
  dependsOn: string[];
  /** Files, folders or named pieces of work this task expects to change. */
  touches: string[];
  latestUpdate: TaskUpdate | null;
  startedAt?: string;
  /** Reported progress. Estimates are only made from this. */
  steps?: { done: number; total: number };
  /** The agent's own closing summary, passed on to the tasks that depend on this one. */
  result?: string;
  /** Files the agent reported changing. */
  changed?: string[];
  /** A person's instruction for the next run of this task. */
  instruction?: string;
  /** Put the task back in the queue, rather than block it, when its run stops. */
  requeueOnStop?: boolean;
}

export interface OverlapDecision {
  key: string;
  note: string;
  at: string;
  by: string;
}

export type ConnectionState = 'not-installed' | 'found' | 'needs-permission' | 'connected' | 'unsupported' | 'lost';

export interface Connection {
  /** True only after a real event has arrived from the tool. */
  live: boolean;
  lost?: boolean;
  note?: string;
  lastEventAt?: string;
  /** How many agents may run at once. */
  workers?: number;
}

export type RunState = 'idle' | 'planning' | 'ready' | 'running' | 'paused' | 'finished';

export interface ActivityItem {
  seq: number;
  at: string;
  kind: string;
  text: string;
  taskId?: string;
  agentId?: string;
  files?: string[];
}

export interface Project {
  id: string;
  name: string;
  description: string;
  mode: ProjectMode;
  createdAt: string;
  isSample: boolean;
  people: Person[];
  agents: Agent[];
  tasks: Task[];
  overlapDecisions: OverlapDecision[];
  goal?: string;
  /** The one folder this project's agents may work in. */
  folder?: string;
  connections?: Partial<Record<ToolId, Connection>>;
  runState?: RunState;
  activity?: ActivityItem[];
  lastSeq?: number;
  costUsd?: number;
}

export const STATUS_ORDER: TaskStatus[] = ['queued', 'active', 'blocked', 'review', 'done'];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: 'Not started',
  active: 'Working',
  blocked: 'Blocked',
  review: 'In review',
  done: 'Finished',
};

export const KIND_LABEL: Record<TaskKind, string> = {
  code: 'Code',
  research: 'Research',
  writing: 'Writing',
  design: 'Design',
  docs: 'Docs',
};

export const CONNECTION_LABEL: Record<ConnectionState, string> = {
  'not-installed': 'Not installed',
  found: 'Found on this computer',
  'needs-permission': 'Needs permission',
  connected: 'Connected — receiving live updates',
  unsupported: 'Live connection not supported yet',
  lost: 'Connection lost',
};

export const TOOL_LABEL: Record<ToolId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'github-copilot': 'GitHub Copilot',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  other: 'Other tool',
};
