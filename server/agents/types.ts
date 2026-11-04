import type { ToolId } from '../../src/domain/types.ts';

/** What an adapter reports, in the same shape for every agent tool. */
export type AgentReport =
  | { kind: 'session' }
  | { kind: 'tool'; text: string }
  | { kind: 'file'; text: string; files: string[] }
  | { kind: 'denied'; text: string }
  | { kind: 'finished'; text: string; costUsd?: number; output?: unknown }
  | { kind: 'failed'; text: string; costUsd?: number };

export type RunMode = 'ping' | 'plan' | 'task';

export interface RunRequest {
  mode: RunMode;
  folder: string;
  prompt: string;
  /** Asks for structured output, used for plans. */
  schema?: object;
}

export interface RunHandle {
  stop: () => void;
  /** The tool's process id, so a later start of CoBuddy can find an agent a hard kill left behind. */
  pid?: number;
}

export interface RunCallbacks {
  onReport: (report: AgentReport) => void;
  /** Called once, after the process has gone. */
  onExit: (detail: string) => void;
}

/**
 * Connects one agent tool to CoBuddy. To add a tool, implement this from
 * whatever real events it offers and register it in `server/agents/index.ts`.
 */
export interface AgentAdapter {
  tool: ToolId;
  label: string;
  /** Spending caps really passed to the tool, shown to people as they are. */
  limits?: { planUsd: number; taskUsd: number };
  start: (request: RunRequest, callbacks: RunCallbacks) => RunHandle;
}
