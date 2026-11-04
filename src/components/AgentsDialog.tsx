import { useEffect, useState, type FormEvent } from 'react';
import { connectionState, presenceState } from '../domain/coordinator';
import { newId } from '../domain/store';
import { CONNECTION_LABEL, TOOL_LABEL, type Agent, type ConnectionState, type Project, type ToolId } from '../domain/types';
import { timeAgo, useNow } from '../live/useNow';
import type { LiveProject } from '../live/useLiveProject';
import { Dialog } from './Dialog';

interface Limits {
  planUsd: number;
  taskUsd: number;
}

interface Detection {
  id: ToolId;
  presence: 'installed' | 'traces' | 'absent';
  evidence: string[];
  liveUpdates: boolean;
  limits?: Limits;
}

const TOOLS: ToolId[] = ['claude-code', 'codex', 'github-copilot', 'cursor', 'windsurf'];

interface Props {
  project: Project;
  live: LiveProject;
  onAdd: (agent: Agent) => void;
  onClose: () => void;
}

function NextStep({ state, detection, note }: { state: ConnectionState; detection: Detection; note?: string }) {
  const label = TOOL_LABEL[detection.id];
  if (state === 'unsupported') {
    return (
      <p className="hint">
        {detection.presence === 'installed'
          ? 'Detected — live sync isn’t supported yet.'
          : `CoBuddy can’t sync with ${label} yet, so installing it wouldn’t add live updates.`}
      </p>
    );
  }
  if (state === 'not-installed') return <p className="hint">Install {label} and sign in, then reopen this window.</p>;
  return note ? <p className="hint conn-note">{note}</p> : null;
}

function ConnectForm({ project, tool, limits, live }: { project: Project; tool: ToolId; limits?: Limits; live: LiveProject }) {
  const [folder, setFolder] = useState(project.folder ?? '');
  const [workers, setWorkers] = useState(project.connections?.[tool]?.workers ?? 2);
  const [testing, setTesting] = useState(false);
  const connection = project.connections?.[tool];
  const label = TOOL_LABEL[tool];

  const lastSeq = project.activity?.at(-1)?.seq;
  // Any new event ends the wait, including the same failure arriving twice.
  useEffect(() => setTesting(false), [connection?.live, connection?.note, live.error, lastSeq]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTesting(true);
    void live.connect(tool, folder, workers);
  };

  return (
    <form className="connect-form" onSubmit={submit}>
      <label>
        Project folder
        <input required className="mono" value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="/Users/you/projects/website" />
      </label>
      <label>
        Agents at once
        <select value={workers} onChange={(event) => setWorkers(Number(event.target.value))}>
          {[1, 2, 3].map((count) => <option key={count} value={count}>{count}</option>)}
        </select>
      </label>
      <dl className="consent">
        <dt>Files</dt>
        <dd>Agents can read, search and edit files in this folder only.</dd>
        <dt>Commands</dt>
        <dd>Not allowed. Agents can’t run commands, and settings stored in the folder are ignored.</dd>
        <dt>Account</dt>
        <dd>Runs use the Claude account you’re signed in to in {label}. CoBuddy never sees your sign-in.</dd>
        {limits && (
          <>
            <dt>Spending</dt>
            <dd>Limits of ${limits.planUsd} per plan and ${limits.taskUsd} per task. These aren’t exact: a run stops after the step that crosses its limit, so it can go over by the cost of that step.</dd>
          </>
        )}
      </dl>
      <button type="submit" className="primary" disabled={testing}>{testing ? `Waiting for ${label} to reply…` : 'Allow and test connection'}</button>
      <p className="hint">This sends one short test message. {label} only shows as connected if it replies.</p>
    </form>
  );
}

export function AgentsDialog({ project, live, onAdd, onClose }: Props) {
  const [detections, setDetections] = useState<Detection[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState('');
  const [tool, setTool] = useState<ToolId>('other');
  const [personId, setPersonId] = useState((project.people.find((person) => person.isYou) ?? project.people[0]).id);
  const now = useNow();

  useEffect(() => {
    let current = true;
    fetch('/api/agent-tools')
      .then((response) => {
        if (!response.ok) throw new Error('Detection is unavailable');
        return response.json() as Promise<Detection[]>;
      })
      .then((result) => current && setDetections(result))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onAdd({ id: newId('agent'), name: name.trim(), tool, personId, manual: true });
    setName('');
  };

  return (
    <Dialog title="Connect agents" onClose={onClose} wide>
      {project.isSample ? (
        <p className="notice"><strong>Demo mode.</strong> This project is made up, so nothing here can connect. Create your own project to connect an agent.</p>
      ) : (
        <p className="notice"><strong>Connect an agent, and CoBuddy does the rest.</strong> It plans your goal and runs the work. A tool only shows as connected after a real reply from it.</p>
      )}

      <ul className="tool-list">
        {TOOLS.map((id) => {
          const detection = detections?.find((item) => item.id === id);
          const state = connectionState(project, id, detection?.presence, detection?.liveUpdates ?? false);
          const connection = project.connections?.[id];
          const showPresence = state === 'needs-permission' || state === 'unsupported';
          const canConnect = !project.isSample && detection?.liveUpdates && (state === 'needs-permission' || state === 'lost');
          return (
            <li key={id} className="tool-row">
              <div className="tool-head">
                <div>
                  <strong>{TOOL_LABEL[id]}</strong>
                  <span className="tool-evidence">
                    {connection?.lastEventAt
                      ? `Last event ${timeAgo(connection.lastEventAt, now)}`
                      : detection ? detection.evidence.join(', ') || 'Nothing detected' : failed ? 'Detection unavailable' : 'Checking…'}
                  </span>
                </div>
                {detection && (
                  <div className="tool-chips">
                    {showPresence && <span className={`conn-chip conn-${presenceState(detection.presence)}`}>{CONNECTION_LABEL[presenceState(detection.presence)]}</span>}
                    <span className={`conn-chip conn-${state}`}>{CONNECTION_LABEL[state]}</span>
                  </div>
                )}
              </div>
              {detection && <NextStep state={state} detection={detection} note={connection?.note} />}
              {canConnect && <ConnectForm project={project} tool={id} limits={detection?.limits} live={live} />}
            </li>
          );
        })}
      </ul>
      {live.error && <p className="start-block" role="alert">{live.error}</p>}
      <p className="hint">Detection only checks that a command, app, extension or folder exists. It doesn’t open tool settings, sign-ins, logs or conversations.</p>

      <details className="manual-option">
        <summary>Add a manual placeholder</summary>
        <p className="hint">For tracking work CoBuddy can’t see. A placeholder has no live sync, so CoBuddy never gives it work and you update its tasks yourself.</p>
        <form className="agent-form" onSubmit={submit}>
          <label>
            Name
            <input required value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Tool
            <select value={tool} onChange={(event) => setTool(event.target.value as ToolId)}>
              {[...TOOLS, 'other' as const].map((id) => <option key={id} value={id}>{TOOL_LABEL[id]}</option>)}
            </select>
          </label>
          <label>
            Responsible person
            <select value={personId} onChange={(event) => setPersonId(event.target.value)}>
              {project.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          </label>
          <button type="submit" className="ghost">Add placeholder</button>
        </form>
      </details>
    </Dialog>
  );
}
