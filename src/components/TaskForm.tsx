import { useState, type FormEvent } from 'react';
import { nextRef, wouldCreateCycle } from '../domain/tasks';
import { newId } from '../domain/store';
import { KIND_LABEL, type OwnerRef, type Project, type Task, type TaskKind } from '../domain/types';
import { Dialog } from './Dialog';

interface Props {
  project: Project;
  task: Task | null;
  onSave: (task: Task) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const encodeOwner = (owner: OwnerRef) => (owner ? `${owner.type}:${owner.id}` : '');

function decodeOwner(value: string): OwnerRef {
  if (!value) return null;
  const [type, ...rest] = value.split(':');
  return { type: type as 'person' | 'agent', id: rest.join(':') };
}

const toNumber = (value: string) => (value === '' ? null : Math.max(0, Math.floor(Number(value))));

export function TaskForm({ project, task, onSave, onDelete, onClose }: Props) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [summary, setSummary] = useState(task?.summary ?? '');
  const [kind, setKind] = useState<TaskKind>(task?.kind ?? 'code');
  const [owner, setOwner] = useState(encodeOwner(task?.owner ?? null));
  const [dependsOn, setDependsOn] = useState(task?.dependsOn ?? []);
  const [touches, setTouches] = useState((task?.touches ?? []).join('\n'));
  const [stepsDone, setStepsDone] = useState(task?.steps ? String(task.steps.done) : '');
  const [stepsTotal, setStepsTotal] = useState(task?.steps ? String(task.steps.total) : '');

  const options = project.tasks.filter((candidate) => !task || !wouldCreateCycle(project.tasks, task.id, candidate.id));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const done = toNumber(stepsDone);
    const total = toNumber(stepsTotal);
    const { steps: _steps, ...base } = task ?? {
      id: newId('task'),
      ref: nextRef(project.tasks),
      status: 'queued' as const,
      latestUpdate: null,
    };

    onSave({
      ...base,
      title: title.trim(),
      summary: summary.trim(),
      kind,
      owner: decodeOwner(owner),
      dependsOn,
      touches: touches.split('\n').map((line) => line.trim()).filter(Boolean),
      ...(done !== null && total ? { steps: { done: Math.min(done, total), total } } : {}),
    });
  };

  return (
    <Dialog title={task ? `Edit ${task.ref}` : 'Add a task'} onClose={onClose}>
      <form className="task-form" onSubmit={submit}>
        <label>
          Task name
          <input autoFocus required maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          Explanation
          <textarea rows={2} value={summary} onChange={(event) => setSummary(event.target.value)} />
        </label>
        <div className="form-pair">
          <label>
            Type
            <select value={kind} onChange={(event) => setKind(event.target.value as TaskKind)}>
              {Object.entries(KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            Owner
            <select value={owner} onChange={(event) => setOwner(event.target.value)}>
              <option value="">Unassigned</option>
              <optgroup label="People">
                {project.people.map((person) => <option key={person.id} value={`person:${person.id}`}>{person.name}</option>)}
              </optgroup>
              {project.agents.length > 0 && (
                <optgroup label="Agents">
                  {project.agents.map((agent) => <option key={agent.id} value={`agent:${agent.id}`}>{agent.name}</option>)}
                </optgroup>
              )}
            </select>
          </label>
        </div>
        <label>
          What will this change? <em>One file, folder or named piece of work per line</em>
          <textarea rows={3} className="mono" value={touches} onChange={(event) => setTouches(event.target.value)} placeholder={'src/auth/\nPricing page copy'} />
        </label>
        {options.length > 0 && (
          <fieldset>
            <legend>Depends on</legend>
            <div className="dep-options">
              {options.map((candidate) => (
                <label key={candidate.id} className="check">
                  <input
                    type="checkbox"
                    checked={dependsOn.includes(candidate.id)}
                    onChange={(event) =>
                      setDependsOn((current) => (event.target.checked ? [...current, candidate.id] : current.filter((id) => id !== candidate.id)))
                    }
                  />
                  <span><b>{candidate.ref}</b> {candidate.title}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {task && (
          <div className="form-pair">
            <label>
              Steps finished <em>Optional</em>
              <input type="number" min="0" value={stepsDone} onChange={(event) => setStepsDone(event.target.value)} />
            </label>
            <label>
              Total steps <em>Optional</em>
              <input type="number" min="1" value={stepsTotal} onChange={(event) => setStepsTotal(event.target.value)} />
            </label>
          </div>
        )}
        <div className="step-actions">
          {task && (
            <button
              type="button"
              className="text-button danger"
              onClick={() => window.confirm(`Delete ${task.ref}? This can’t be undone.`) && onDelete(task.id)}
            >
              Delete task
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary">{task ? 'Save changes' : 'Add task'}</button>
        </div>
      </form>
    </Dialog>
  );
}
