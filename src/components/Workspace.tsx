import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { liveAgents } from '../domain/events';
import { findOverlaps, overlapsForTask, type Overlap } from '../domain/overlaps';
import { newId } from '../domain/store';
import { addDependency, removeTask, setStatus } from '../domain/tasks';
import { STATUS_LABEL, STATUS_ORDER, type Project, type Task, type TaskStatus } from '../domain/types';
import { ProjectGraph } from '../graph/ProjectGraph';
import { useLiveProject } from '../live/useLiveProject';
import { ActivityPanel } from './Activity';
import { AgentsDialog } from './AgentsDialog';
import { Dialog } from './Dialog';
import { GoalPrompt } from './GoalPrompt';
import { StatusIcon, WarningIcon } from './icons';
import { Brand } from './LogoSlot';
import { Roster, type OwnerFilter } from './Roster';
import { RunBar } from './RunBar';
import { TaskForm } from './TaskForm';
import { TaskPanel } from './TaskPanel';

interface Props {
  project: Project;
  onChange: (change: (project: Project) => Project) => void;
  onExit: () => void;
}

type Modal = { kind: 'agents' } | { kind: 'goal' } | { kind: 'person' } | { kind: 'task'; task: Task | null } | null;

export function Workspace({ project, onChange, onExit }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; turn: number } | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [statusFilter, setStatusFilter] = useState<TaskStatus | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>(null);
  const [overlapsOnly, setOverlapsOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [personName, setPersonName] = useState('');
  const [personRole, setPersonRole] = useState('');
  const [activityOpen, setActivityOpen] = useState(true);
  const live = useLiveProject(project, onChange);
  const showActivity = activityOpen && Boolean(project.activity?.length) && !project.isSample;

  useEffect(() => {
    // The graph is refitted on resize, and this panel changes the room it has.
    window.dispatchEvent(new Event('resize'));
  }, [showActivity]);

  const overlaps = useMemo(() => findOverlaps(project), [project]);
  const openOverlaps = overlaps.filter((overlap) => !overlap.accepted);
  const liveCount = openOverlaps.filter((overlap) => overlap.severity === 'live').length;
  const selected = project.tasks.find((task) => task.id === selectedId) ?? null;
  const you = project.people.find((person) => person.isYou)?.name ?? 'You';

  const isMatch = useCallback(
    (task: Task) => {
      if (statusFilter && task.status !== statusFilter) return false;
      if (overlapsOnly && !overlapsForTask(overlaps, task.id).some((overlap) => !overlap.accepted)) return false;
      if (ownerFilter) {
        const agentsOfPerson = project.agents.filter((agent) => agent.personId === ownerFilter.id).map((agent) => agent.id);
        const owned =
          task.owner?.id === ownerFilter.id ||
          (ownerFilter.type === 'person' && task.owner?.type === 'agent' && agentsOfPerson.includes(task.owner.id));
        if (!owned) return false;
      }
      const term = query.trim().toLowerCase();
      return !term || `${task.ref} ${task.title}`.toLowerCase().includes(term);
    },
    [statusFilter, overlapsOnly, ownerFilter, query, overlaps, project.agents],
  );

  const updateTask = (taskId: string, change: (task: Task) => Task) =>
    onChange((current) => ({ ...current, tasks: current.tasks.map((task) => (task.id === taskId ? change(task) : task)) }));

  const postUpdate = (taskId: string, text: string) =>
    updateTask(taskId, (task) => ({ ...task, latestUpdate: { text, at: new Date().toISOString(), by: you } }));

  const runFirst = (firstId: string, secondId: string) => {
    const second = project.tasks.find((task) => task.id === secondId);
    if (second?.status === 'active' && liveAgents(project).some((agent) => agent.id === second.owner?.id)) {
      onChange((current) => {
        const next = addDependency(current, secondId, firstId);
        return { ...next, tasks: next.tasks.map((task) => (task.id === secondId ? { ...task, requeueOnStop: true } : task)) };
      });
      void live.stopRun(secondId);
      return;
    }
    onChange((current) => {
      const first = current.tasks.find((task) => task.id === firstId);
      let next = addDependency(current, secondId, firstId);
      if (next.tasks.find((task) => task.id === secondId)?.status === 'active') {
        next = setStatus(next, secondId, 'queued', new Date());
        next = {
          ...next,
          tasks: next.tasks.map((task) =>
            task.id === secondId
              ? { ...task, latestUpdate: { text: `Put on hold until ${first?.ref ?? 'the other task'} finishes.`, at: new Date().toISOString(), by: you } }
              : task,
          ),
        };
      }
      return next;
    });
  };

  const acceptOverlap = (overlap: Overlap, note: string) =>
    onChange((current) => ({
      ...current,
      overlapDecisions: [...current.overlapDecisions, { key: overlap.key, note, at: new Date().toISOString(), by: you }],
    }));

  const saveTask = (task: Task) => {
    onChange((current) =>
      current.tasks.some((item) => item.id === task.id)
        ? { ...current, tasks: current.tasks.map((item) => (item.id === task.id ? task : item)) }
        : { ...current, tasks: [...current.tasks, task] },
    );
    setSelectedId(task.id);
    setModal(null);
  };

  const addPerson = (event: FormEvent) => {
    event.preventDefault();
    const name = personName.trim();
    const role = personRole.trim();
    onChange((current) => ({
      ...current,
      people: [...current.people, { id: newId('person'), name, ...(role ? { role } : {}) }],
    }));
    setPersonName('');
    setPersonRole('');
    setModal(null);
  };

  const showNextOverlap = () => {
    if (!openOverlaps.length) return;
    const index = openOverlaps.findIndex((overlap) => overlap.a.id === selectedId);
    const next = openOverlaps[(index + 1) % openOverlaps.length];
    setSelectedId(next.a.id);
    setFocus((current) => ({ id: next.a.id, turn: (current?.turn ?? 0) + 1 }));
  };

  const filtering = Boolean(statusFilter || ownerFilter || overlapsOnly || query);

  return (
    <div className="workspace">
      <header className="topbar">
        <button type="button" className="brand-button" onClick={onExit} aria-label="Back to projects"><Brand size={36} /></button>
        <div className="project-title">
          <strong>{project.name}</strong>
          <span>{project.mode === 'team' ? 'Team project' : 'Solo project'}</span>
        </div>

        <div className="status-filters" role="group" aria-label="Filter by status">
          {STATUS_ORDER.map((status) => {
            const count = project.tasks.filter((task) => task.status === status).length;
            return (
              <button
                key={status}
                type="button"
                className={`status-filter status-${status} ${statusFilter === status ? 'on' : ''}`}
                aria-pressed={statusFilter === status}
                onClick={() => setStatusFilter(statusFilter === status ? null : status)}
              >
                <StatusIcon status={status} size={13} />
                <span>{STATUS_LABEL[status]}</span>
                <b>{count}</b>
              </button>
            );
          })}
        </div>

        <span className="spacer" />
        <input className="search" aria-label="Find a task" placeholder="Find a task" value={query} onChange={(event) => setQuery(event.target.value)} />
        <button type="button" className="ghost" onClick={() => setModal({ kind: 'task', task: null })}>Add task</button>
      </header>

      {project.isSample && (
        <div className="sample-banner">
          <b>Demo mode</b>
          <span>These people, agents and updates are made up. Nothing here is connected to a real tool.</span>
        </div>
      )}

      {!project.isSample && project.tasks.length > 0 && (
        <RunBar
          project={project}
          live={live}
          activityOpen={activityOpen}
          onToggleActivity={() => setActivityOpen(!activityOpen)}
          onNewGoal={() => setModal({ kind: 'goal' })}
          onConnect={() => setModal({ kind: 'agents' })}
          onSelect={setSelectedId}
        />
      )}

      <div className="workspace-body">
        <Roster
          project={project}
          filter={ownerFilter}
          onFilter={setOwnerFilter}
          onConnect={() => setModal({ kind: 'agents' })}
          onAddPerson={() => setModal({ kind: 'person' })}
        />

        <main className="graph-area">
          {project.tasks.length ? (
            <ProjectGraph
              project={project}
              overlaps={overlaps}
              selectedId={selectedId}
              focus={focus}
              isMatch={isMatch}
              onSelect={setSelectedId}
            />
          ) : (
            <GoalPrompt
              project={project}
              error={live.error}
              onPlan={(goal) => void live.plan(goal)}
              onConnect={() => setModal({ kind: 'agents' })}
              onManual={() => setModal({ kind: 'task', task: null })}
            />
          )}

          {overlaps.length > 0 && (
            <div className="overlap-bar">
              <button type="button" className={`overlap-alert ${liveCount ? 'live' : openOverlaps.length ? 'possible' : 'clear'}`} onClick={showNextOverlap} disabled={!openOverlaps.length}>
                <WarningIcon />
                {openOverlaps.length
                  ? `${openOverlaps.length} ${openOverlaps.length === 1 ? 'overlap needs' : 'overlaps need'} a decision${liveCount ? ` · ${liveCount} live` : ''}`
                  : 'All overlaps reviewed'}
              </button>
              {openOverlaps.length > 0 && (
                <button type="button" className={`mini-toggle ${overlapsOnly ? 'on' : ''}`} aria-pressed={overlapsOnly} onClick={() => setOverlapsOnly(!overlapsOnly)}>Only these</button>
              )}
            </div>
          )}

          {filtering && (
            <button
              type="button"
              className="clear-filters"
              onClick={() => {
                setStatusFilter(null);
                setOwnerFilter(null);
                setOverlapsOnly(false);
                setQuery('');
              }}
            >
              Clear filters
            </button>
          )}
        </main>

        {selected && (
          <TaskPanel
            key={selected.id}
            project={project}
            task={selected}
            overlaps={overlaps}
            onClose={() => setSelectedId(null)}
            onSelect={setSelectedId}
            onStatus={(status) => onChange((current) => setStatus(current, selected.id, status, new Date()))}
            onUpdate={(text) => postUpdate(selected.id, text)}
            onEdit={() => setModal({ kind: 'task', task: selected })}
            onRunFirst={runFirst}
            onAccept={acceptOverlap}
            onUndoAccept={(overlap) =>
              onChange((current) => ({ ...current, overlapDecisions: current.overlapDecisions.filter((item) => item.key !== overlap.key) }))
            }
            live={live}
          />
        )}

        {showActivity && <ActivityPanel project={project} onSelect={setSelectedId} onClose={() => setActivityOpen(false)} />}
      </div>

      {modal?.kind === 'agents' && (
        <AgentsDialog
          project={project}
          live={live}
          onAdd={(agent) => onChange((current) => ({ ...current, agents: [...current.agents, agent] }))}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.kind === 'goal' && (
        <Dialog title="New goal" onClose={() => setModal(null)}>
          <GoalPrompt
            project={{ ...project, goal: '' }}
            error={live.error}
            onPlan={(goal) => {
              void live.plan(goal);
              setModal(null);
            }}
            onConnect={() => setModal({ kind: 'agents' })}
            onManual={() => setModal({ kind: 'task', task: null })}
          />
        </Dialog>
      )}

      {modal?.kind === 'task' && (
        <TaskForm
          project={project}
          task={modal.task}
          onSave={saveTask}
          onDelete={(id) => {
            if (project.tasks.find((task) => task.id === id)?.status === 'active') void live.stopRun(id);
            onChange((current) => removeTask(current, id));
            setSelectedId(null);
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.kind === 'person' && (
        <Dialog title="Add a teammate" onClose={() => setModal(null)}>
          <form className="task-form" onSubmit={addPerson}>
            <label>
              Teammate’s name
              <input autoFocus required value={personName} onChange={(event) => setPersonName(event.target.value)} />
            </label>
            <label>
              Role <em>Optional</em>
              <input value={personRole} onChange={(event) => setPersonRole(event.target.value)} />
            </label>
            <p className="hint">Teammates are saved in this browser only. CoBuddy doesn’t send invitations yet.</p>
            <div className="step-actions">
              <span className="spacer" />
              <button type="button" className="ghost" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="primary">Add teammate</button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
