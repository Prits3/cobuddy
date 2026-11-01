import type { Agent, Person, Project, Task, TaskKind, TaskStatus, ToolId } from './types';

const minutesAgo = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60000).toISOString();

const person = (id: string, name: string, role: string, isYou = false): Person => ({
  id,
  name: `Sample ${name}`,
  role,
  isYou,
  isSample: true,
});

const agent = (id: string, name: string, tool: ToolId, personId: string): Agent => ({
  id,
  name,
  tool,
  personId,
  isSample: true,
});

interface SampleTask {
  title: string;
  summary: string;
  kind: TaskKind;
  status: TaskStatus;
  owner: string;
  dependsOn?: number[];
  touches?: string[];
  update?: [text: string, minutes: number];
  started?: number;
  steps?: [done: number, total: number];
}

function buildTasks(rows: SampleTask[], people: Person[], agents: Agent[], now: Date): Task[] {
  const nameOf = (id: string) =>
    people.find((item) => item.id === id)?.name ?? agents.find((item) => item.id === id)?.name ?? 'Sample';

  return rows.map((row, index) => ({
    id: `task-${index + 1}`,
    ref: `T-${String(index + 1).padStart(2, '0')}`,
    title: row.title,
    summary: row.summary,
    kind: row.kind,
    status: row.status,
    owner: { type: people.some((item) => item.id === row.owner) ? 'person' : 'agent', id: row.owner },
    dependsOn: (row.dependsOn ?? []).map((item) => `task-${item}`),
    touches: row.touches ?? [],
    latestUpdate: row.update
      ? { text: row.update[0], at: minutesAgo(now, row.update[1]), by: nameOf(row.owner) }
      : null,
    ...(row.started ? { startedAt: minutesAgo(now, row.started) } : {}),
    ...(row.steps ? { steps: { done: row.steps[0], total: row.steps[1] } } : {}),
  }));
}

export function teamSample(now = new Date()): Project {
  const people = [
    person('ada', 'Ada', 'Project lead', true),
    person('bo', 'Bo', 'Engineer'),
    person('cam', 'Cam', 'Designer'),
    person('dee', 'Dee', 'Writer'),
  ];
  const agents = [
    agent('scout', 'scout', 'claude-code', 'ada'),
    agent('forge', 'forge', 'claude-code', 'bo'),
    agent('ledger', 'ledger', 'codex', 'bo'),
    agent('pixel', 'pixel', 'cursor', 'cam'),
    agent('quill', 'quill', 'codex', 'dee'),
    agent('proof', 'proof', 'github-copilot', 'bo'),
  ];

  const tasks = buildTasks(
    [
      { title: 'Summarise user interviews', summary: 'Pull the main needs and complaints out of the interview notes.', kind: 'research', status: 'done', owner: 'scout', touches: ['Interview summary'], update: ['Summary shared with the team.', 2880] },
      { title: 'Compare competitor pricing', summary: 'List how similar note apps charge, to inform the pricing decision.', kind: 'research', status: 'done', owner: 'scout', touches: ['Pricing research'], update: ['Comparison table is ready.', 2600] },
      { title: 'Agree launch scope', summary: 'Decide what is in the first release and what waits.', kind: 'writing', status: 'done', owner: 'ada', dependsOn: [1, 2], touches: ['Launch scope'], update: ['Scope agreed.', 1500] },
      { title: 'Design onboarding flow', summary: 'Three screens that take a new user from sign-up to their first note.', kind: 'design', status: 'review', owner: 'cam', dependsOn: [3], touches: ['Onboarding designs'], update: ['Ready for Ada to review.', 95] },
      { title: 'Fix session refresh', summary: 'Keep people signed in when their session token expires.', kind: 'code', status: 'active', owner: 'forge', dependsOn: [3], touches: ['src/auth/', 'src/api/client.ts'], update: ['Refresh logic works. Now changing the API client.', 12], started: 90, steps: [3, 5] },
      { title: 'Build billing API', summary: 'Add the endpoints for plans, checkout and invoices.', kind: 'code', status: 'active', owner: 'ledger', dependsOn: [3], touches: ['src/billing/', 'src/api/client.ts'], update: ['Checkout endpoint added. Next is the API client.', 8], started: 60 },
      { title: 'Build onboarding screens', summary: 'Turn the approved designs into working screens.', kind: 'code', status: 'queued', owner: 'pixel', dependsOn: [4], touches: ['src/app/onboarding/', 'src/auth/session.ts'] },
      { title: 'Write pricing page copy', summary: 'Explain each plan clearly, in plain language.', kind: 'writing', status: 'active', owner: 'quill', dependsOn: [2, 3], touches: ['Pricing page copy'], update: ['First draft of plan descriptions is done.', 25], started: 45 },
      { title: 'Build pricing page', summary: 'Show the plans and connect them to checkout.', kind: 'code', status: 'blocked', owner: 'bo', dependsOn: [6, 8], touches: ['src/app/pricing/'], update: ['Waiting for the billing API and the final copy.', 40] },
      { title: 'Check pricing terms', summary: 'Confirm that the refund and cancellation wording is accurate.', kind: 'writing', status: 'blocked', owner: 'dee', dependsOn: [8], touches: ['Pricing terms'], update: ['Waiting for the final copy.', 70] },
      { title: 'Write test plan', summary: 'List the journeys that must work before launch.', kind: 'docs', status: 'done', owner: 'proof', dependsOn: [3], touches: ['docs/test-plan.md'], update: ['Test plan shared.', 600] },
      { title: 'Run end-to-end tests', summary: 'Test sign-up, onboarding, payment and sign-out together.', kind: 'code', status: 'queued', owner: 'proof', dependsOn: [5, 6, 7, 11], touches: ['tests/e2e/'] },
      { title: 'Write setup guide', summary: 'Explain how to sign up and create a first note.', kind: 'docs', status: 'queued', owner: 'quill', dependsOn: [5], touches: ['docs/setup.md'] },
      { title: 'Write API reference', summary: 'Describe the public billing endpoints.', kind: 'docs', status: 'queued', owner: 'dee', dependsOn: [6], touches: ['docs/api.md'] },
      { title: 'Draft launch post', summary: 'Announce the release and link to the pricing page.', kind: 'writing', status: 'queued', owner: 'dee', dependsOn: [3], touches: ['Launch post', 'Pricing page copy'] },
      { title: 'Final launch review', summary: 'Check everything together and decide whether to launch.', kind: 'writing', status: 'queued', owner: 'ada', dependsOn: [9, 10, 12, 13, 14, 15], touches: ['Launch decision'] },
    ],
    people,
    agents,
    now,
  );

  return {
    id: 'sample-team',
    name: 'Field Notes launch',
    description: 'A made-up team launching a made-up note-taking app.',
    mode: 'team',
    createdAt: now.toISOString(),
    isSample: true,
    people,
    agents,
    tasks,
    overlapDecisions: [],
  };
}

export function soloSample(now = new Date()): Project {
  const people = [person('me', 'Sam', 'Solo builder', true)];
  const agents = [
    agent('atlas', 'atlas', 'claude-code', 'me'),
    agent('bolt', 'bolt', 'codex', 'me'),
    agent('canvas', 'canvas', 'cursor', 'me'),
    agent('draft', 'draft', 'windsurf', 'me'),
    agent('echo', 'echo', 'github-copilot', 'me'),
  ];

  const tasks = buildTasks(
    [
      { title: 'Audit the old site', summary: 'List the pages worth keeping.', kind: 'research', status: 'done', owner: 'atlas', touches: ['Site audit'], update: ['Eight pages are worth keeping.', 400] },
      { title: 'Choose the new structure', summary: 'Decide on the pages and navigation.', kind: 'writing', status: 'done', owner: 'me', dependsOn: [1], touches: ['Site structure'], update: ['Structure chosen.', 300] },
      { title: 'Design the home page', summary: 'A simple layout that leads with recent work.', kind: 'design', status: 'review', owner: 'canvas', dependsOn: [2], touches: ['Home page design'], update: ['Two options ready to review.', 30] },
      { title: 'Build shared layout', summary: 'The header, footer and page frame.', kind: 'code', status: 'active', owner: 'bolt', dependsOn: [2], touches: ['src/layout/', 'src/styles/theme.css'], update: ['Header is done. Now changing the theme.', 6], started: 40, steps: [2, 4] },
      { title: 'Move blog to new styles', summary: 'Update the blog templates.', kind: 'code', status: 'active', owner: 'echo', dependsOn: [2], touches: ['src/blog/', 'src/styles/theme.css'], update: ['Next step is the shared theme file.', 4], started: 25 },
      { title: 'Rewrite the about page', summary: 'Shorter and clearer.', kind: 'writing', status: 'active', owner: 'draft', dependsOn: [2], touches: ['About page copy'], update: ['Second draft is under way.', 15], started: 35 },
      { title: 'Build the home page', summary: 'Build the chosen design.', kind: 'code', status: 'blocked', owner: 'bolt', dependsOn: [3, 4], touches: ['src/home/'], update: ['Waiting for a design choice and the shared layout.', 20] },
      { title: 'Check links and metadata', summary: 'Make sure nothing is broken before publishing.', kind: 'docs', status: 'queued', owner: 'atlas', dependsOn: [5, 6, 7], touches: ['Link report'] },
      { title: 'Publish the new site', summary: 'Do the final check and publish it.', kind: 'writing', status: 'queued', owner: 'me', dependsOn: [8], touches: ['Launch decision'] },
    ],
    people,
    agents,
    now,
  );

  return {
    id: 'sample-solo',
    name: 'Personal site rewrite',
    description: 'One made-up person running five made-up agents.',
    mode: 'solo',
    createdAt: now.toISOString(),
    isSample: true,
    people,
    agents,
    tasks,
    overlapDecisions: [],
  };
}
