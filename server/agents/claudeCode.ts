import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import type { AgentAdapter, AgentReport, RunMode, RunRequest } from './types.ts';

const EDIT_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);

/** Resolves links such as /tmp on macOS, including for files that don't exist yet. */
function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(canonical(parent), basename(path));
  }
}

function projectPath(folder: string, path: unknown): string | null {
  if (typeof path !== 'string' || !path) return null;
  const inside = relative(canonical(folder), canonical(path));
  return inside.startsWith('..') || isAbsolute(inside) ? null : inside;
}

function reportToolUse(name: string, input: Record<string, unknown>, folder: string): AgentReport {
  const path = projectPath(folder, input.file_path ?? input.notebook_path);
  if (EDIT_TOOLS.has(name)) {
    return path ? { kind: 'file', text: `Changed ${path}`, files: [path] } : { kind: 'tool', text: 'Tried to change a file outside the project folder' };
  }
  if (name === 'Read') return { kind: 'tool', text: path ? `Read ${path}` : 'Tried to read a file outside the project folder' };
  if (name === 'Glob' || name === 'Grep') return { kind: 'tool', text: 'Searched the project' };
  return { kind: 'tool', text: `Used ${name}` };
}

// Claude Code's own way of returning structured output, not work worth showing.
const INTERNAL_TOOLS = new Set(['StructuredOutput']);

const FAILURE_TEXT: Record<string, string> = {
  error_max_budget_usd: 'Stopped at the budget limit for this run.',
  error_max_turns: 'Stopped at the turn limit for this run.',
};

/**
 * Turns one line of Claude Code's stream into reports. Only names of tools,
 * project-relative paths and the closing summary pass through. Thinking and
 * the agent's in-progress text are dropped here on purpose.
 */
export function parseClaudeLine(line: string, folder: string): AgentReport[] {
  let event: Record<string, any>;
  try {
    event = JSON.parse(line);
  } catch {
    return [];
  }

  if (event.type === 'system' && event.subtype === 'init') return [{ kind: 'session' }];

  if (event.type === 'assistant') {
    const content: Record<string, any>[] = event.message?.content ?? [];
    return content.filter((block) => block.type === 'tool_use' && !INTERNAL_TOOLS.has(block.name)).map((block) => reportToolUse(block.name, block.input ?? {}, folder));
  }

  if (event.type === 'result') {
    const denied: AgentReport[] = (event.permission_denials ?? []).map((denial: Record<string, any>) => {
      const path = projectPath(folder, denial.tool_input?.file_path);
      return { kind: 'denied', text: path ? `${denial.tool_name} was refused on ${path}` : `${denial.tool_name} was refused outside the project folder` };
    });
    const costUsd = typeof event.total_cost_usd === 'number' ? event.total_cost_usd : undefined;
    if (event.subtype === 'success' && !event.is_error) {
      return [...denied, { kind: 'finished', text: String(event.result ?? '').trim(), costUsd, output: event.structured_output }];
    }
    const text = FAILURE_TEXT[event.subtype] ?? String(event.result ?? event.errors?.[0] ?? 'Claude Code reported an error.').slice(0, 300);
    return [...denied, { kind: 'failed', text, costUsd }];
  }

  return [];
}

const model = process.env.COBUDDY_MODEL ?? 'sonnet';
const budget = (name: string, fallback: string) => process.env[name] ?? fallback;

export const claudeLimits = {
  planUsd: Number(budget('COBUDDY_PLAN_BUDGET_USD', '1')),
  taskUsd: Number(budget('COBUDDY_TASK_BUDGET_USD', '2')),
};

const SETTINGS: Record<RunMode, { model: string; budget: string; tools: string; permissionMode?: string }> = {
  ping: { model: 'haiku', budget: '0.02', tools: '' },
  plan: { model, budget: String(claudeLimits.planUsd), tools: 'Read,Glob,Grep' },
  task: { model, budget: String(claudeLimits.taskUsd), tools: 'Read,Write,Edit,Glob,Grep', permissionMode: 'acceptEdits' },
};

/**
 * No settings are loaded at all. Personal ones would hand an agent the folders
 * and commands someone allowed for their own sessions, and a project's own
 * could widen its access or run hooks, which matters in a downloaded repo.
 * With no shell in the tool list either, an agent stays inside its folder.
 */
export function claudeArgs(request: RunRequest): string[] {
  const settings = SETTINGS[request.mode];
  return [
    '-p', request.prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--model', settings.model,
    '--max-budget-usd', settings.budget,
    '--tools', settings.tools,
    '--setting-sources', '',
    '--strict-mcp-config',
    '--no-session-persistence',
    ...(settings.permissionMode ? ['--permission-mode', settings.permissionMode] : []),
    ...(request.schema ? ['--json-schema', JSON.stringify(request.schema)] : []),
  ];
}

export const claudeCode: AgentAdapter = {
  tool: 'claude-code',
  label: 'Claude Code',
  limits: claudeLimits,
  start(request, { onReport, onExit }) {
    // Started from inside a Claude Code terminal, these would confuse the child.
    const { CLAUDECODE: _session, CLAUDE_CODE_ENTRYPOINT: _entry, ...env } = process.env;
    const child = spawn('claude', claudeArgs(request), { cwd: request.folder, env, stdio: ['ignore', 'pipe', 'pipe'] });

    let buffer = '';
    let errors = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) parseClaudeLine(line, request.folder).forEach(onReport);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      errors = (errors + chunk).slice(-300);
    });

    let exited = false;
    const exit = (detail: string) => {
      if (!exited) onExit(detail);
      exited = true;
    };
    child.on('error', (error) => exit(error.message));
    child.on('close', (code) => exit(errors.trim() || `exit code ${code}`));

    return { stop: () => void child.kill('SIGTERM'), pid: child.pid };
  },
};
