import { PolicySet, Transaction, PolicyEvaluation, OnViolation } from './types';

/**
 * Default fallback policy when no agent match is found.
 * Restrictive: $1/tx, $10/hr, $50/day. Block + alert on violation.
 */
const DEFAULT_POLICY = {
  name: 'default',
  budget: {
    max_per_transaction: 1,
    max_per_hour: 10,
    max_per_day: 50,
  },
  allowed_resources: ['*'],
  on_violation: OnViolation.BlockAndAlert,
};

/**
 * Evaluate a single transaction against the policies.
 *
 * @param tx - The transaction to check
 * @param policies - Map of agentId → Policy
 * @param getSpendInWindow - Returns total approved spend for agentId over past windowMs
 */
export function evaluate(
  tx: Transaction,
  policies: PolicySet,
  getSpendInWindow: (agentId: string, windowMs: number) => number,
): PolicyEvaluation {
  const policy = policies.get(tx.agentId) ?? DEFAULT_POLICY;
  const { budget, allowed_resources, name } = policy;

  // Resource allowlist check (wildcard '*' permits everything)
  const resourceAllowed = allowed_resources.some(
    (r) => r === '*' || tx.resourceUrl.startsWith(r),
  );
  if (!resourceAllowed) {
    return {
      result: 'deny',
      reason: `resource ${tx.resourceUrl} not allowed`,
      matchedPolicy: name,
    };
  }

  // Per-transaction limit
  if (tx.amount > budget.max_per_transaction) {
    return {
      result: 'deny',
      reason: `amount exceeds per-transaction limit (${tx.amount} > ${budget.max_per_transaction})`,
      matchedPolicy: name,
    };
  }

  // Per-hour rolling window
  const spentHour = getSpendInWindow(tx.agentId, 60 * 60 * 1000);
  if (spentHour + tx.amount > budget.max_per_hour) {
    return {
      result: 'deny',
      reason: `hourly spend would exceed limit (${spentHour + tx.amount} > ${budget.max_per_hour})`,
      matchedPolicy: name,
    };
  }

  // Per-day rolling window
  const spentDay = getSpendInWindow(tx.agentId, 24 * 60 * 60 * 1000);
  if (spentDay + tx.amount > budget.max_per_day) {
    return {
      result: 'deny',
      reason: `daily spend would exceed limit (${spentDay + tx.amount} > ${budget.max_per_day})`,
      matchedPolicy: name,
    };
  }

  return {
    result: 'allow',
    reason: 'transaction within policy limits',
    matchedPolicy: name,
  };
}
