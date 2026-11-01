import { useCallback, useEffect, useRef, useState } from 'react';
import { nextDispatches, type Dispatch } from '../domain/coordinator';
import { applyEvent, liveAgents, type AgentEvent } from '../domain/events';
import type { Project, Task, ToolId } from '../domain/types';

async function post<T = unknown>(path: string, body: object): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? 'CoBuddy’s local bridge didn’t respond.');
  return result;
}

export type BridgeState = 'connecting' | 'open' | 'down';

/** Streams a project's real events into it, and hands ready tasks to free agents. */
export function useLiveProject(project: Project, onChange: (change: (project: Project) => Project) => void) {
  const [bridge, setBridge] = useState<BridgeState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(new Set<string>());
  const startSeq = useRef(project.lastSeq ?? 0);

  useEffect(() => {
    if (project.isSample) return;
    const source = new EventSource(`/api/events?projectId=${encodeURIComponent(project.id)}&after=${startSeq.current}`);
    source.onopen = () => setBridge('open');
    source.onerror = () => setBridge('down');
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as AgentEvent;
      if (event.taskId) inFlight.current.delete(event.taskId);
      onChange((current) => applyEvent(current, event));
    };
    return () => source.close();
  }, [project.id, project.isSample, onChange]);

  const dispatch = useCallback(
    ({ task, agent, handoffs }: Dispatch) => {
      inFlight.current.add(task.id);
      post('/api/tasks/start', {
        projectId: project.id,
        tool: agent.tool,
        folder: project.folder,
        taskId: task.id,
        agentId: agent.id,
        agentName: agent.name,
        handoffs,
        brief: { goal: project.goal ?? project.name, ref: task.ref, title: task.title, summary: task.summary, touches: task.touches, instruction: task.instruction, handoffs },
      }).catch((failure: Error) => {
        inFlight.current.delete(task.id);
        setError(failure.message);
        onChange((current) => ({ ...current, runState: 'paused' }));
      });
    },
    [project.id, project.folder, project.goal, project.name, onChange],
  );

  useEffect(() => {
    nextDispatches(project, inFlight.current).forEach(dispatch);
  }, [project, dispatch]);

  const attempt = (action: Promise<unknown>) => {
    setError(null);
    return action.catch((failure: Error) => setError(failure.message));
  };

  const connect = (tool: ToolId, folder: string, workers: number) =>
    attempt(
      post<{ folder: string }>('/api/connect', { projectId: project.id, tool, folder, workers }).then((result) =>
        onChange((current) => ({ ...current, folder: result.folder })),
      ),
    );

  const plan = (goal: string) => {
    const tool = liveAgents(project)[0]?.tool;
    onChange((current) => ({ ...current, goal }));
    return attempt(post('/api/plan', { projectId: project.id, tool, folder: project.folder, goal }));
  };

  const setRun = (runState: Project['runState']) => onChange((current) => ({ ...current, runState }));
  const stopRun = (taskId: string) => attempt(post('/api/tasks/stop', { projectId: project.id, taskId }));
  const change = (taskId: string, update: Partial<Task>) =>
    onChange((current) => ({ ...current, tasks: current.tasks.map((task) => (task.id === taskId ? { ...task, ...update } : task)) }));

  /** Gives a task new instructions, restarting it if an agent is already on it. */
  const redirect = (task: Task, instruction: string) => {
    if (task.status === 'active') {
      change(task.id, { instruction, requeueOnStop: true });
      return stopRun(task.id);
    }
    change(task.id, { instruction, status: 'queued' });
    if (project.runState !== 'paused') setRun('running');
    return Promise.resolve();
  };

  const stopAll = () => {
    setRun('paused');
    project.tasks.filter((task) => task.status === 'active').forEach((task) => void stopRun(task.id));
  };

  return { bridge, error, connect, plan, setRun, stopRun, stopAll, redirect };
}

export type LiveProject = ReturnType<typeof useLiveProject>;
