import type { ToolId } from '../../src/domain/types.ts';
import { claudeCode } from './claudeCode.ts';
import type { AgentAdapter } from './types.ts';

/** Tools CoBuddy can really receive live updates from. */
export const adapters: Partial<Record<ToolId, AgentAdapter>> = {
  'claude-code': claudeCode,
};
