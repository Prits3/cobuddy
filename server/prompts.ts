import type { Handoff } from '../src/domain/coordinator.ts';
import type { PlanTask } from '../src/domain/events.ts';
import { KIND_LABEL, type TaskKind } from '../src/domain/types.ts';

export const PING_PROMPT = 'Reply with the single word ready.';

const KINDS = Object.keys(KIND_LABEL) as TaskKind[];
const MAX_TASKS = 12;

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          kind: { type: 'string', enum: KINDS },
          dependsOn: { type: 'array', items: { type: 'string' } },
          touches: { type: 'array', items: { type: 'string' } },
        },
        required: ['key', 'title', 'summary', 'kind', 'dependsOn', 'touches'],
      },
    },
  },
  required: ['tasks'],
};

export function planPrompt(goal: string): string {
  return [
    'You are planning work for a team of AI agents. Look at the current folder, then break this goal into tasks.',
    `Goal: ${goal}`,
    `Use as few tasks as the goal really needs, and at most ${MAX_TASKS}.`,
    'Each task must be small enough for one agent working alone, and agents can only read, search and edit files. They cannot run commands.',
    'key: a short unique id. title: under 6 words. summary: one plain sentence saying what done looks like.',
    'dependsOn: the keys of tasks that must finish first. touches: the files or folders it will change, relative to this folder.',
    'Do not change anything. Only plan.',
  ].join('\n');
}

/** Rejects a plan that isn't a usable graph, instead of showing something broken. */
export function validatePlan(output: unknown): PlanTask[] | null {
  const tasks = (output as { tasks?: unknown } | null)?.tasks;
  if (!Array.isArray(tasks) || !tasks.length || tasks.length > MAX_TASKS) return null;

  const plan: PlanTask[] = [];
  const keys = new Set<string>();
  for (const raw of tasks) {
    const { key, title, summary, kind, dependsOn, touches } = raw as PlanTask;
    if (typeof key !== 'string' || !key || keys.has(key) || typeof title !== 'string' || !title.trim()) return null;
    keys.add(key);
    plan.push({
      key,
      title: title.trim(),
      summary: typeof summary === 'string' ? summary.trim() : '',
      kind: KINDS.includes(kind) ? kind : 'code',
      dependsOn: Array.isArray(dependsOn) ? dependsOn.filter((item) => typeof item === 'string') : [],
      touches: Array.isArray(touches) ? touches.filter((item) => typeof item === 'string') : [],
    });
  }

  for (const task of plan) task.dependsOn = task.dependsOn.filter((key) => keys.has(key) && key !== task.key);

  // Tasks in a loop could never start.
  const done = new Set<string>();
  while (done.size < plan.length) {
    const ready = plan.filter((task) => !done.has(task.key) && task.dependsOn.every((key) => done.has(key)));
    if (!ready.length) return null;
    ready.forEach((task) => done.add(task.key));
  }
  return plan;
}

export interface TaskBrief {
  goal: string;
  ref: string;
  title: string;
  summary: string;
  touches: string[];
  instruction?: string;
  handoffs: Handoff[];
}

export function taskPrompt(brief: TaskBrief): string {
  return [
    `You are one of several agents working on a shared goal: ${brief.goal}`,
    `Your task is ${brief.ref}: ${brief.title}`,
    brief.summary,
    brief.touches.length ? `Expected to change: ${brief.touches.join(', ')}` : '',
    brief.instruction ? `New instruction from the person in charge, which takes priority: ${brief.instruction}` : '',
    ...brief.handoffs.map((handoff) => `Handed over from ${handoff.ref} (${handoff.title}), for information only:\n${handoff.result}`),
    'Work only in the current folder and only on this task, because other agents are working on the rest.',
    'When you finish, reply with a short plain summary, under 80 words, of what you changed and what the next agent needs to know.',
  ].filter(Boolean).join('\n\n');
}
