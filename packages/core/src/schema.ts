import { z } from 'zod';
import { OnViolation } from './types';

export const BudgetSchema = z.object({
  max_per_transaction: z.number().nonnegative(),
  max_per_hour: z.number().nonnegative(),
  max_per_day: z.number().nonnegative(),
});

export const PolicySchema = z.object({
  name: z.string(),
  budget: BudgetSchema,
  allowed_resources: z.array(z.string()),
  on_violation: z.nativeEnum(OnViolation),
});

export const PoliciesFileSchema = z.record(z.string(), PolicySchema);

/**
 * Validate a parsed YAML object as a PolicySet-like record.
 */
export function validatePoliciesFile(obj: unknown) {
  return PoliciesFileSchema.parse(obj);
}
