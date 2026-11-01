import { useEffect, useState, type FormEvent } from 'react';
import { checkStart } from '../domain/gate';
import { otherTask, overlapsForTask, type Overlap } from '../domain/overlaps';
import { dependents, estimateFinish } from '../domain/tasks';
import { liveAgents } from '../domain/events';
import { KIND_LABEL, STATUS_LABEL, STATUS_ORDER, TOOL_LABEL, type Project, type Task, type TaskStatus } from '../domain/types';
import type { LiveProject } from '../live/useLiveProject';
import { timeAgo } from '../live/useNow';
import { ActivityList } from './Activity';
import { OwnerGlyph, resolveOwner, StatusIcon, WarningIcon } from './icons';

interface Props {
  project: Project;
  task: Task;
  overlaps: Overlap[];
  onClose: () => void;
  onSelect: (id: string) => void;
  onStatus: (status: TaskStatus) => void;
  onUpdate: (text: string) => void;
  onEdit: () => void;
  onRunFirst: (firstId: string, secondId: string) => void;
  onAccept: (overlap: Overlap, note: string) => void;
  onUndoAccept: (overlap: Overlap) => void;
  live: LiveProject;
}

function AgentControls({ task, live }: { task: Task; live: LiveProject }) {
  const [instruction, setInstruction] = useState('');
  const working = task.status === 'active';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void live.redirect(task, instruction.trim());
    setInstruction('');
  };

  return (
    <section className="panel-section">
      <h4 className="eyebrow">{working ? 'Step in' : 'What should happen next?'}</h4>
      <form className="update-form" onSubmit={submit}>
        <input aria-label="New instructions" placeholder={working ? 'Redirect this agent' : 'Extra instructions (optional)'} value={instruction} onChange={(event) => setInstruction(event.target.value)} />
        <button type="submit" className="ghost small" disabled={working && !instruction.trim()}>{working ? 'Redirect' : 'Try again'}</button>
      </form>
      {working && <button type="button" className="ghost small danger" onClick={() => void live.stopRun(task.id)}>Stop this agent</button>}
    </section>
  );
}

function TaskLink({ task, onSelect }: { task: Task; onSelect: (id: string) => void }) {
  return (
    <button type="button" className={`task-link status-${task.status}`} onClick={() => onSelect(task.id)}>
      <StatusIcon status={task.status} size={13} />
      <b>{task.ref}</b>
      <span>{task.title}</span>
      <i>{STATUS_LABEL[task.status]}</i>
    </button>
  );
}

function OverlapCard({ overlap, task, project, onSelect, onRunFirst, onAccept, onUndoAccept }: Pick<Props, 'project' | 'task' | 'onSelect' | 'onRunFirst' | 'onAccept' | 'onUndoAccept'> & { overlap: Overlap }) {
  const other = otherTask(overlap, task.id);
  const [accepting, setAccepting] = useState(false);
  const [note, setNote] = useState('');
  const decision = project.overlapDecisions.find((item) => item.key === overlap.key);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onAccept(overlap, note.trim());
    setAccepting(false);
  };

  return (
    <div className={`overlap-card ${overlap.accepted ? 'accepted' : overlap.severity}`}>
      <h4>
        <WarningIcon />
        {overlap.accepted ? 'Overlap accepted' : overlap.severity === 'live' ? 'Live overlap' : 'Possible overlap'}
        <button type="button" className="text-button" onClick={() => onSelect(other.id)}>{other.ref}</button>
      </h4>
      <p>
        {overlap.severity === 'live' ? `This task and “${other.title}” are both in progress and may change:` : `This task and “${other.title}” may change:`}
      </p>
      <ul className="target-list">{overlap.shared.map((target) => <li key={target}>{target}</li>)}</ul>

      {overlap.accepted ? (
        <>
          <p className="hint">{decision?.by} accepted this{decision?.note ? `: “${decision.note}”` : '.'}</p>
          <button type="button" className="text-button" onClick={() => onUndoAccept(overlap)}>Undo</button>
        </>
      ) : accepting ? (
        <form onSubmit={submit} className="accept-form">
          <label>
            Why is this safe?
            <input autoFocus required value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <div className="step-actions">
            <button type="button" className="ghost small" onClick={() => setAccepting(false)}>Cancel</button>
            <button type="submit" className="ghost small">Accept overlap</button>
          </div>
        </form>
      ) : (
        <div className="overlap-actions">
          <button type="button" className="ghost small" onClick={() => onRunFirst(other.id, task.id)}>Do {other.ref} first</button>
          <button type="button" className="ghost small" onClick={() => onRunFirst(task.id, other.id)}>Do {task.ref} first</button>
          <button type="button" className="text-button" onClick={() => setAccepting(true)}>It’s safe</button>
        </div>
      )}
    </div>
  );
}

export function TaskPanel({ project, task, overlaps, onClose, onSelect, onStatus, onUpdate, onEdit, onRunFirst, onAccept, onUndoAccept, live }: Props) {
  const [message, setMessage] = useState('');
  const [startBlock, setStartBlock] = useState<ReturnType<typeof checkStart> | null>(null);
  const now = new Date();

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const owner = resolveOwner(project, task.owner);
  const dependencies = project.tasks.filter((candidate) => task.dependsOn.includes(candidate.id));
  const unlocks = dependents(project.tasks, task.id);
  const mine = overlapsForTask(overlaps, task.id);
  const estimate = estimateFinish(task, now);
  const agentRun = owner.type === 'agent' && liveAgents(project).some((agent) => agent.id === owner.agent.id);
  const running = agentRun && task.status === 'active';
  const expected = task.touches.filter((target) => !task.changed?.includes(target));

  const changeStatus = (status: TaskStatus) => {
    if (status === 'active') {
      const check = checkStart(project, overlaps, task.id);
      setStartBlock(check.allowed ? null : check);
      if (!check.allowed) return;
    } else {
      setStartBlock(null);
    }
    onStatus(status);
  };

  const submitUpdate = (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim()) return;
    onUpdate(message.trim());
    setMessage('');
  };

  return (
    <aside className="panel" aria-label={`Details for ${task.ref}`}>
      <header className="panel-head">
        <span className="panel-ref">{task.ref} / {KIND_LABEL[task.kind]}</span>
        <button type="button" className="text-button" onClick={onEdit}>Edit</button>
        <button type="button" className="icon-button" aria-label="Close details" onClick={onClose}>×</button>
      </header>

      <div className="panel-scroll">
        <h3>{task.title}</h3>
        {task.summary && <p className="panel-summary">{task.summary}</p>}

        {running ? (
          <p className={`status-word status-${task.status} agent-status`}><StatusIcon status={task.status} size={15} /> {STATUS_LABEL[task.status]} · status comes from the agent</p>
        ) : (
        <div className="status-picker" role="group" aria-label="Status">
          {STATUS_ORDER.map((status) => (
            <button
              key={status}
              type="button"
              className={`status-option status-${status} ${task.status === status ? 'on' : ''}`}
              aria-pressed={task.status === status}
              title={STATUS_LABEL[status]}
              onClick={() => changeStatus(status)}
            >
              <StatusIcon status={status} size={15} />
            </button>
          ))}
          <span className={`status-word status-${task.status}`}>{STATUS_LABEL[task.status]}</span>
        </div>
        )}

        {startBlock && (
          <div className="start-block" role="alert">
            <strong>This task can’t start yet.</strong>
            {startBlock.unfinishedDependencies.length > 0 && (
              <p>Waiting for: {startBlock.unfinishedDependencies.map((item) => item.ref).join(', ')}.</p>
            )}
            {startBlock.unresolvedOverlaps.length > 0 && (
              <p>Resolve the overlap with {startBlock.unresolvedOverlaps.map((item) => otherTask(item, task.id).ref).join(', ')} first.</p>
            )}
          </div>
        )}

        {mine.length > 0 && (
          <section className="panel-section">
            {mine.map((overlap) => (
              <OverlapCard key={overlap.key} overlap={overlap} task={task} project={project} onSelect={onSelect} onRunFirst={onRunFirst} onAccept={onAccept} onUndoAccept={onUndoAccept} />
            ))}
          </section>
        )}

        {agentRun && (task.status === 'active' || task.status === 'blocked') && <AgentControls task={task} live={live} />}

        <section className="panel-section">
          <h4 className="eyebrow">Owner</h4>
          <div className="owner-row">
            <OwnerGlyph owner={owner} />
            <span>
              <strong>{owner.name}</strong>
              <em>
                {owner.type === 'agent' && `${TOOL_LABEL[owner.agent.tool]} agent${owner.person ? ` · ${owner.person.name} is responsible` : ''}`}
                {owner.type === 'person' && (owner.person.role ?? 'Person')}
                {owner.type === 'none' && 'No one owns this yet'}
              </em>
            </span>
          </div>
        </section>

        {estimate && (
          <section className="panel-section">
            <h4 className="eyebrow">Estimated finish</h4>
            <p className="estimate">
              About {estimate.minutesLeft} min left, around {estimate.finishAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </p>
            <p className="hint">Estimate only, from {estimate.basis}.</p>
          </section>
        )}

        <section className="panel-section">
          <h4 className="eyebrow">Depends on</h4>
          {dependencies.length ? dependencies.map((item) => <TaskLink key={item.id} task={item} onSelect={onSelect} />) : <p className="hint">Nothing. This task can start on its own.</p>}
        </section>

        {unlocks.length > 0 && (
          <section className="panel-section">
            <h4 className="eyebrow">Unlocks</h4>
            {unlocks.map((item) => <TaskLink key={item.id} task={item} onSelect={onSelect} />)}
          </section>
        )}

        {expected.length > 0 && (
          <section className="panel-section">
            <h4 className="eyebrow">Expected to change</h4>
            <ul className="target-list">{expected.map((target) => <li key={target}>{target}</li>)}</ul>
          </section>
        )}

        {task.changed && task.changed.length > 0 && (
          <section className="panel-section">
            <h4 className="eyebrow">Files changed, as reported by the agent</h4>
            <ul className="target-list">{task.changed.map((target) => <li key={target}>{target}</li>)}</ul>
          </section>
        )}

        {task.result && (
          <section className="panel-section">
            <h4 className="eyebrow">Agent’s summary</h4>
            <div className="update"><p>{task.result}</p></div>
          </section>
        )}

        {agentRun && (
          <section className="panel-section">
            <h4 className="eyebrow">Live updates</h4>
            <ActivityList project={project} taskId={task.id} limit={8} />
          </section>
        )}

        <section className="panel-section">
          <h4 className="eyebrow">Latest update</h4>
          {task.latestUpdate ? (
            <div className="update">
              <p>{task.latestUpdate.text}</p>
              <span>{task.latestUpdate.by} · {timeAgo(task.latestUpdate.at, now)}</span>
            </div>
          ) : (
            <p className="hint">No updates yet.</p>
          )}
          <form className="update-form" onSubmit={submitUpdate}>
            <input aria-label="Share an update" placeholder="Share an update with the project" value={message} onChange={(event) => setMessage(event.target.value)} />
            <button type="submit" className="ghost small">Post</button>
          </form>
        </section>
      </div>
    </aside>
  );
}
