import { useCallback, useEffect, useState } from 'react';
import { Start } from './components/Start';
import { Workspace } from './components/Workspace';
import { soloSample, teamSample } from './domain/samples';
import { loadActiveId, loadProjects, saveActiveId, saveProjects } from './domain/store';
import type { Project } from './domain/types';

export function App() {
  const [projects, setProjects] = useState<Project[]>(loadProjects);
  const [activeId, setActiveId] = useState<string | null>(loadActiveId);

  useEffect(() => saveProjects(projects), [projects]);
  useEffect(() => saveActiveId(activeId), [activeId]);

  const active = projects.find((project) => project.id === activeId);

  const changeActive = useCallback(
    (change: (project: Project) => Project) =>
      setProjects((current) => current.map((project) => (project.id === activeId ? change(project) : project))),
    [activeId],
  );

  const addAndOpen = (project: Project) => {
    setProjects((current) => [...current.filter((item) => item.id !== project.id), project]);
    setActiveId(project.id);
  };

  const openSample = (mode: 'solo' | 'team') => {
    const sample = mode === 'team' ? teamSample() : soloSample();
    const existing = projects.find((project) => project.id === sample.id);
    if (existing) setActiveId(existing.id);
    else addAndOpen(sample);
  };

  if (!active) {
    return (
      <Start
        projects={projects}
        onCreate={addAndOpen}
        onOpen={setActiveId}
        onOpenSample={openSample}
        onDelete={(id) => setProjects((current) => current.filter((project) => project.id !== id))}
      />
    );
  }

  return (
    <Workspace
      key={active.id}
      project={active}
      onChange={changeActive}
      onExit={() => setActiveId(null)}
    />
  );
}
