import { useState, type FormEvent } from 'react';
import { LOGO_SRC } from '../brand/logo';
import { createProject } from '../domain/store';
import type { Project, ProjectMode } from '../domain/types';
import { HeroGraph } from './HeroGraph';
import { Brand } from './LogoSlot';

interface Props {
  projects: Project[];
  onCreate: (project: Project) => void;
  onOpen: (id: string) => void;
  onOpenSample: (mode: ProjectMode) => void;
  onDelete: (id: string) => void;
}

type Step = 'mode' | 'project' | 'team';

export function Start({ projects, onCreate, onOpen, onOpenSample, onDelete }: Props) {
  const [step, setStep] = useState<Step>('mode');
  const [mode, setMode] = useState<ProjectMode>('solo');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [yourName, setYourName] = useState('');
  const [teammates, setTeammates] = useState<{ name: string; role: string }[]>([]);
  const [mateName, setMateName] = useState('');
  const [mateRole, setMateRole] = useState('');

  const chooseMode = (next: ProjectMode) => {
    setMode(next);
    setStep('project');
  };

  const create = () => onCreate(createProject({ name, description, mode, yourName, teammates }));

  const submitProject = (event: FormEvent) => {
    event.preventDefault();
    if (mode === 'team') setStep('team');
    else create();
  };

  const addTeammate = (event: FormEvent) => {
    event.preventDefault();
    if (!mateName.trim()) return;
    setTeammates((current) => [...current, { name: mateName.trim(), role: mateRole.trim() }]);
    setMateName('');
    setMateRole('');
  };

  return (
    <div className="start">
      <header className="start-bar">
        <Brand size={46} />
        <span className="mono-note">Local MVP</span>
      </header>

      <main className="start-main">
        <section className="start-copy">
          <h1>See who’s doing what before it <span>collides.</span></h1>
          <p className="lede">
            Give CoBuddy a goal and connect your AI agents. It plans the work, hands it out, and shows you everything on a live graph.
          </p>

          <div className="start-step">
            {step === 'mode' && (
              <>
                <h2 className="step-title">Are you working alone or with a team?</h2>
                <div className="mode-grid">
                  <button type="button" className="mode-card" onClick={() => chooseMode('solo')}>
                    <span className="mode-index">01</span>
                    <strong>Alone</strong>
                    <span>You and your agents</span>
                  </button>
                  <button type="button" className="mode-card" onClick={() => chooseMode('team')}>
                    <span className="mode-index">02</span>
                    <strong>With a team</strong>
                    <span>People, each with their own agents</span>
                  </button>
                </div>
              </>
            )}

            {step === 'project' && (
              <form onSubmit={submitProject} className="step-form">
                <h2 className="step-title">{mode === 'team' ? 'Name your team project' : 'Name your project'}</h2>
                <label>
                  Project name
                  <input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="Website relaunch" />
                </label>
                <label>
                  Your name
                  <input required value={yourName} onChange={(event) => setYourName(event.target.value)} />
                </label>
                <label>
                  What is it for? <em>Optional</em>
                  <input value={description} onChange={(event) => setDescription(event.target.value)} />
                </label>
                <div className="step-actions">
                  <button type="button" className="ghost" onClick={() => setStep('mode')}>Back</button>
                  <button type="submit" className="primary">{mode === 'team' ? 'Next: add teammates' : 'Create project'}</button>
                </div>
              </form>
            )}

            {step === 'team' && (
              <div className="step-form">
                <h2 className="step-title">Who’s working on {name.trim()}?</h2>
                <form onSubmit={addTeammate} className="mate-row">
                  <label>
                    Teammate’s name
                    <input autoFocus value={mateName} onChange={(event) => setMateName(event.target.value)} />
                  </label>
                  <label>
                    Role <em>Optional</em>
                    <input value={mateRole} onChange={(event) => setMateRole(event.target.value)} />
                  </label>
                  <button type="submit" className="ghost">Add</button>
                </form>
                {teammates.length > 0 && (
                  <ul className="mate-list">
                    {teammates.map((mate, index) => (
                      <li key={`${mate.name}-${index}`}>
                        <span>{mate.name}{mate.role && <i> · {mate.role}</i>}</span>
                        <button type="button" className="text-button" onClick={() => setTeammates((current) => current.filter((_, position) => position !== index))}>Remove</button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="hint">Teammates are saved in this browser only. CoBuddy doesn’t send invitations yet.</p>
                <div className="step-actions">
                  <button type="button" className="ghost" onClick={() => setStep('project')}>Back</button>
                  <button type="button" className="primary" onClick={create}>Create project</button>
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="start-visual">
          {LOGO_SRC && <img className="hero-logo" src={LOGO_SRC} alt="" />}
          <HeroGraph />
        </aside>
      </main>

      <section className="start-open">
        <div>
          <h2 className="eyebrow">Your projects</h2>
          {projects.filter((project) => !project.isSample).length === 0 && <p className="hint">Projects you create will appear here.</p>}
          <ul className="project-list">
            {projects.filter((project) => !project.isSample).map((project) => (
              <li key={project.id}>
                <button type="button" className="project-link" onClick={() => onOpen(project.id)}>
                  <strong>{project.name}</strong>
                  <span>{project.mode === 'team' ? 'Team' : 'Solo'} · {project.tasks.length} {project.tasks.length === 1 ? 'task' : 'tasks'}</span>
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => window.confirm(`Delete “${project.name}” from this browser? This can’t be undone.`) && onDelete(project.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="eyebrow">Demo mode: made-up data</h2>
          <ul className="project-list">
            <li>
              <button type="button" className="project-link" onClick={() => onOpenSample('team')}>
                <strong>Team demo</strong>
                <span>4 made-up people · 6 made-up agents</span>
              </button>
            </li>
            <li>
              <button type="button" className="project-link" onClick={() => onOpenSample('solo')}>
                <strong>Solo demo</strong>
                <span>1 made-up person · 5 made-up agents</span>
              </button>
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
