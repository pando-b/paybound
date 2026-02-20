import { readFileSync } from 'fs';
import { load as parseYAML } from 'js-yaml';
import type { PolicySet, Policy } from './types';
import { validatePoliciesFile } from './schema';

/**
 * Load and validate a YAML policies file.
 * YAML should be a mapping from agentId to Policy.
 */
export function loadPolicies(filePath: string): PolicySet {
  const content = readFileSync(filePath, 'utf8');
  const raw = parseYAML(content);
  const record = validatePoliciesFile(raw);

  const map: PolicySet = new Map();
  for (const [agentId, p] of Object.entries(record)) {
    const policy: Policy = {
      name: p.name,
      budget: {
        max_per_transaction: p.budget.max_per_transaction,
        max_per_hour: p.budget.max_per_hour,
        max_per_day: p.budget.max_per_day,
      },
      allowed_resources: p.allowed_resources,
      on_violation: p.on_violation,
    };
    map.set(agentId, policy);
  }
  return map;
}
