import { useState, type FormEvent } from 'react';
import { liveAgents } from '../domain/events';
import { TOOL_LABEL, type Project } from '../domain/types';

interface Props {
  project: Project;
  error: string | null;
  onPlan: (goal: string) => void;
  onConnect: () => void;
  onManual: () => void;
}

export function GoalPrompt({ project, error, onPlan, onConnect, onManual }: Props) {
  const [goal, setGoal] = useState(project.goal ?? '');
  const agents = liveAgents(project);
  const latest = project.activity?.at(-1);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!agents.length) onConnect();
    else if (goal.trim()) onPlan(goal.trim());
  };

  if (project.runState === 'planning') {
    return (
      <div className="goal-prompt" role="status">
        <p className="mono-note">Planning</p>
        <h2>{TOOL_LABEL[agents[0]?.tool ?? 'claude-code']} is looking through your folder</h2>
        <p>{latest?.text}</p>
      </div>
    );
  }

  return (
    <div className="goal-prompt">
      <form onSubmit={submit}>
        <h2>What should this project achieve?</h2>
        <p>
          {agents.length
            ? `CoBuddy will ask ${TOOL_LABEL[agents[0].tool]} to plan it and build the graph. You’ll see the plan before any agent starts.`
            : 'Describe your goal, then connect an agent. CoBuddy plans the work and builds the graph for you.'}
        </p>
        <textarea
          autoFocus
          required
          rows={4}
          aria-label="Project goal"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="Add a contact page with a form, and link it from the home page"
        />
        <button type="submit" className="primary">{agents.length ? 'Plan this goal' : 'Connect an agent to plan this'}</button>
      </form>
      {error && <p className="start-block" role="alert">{error}</p>}
      <button type="button" className="text-button" onClick={onManual}>Or add a task by hand</button>
    </div>
  );
}
