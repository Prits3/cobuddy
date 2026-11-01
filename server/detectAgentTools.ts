import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

export type Presence = 'installed' | 'traces' | 'absent';

export interface ToolDetection {
  id: string;
  presence: Presence;
  evidence: string[];
}

interface ToolProbe {
  id: string;
  commands: string[];
  apps: string[];
  extensionPrefixes: string[];
  configDirs: string[];
}

const probes: ToolProbe[] = [
  { id: 'claude-code', commands: ['claude'], apps: [], extensionPrefixes: ['anthropic.claude-code'], configDirs: ['.claude'] },
  { id: 'codex', commands: ['codex'], apps: ['Codex.app'], extensionPrefixes: ['openai.chatgpt'], configDirs: ['.codex'] },
  { id: 'github-copilot', commands: ['copilot'], apps: [], extensionPrefixes: ['github.copilot'], configDirs: ['.copilot'] },
  { id: 'cursor', commands: ['cursor'], apps: ['Cursor.app'], extensionPrefixes: [], configDirs: ['.cursor'] },
  { id: 'windsurf', commands: ['windsurf'], apps: ['Windsurf.app'], extensionPrefixes: [], configDirs: ['.windsurf', '.codeium'] },
];

function onPath(command: string): boolean {
  return (process.env.PATH ?? '').split(delimiter).some((dir) => dir && existsSync(join(dir, command)));
}

function vscodeExtensions(home: string): string[] {
  try {
    return readdirSync(join(home, '.vscode', 'extensions'));
  } catch {
    return [];
  }
}

/**
 * Reports whether agent tools appear to be on this machine. It only checks that
 * names exist. It never opens a tool's config, credentials, logs or conversations.
 */
export function detectAgentTools(home = homedir()): ToolDetection[] {
  const extensions = vscodeExtensions(home);

  return probes.map((probe) => {
    const installed = [
      ...probe.commands.filter(onPath).map((command) => `${command} command`),
      ...probe.apps
        .filter((app) => existsSync(join('/Applications', app)))
        .map((app) => app.replace('.app', ' app')),
      ...(probe.extensionPrefixes.some((prefix) => extensions.some((name) => name.startsWith(prefix)))
        ? ['VS Code extension']
        : []),
    ];
    const traces = probe.configDirs
      .filter((dir) => existsSync(join(home, dir)))
      .map((dir) => `~/${dir} folder`);

    const presence: Presence = installed.length ? 'installed' : traces.length ? 'traces' : 'absent';
    return { id: probe.id, presence, evidence: [...installed, ...traces] };
  });
}
