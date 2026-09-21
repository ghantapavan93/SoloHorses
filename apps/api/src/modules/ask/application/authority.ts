import { TOOL_DEFINITIONS } from './ask.tools';
import { REFUSED_CAPABILITIES } from './policy';

/**
 * The assistant's authority boundary, as data: what it reads freely, what reaches the domain
 * only through a person, and what it will never do. Drawn from the same definitions the loop
 * and the gate run on, so the diagram of it cannot drift from the code.
 */
export interface AuthorityCatalog {
  tools: { name: string; authority: 'read_only' | 'requires_approval'; description: string }[];
  refused: { key: string; name: string; reason: string; detail: string }[];
}

export function authorityCatalog(): AuthorityCatalog {
  return {
    tools: TOOL_DEFINITIONS.map((t) => ({
      name: t.name,
      authority: t.name === 'proposeAction' ? 'requires_approval' : 'read_only',
      description: t.description ?? '',
    })),
    refused: REFUSED_CAPABILITIES.map((c) => ({ key: c.key, name: c.name, reason: c.reason, detail: c.detail })),
  };
}
