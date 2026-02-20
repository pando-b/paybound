/**
 * Represents spending limits for a policy.
 */
export interface Budget {
  max_per_transaction: number;
  max_per_hour: number;
  max_per_day: number;
}

/**
 * Actions to take on policy violation.
 */
export enum OnViolation {
  Block = 'block',
  Alert = 'alert',
  BlockAndAlert = 'block_and_alert',
}

/**
 * A spending policy for an agent.
 */
export interface Policy {
  name: string;
  budget: Budget;
  allowed_resources: string[];
  on_violation: OnViolation;
}

/**
 * A set of policies keyed by agent ID.
 */
export type PolicySet = Map<string, Policy>;

/**
 * A transaction attempted by an agent.
 */
export interface Transaction {
  agentId: string;
  resourceUrl: string;
  amount: number;
  currency: string;
  timestamp: Date;
  scheme: string;
}

/**
 * Result of policy evaluation for a transaction.
 */
export interface PolicyEvaluation {
  result: 'allow' | 'deny';
  reason: string;
  matchedPolicy: string;
}
