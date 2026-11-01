import type { Project, ProjectMode } from './types';

const PROJECTS_KEY = 'cobuddy.projects.v1';
const ACTIVE_KEY = 'cobuddy.active.v1';

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function loadProjects(): Project[] {
  try {
    const stored = localStorage.getItem(PROJECTS_KEY);
    return stored ? (JSON.parse(stored) as Project[]) : [];
  } catch {
    return [];
  }
}

export function saveProjects(projects: Project[]): void {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch {
    // The app still works for this visit if storage is blocked.
  }
}

export function loadActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function saveActiveId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // See saveProjects.
  }
}

export interface NewProject {
  name: string;
  description: string;
  mode: ProjectMode;
  yourName: string;
  teammates: { name: string; role: string }[];
}

export function createProject(input: NewProject, now = new Date()): Project {
  return {
    id: newId('project'),
    name: input.name.trim(),
    description: input.description.trim(),
    mode: input.mode,
    createdAt: now.toISOString(),
    isSample: false,
    people: [
      { id: newId('person'), name: input.yourName.trim() || 'You', isYou: true },
      ...input.teammates.map((teammate) => ({
        id: newId('person'),
        name: teammate.name.trim(),
        ...(teammate.role.trim() ? { role: teammate.role.trim() } : {}),
      })),
    ],
    agents: [],
    tasks: [],
    overlapDecisions: [],
  };
}
