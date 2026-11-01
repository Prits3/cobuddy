import { realpathSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { dirname, isAbsolute } from 'node:path';
import type { ToolId } from '../src/domain/types.ts';
import { adapters } from './agents/index.ts';
import { detectAgentTools } from './detectAgentTools.ts';
import { Hub } from './hub.ts';

const LOCAL_HOST = /^(127\.0\.0\.1|localhost)(:\d+)?$/;
const PROJECT_ID = /^[\w-]+$/;
const MAX_BODY = 256 * 1024;

/**
 * These routes start agents on this computer, so only CoBuddy's own page may
 * call them. The checks stop other websites reaching them through the browser,
 * including by pointing their own domain at 127.0.0.1.
 */
export function isTrustedRequest(headers: IncomingMessage['headers'], method = 'GET'): boolean {
  const host = headers.host ?? '';
  if (!LOCAL_HOST.test(host)) return false;
  if (headers.origin && headers.origin !== `http://${host}`) return false;
  if (method === 'POST' && !headers['content-type']?.startsWith('application/json')) return false;
  return true;
}

/** Agents get exactly one real folder, and never the whole computer or home. */
export function resolveFolder(input: unknown, home = homedir()): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Choose a folder for this project.');
  const typed = input.trim().replace(/^~(?=$|\/)/, home);
  if (!isAbsolute(typed)) throw new Error('Enter the full path to the folder.');

  let folder: string;
  try {
    folder = realpathSync(typed);
    if (!statSync(folder).isDirectory()) throw new Error();
  } catch {
    throw new Error('That folder doesn’t exist.');
  }
  if (folder === dirname(folder) || folder === realpathSync(home)) {
    throw new Error('Choose a project folder, not your whole home folder or computer.');
  }
  return folder;
}

function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY) reject(new Error('That request is too large.'));
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('That request wasn’t valid.'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function projectId(value: unknown): string {
  if (typeof value !== 'string' || !PROJECT_ID.test(value)) throw new Error('Unknown project.');
  return value;
}

function streamEvents(hub: Hub, req: IncomingMessage, res: ServerResponse, url: URL) {
  const id = projectId(url.searchParams.get('projectId'));
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(': connected\n\n');

  const unsubscribe = hub.subscribe(id, Number(url.searchParams.get('after')) || 0, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(': still here\n\n'), 20000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

async function handlePost(hub: Hub, path: string, body: Record<string, any>): Promise<unknown> {
  const id = projectId(body.projectId);
  const tool = body.tool as ToolId;

  switch (path) {
    case '/api/connect': {
      const folder = resolveFolder(body.folder);
      hub.connect(id, tool, folder, Math.min(3, Math.max(1, Number(body.workers) || 1)));
      return { folder };
    }
    case '/api/plan':
      hub.plan(id, tool, resolveFolder(body.folder), String(body.goal ?? '').slice(0, 4000));
      return {};
    case '/api/tasks/start':
      hub.startTask(id, { ...body, tool, folder: resolveFolder(body.folder) } as Parameters<Hub['startTask']>[1]);
      return {};
    case '/api/tasks/stop':
      return { stopped: hub.stopTask(id, String(body.taskId)) };
    default:
      throw new Error('Unknown route.');
  }
}

export function agentApi(hub: Hub) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return next();
    if (!isTrustedRequest(req.headers, req.method)) return send(res, 403, { error: 'Only CoBuddy’s own page can use this.' });

    if (req.method === 'POST') {
      readJson(req)
        .then((body) => handlePost(hub, url.pathname, body))
        .then((result) => send(res, 200, result))
        .catch((error: Error) => send(res, 400, { error: error.message }));
      return;
    }

    try {
      if (url.pathname === '/api/agent-tools') {
        return send(res, 200, detectAgentTools().map((tool) => ({ ...tool, liveUpdates: tool.id in adapters, limits: adapters[tool.id as ToolId]?.limits })));
      }
      if (url.pathname === '/api/events') return streamEvents(hub, req, res, url);
      send(res, 404, { error: 'Unknown route.' });
    } catch (error) {
      send(res, 400, { error: (error as Error).message });
    }
  };
}

