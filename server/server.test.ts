import { mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeArgs, parseClaudeLine } from './agents/claudeCode';
import { isTrustedRequest, resolveFolder } from './api';
import { validatePlan } from './prompts';

const folder = '/work/site';
const parse = (event: object) => parseClaudeLine(JSON.stringify(event), folder);
const assistant = (...content: object[]) => ({ type: 'assistant', message: { content } });

describe('reading Claude Code events', () => {
  it('reports a real session start', () => {
    expect(parse({ type: 'system', subtype: 'init' })).toEqual([{ kind: 'session' }]);
  });

  it('never passes on thinking or in-progress text', () => {
    expect(parse(assistant({ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'private' }))).toEqual([]);
  });

  it('reports changed files relative to the project', () => {
    expect(parse(assistant({ type: 'tool_use', name: 'Edit', input: { file_path: '/work/site/src/a.ts' } }))).toEqual([
      { kind: 'file', text: 'Changed src/a.ts', files: ['src/a.ts'] },
    ]);
  });

  it('doesn’t reveal paths outside the project', () => {
    const [report] = parse(assistant({ type: 'tool_use', name: 'Read', input: { file_path: '/Users/me/secret.txt' } }));
    expect(JSON.stringify(report)).not.toContain('secret');
  });

  it('recognises a linked path as inside the project', () => {
    const real = realpathSync(tmpdir());
    const link = join(mkdtempSync(join(real, 'cobuddy-link-')), 'project');
    symlinkSync(real, link);
    const [report] = parseClaudeLine(JSON.stringify(assistant({ type: 'tool_use', name: 'Write', input: { file_path: join(link, 'new-file.txt') } })), real);
    expect(report).toEqual({ kind: 'file', text: 'Changed new-file.txt', files: ['new-file.txt'] });
  });

  it('doesn’t reveal what an agent searched for', () => {
    const [report] = parse(assistant({ type: 'tool_use', name: 'Grep', input: { pattern: 'password' } }));
    expect(report).toEqual({ kind: 'tool', text: 'Searched the project' });
  });

  it('reports refusals before the result', () => {
    const reports = parse({ type: 'result', subtype: 'success', result: 'Could not', permission_denials: [{ tool_name: 'Write', tool_input: { file_path: '/etc/x' } }] });
    expect(reports.map((report) => report.kind)).toEqual(['denied', 'finished']);
  });

  it('treats a budget stop as a failure, not a finish', () => {
    expect(parse({ type: 'result', subtype: 'error_max_budget_usd', is_error: true })[0].kind).toBe('failed');
  });

  it('ignores lines it can’t read', () => {
    expect(parseClaudeLine('not json', folder)).toEqual([]);
  });
});

describe('what an agent is allowed to do', () => {
  const args = (mode: 'ping' | 'plan' | 'task') => claudeArgs({ mode, folder, prompt: 'go' });
  const after = (list: string[], flag: string) => list[list.indexOf(flag) + 1];

  it('gives working agents no shell', () => {
    expect(after(args('task'), '--tools')).toBe('Read,Write,Edit,Glob,Grep');
  });

  it('lets planners read but not edit', () => {
    expect(after(args('plan'), '--tools')).toBe('Read,Glob,Grep');
    expect(args('plan')).not.toContain('--permission-mode');
  });

  it('loads no personal or project settings, and always has a budget', () => {
    for (const mode of ['ping', 'plan', 'task'] as const) {
      expect(after(args(mode), '--setting-sources')).toBe('');
      expect(args(mode)).toContain('--max-budget-usd');
    }
  });
});

describe('who can reach the agent routes', () => {
  const page = { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' };

  it('allows CoBuddy’s own page', () => {
    expect(isTrustedRequest(page, 'POST')).toBe(true);
  });

  it('refuses other websites', () => {
    expect(isTrustedRequest({ ...page, origin: 'https://evil.example' }, 'POST')).toBe(false);
  });

  it('refuses a domain pointed at this computer', () => {
    expect(isTrustedRequest({ ...page, host: 'evil.example:5173', origin: 'http://evil.example:5173' }, 'POST')).toBe(false);
  });

  it('refuses form posts, which skip the browser’s own checks', () => {
    expect(isTrustedRequest({ ...page, 'content-type': 'text/plain' }, 'POST')).toBe(false);
  });
});

describe('choosing a folder', () => {
  it('refuses the home folder and the whole computer', () => {
    expect(() => resolveFolder(homedir())).toThrow();
    expect(() => resolveFolder('~')).toThrow();
    expect(() => resolveFolder('/')).toThrow();
  });

  it('refuses relative and missing folders', () => {
    expect(() => resolveFolder('src')).toThrow();
    expect(() => resolveFolder('/no/such/folder')).toThrow();
  });

  it('accepts a real folder', () => {
    expect(resolveFolder(tmpdir())).toBeTruthy();
  });
});

describe('checking a plan', () => {
  const task = (key: string, dependsOn: string[] = []) => ({ key, title: key, summary: '', kind: 'code', dependsOn, touches: [] });

  it('accepts a usable plan', () => {
    expect(validatePlan({ tasks: [task('a'), task('b', ['a'])] })).toHaveLength(2);
  });

  it('rejects empty plans, repeated keys and loops', () => {
    expect(validatePlan({ tasks: [] })).toBeNull();
    expect(validatePlan(undefined)).toBeNull();
    expect(validatePlan({ tasks: [task('a'), task('a')] })).toBeNull();
    expect(validatePlan({ tasks: [task('a', ['b']), task('b', ['a'])] })).toBeNull();
  });

  it('drops dependencies on tasks that don’t exist', () => {
    expect(validatePlan({ tasks: [task('a', ['ghost'])] })?.[0].dependsOn).toEqual([]);
  });
});
