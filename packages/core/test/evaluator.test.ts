import { describe, it, expect, vi } from 'vitest';
import { evaluate } from '../src/evaluator';
import { PolicySet, OnViolation, Transaction, Policy } from '../src/types';

function makePolicy(agentId: string, p: Policy): PolicySet {
  const m = new Map<string, Policy>();
  m.set(agentId, p);
  return m;
}

describe('policy evaluator', () => {
  const now = new Date();
  const baseTx: Omit<Transaction, 'timestamp'> = {
    agentId: 'alice',
    resourceUrl: 'https://api.service.com/endpoint',
    amount: 1,
    currency: 'USD',
    scheme: 'exact',
  };

  it('allows when under all limits', () => {
    const policies = makePolicy('alice', {
      name: 'p1',
      budget: { max_per_transaction: 5, max_per_hour: 10, max_per_day: 20 },
      allowed_resources: ['https://api.service.com'],
      on_violation: OnViolation.Block,
    });
    const spy = vi.fn().mockReturnValue(0);
    const result = evaluate({ ...baseTx, timestamp: now, amount: 2 }, policies, spy);
    expect(result).toEqual({
      result: 'allow',
      reason: 'transaction within policy limits',
      matchedPolicy: 'p1',
    });
  });

  it('denies disallowed resource', () => {
    const policies = makePolicy('alice', {
      name: 'p1',
      budget: { max_per_transaction: 5, max_per_hour: 10, max_per_day: 20 },
      allowed_resources: ['https://other.com'],
      on_violation: OnViolation.Block,
    });
    const spy = vi.fn();
    const result = evaluate({ ...baseTx, timestamp: now }, policies, spy);
    expect(result.result).toBe('deny');
    expect(result.reason).toMatch(/not allowed/);
  });

  it('denies per-transaction violations', () => {
    const policies = makePolicy('alice', {
      name: 'p2',
      budget: { max_per_transaction: 3, max_per_hour: 10, max_per_day: 20 },
      allowed_resources: ['*'],
      on_violation: OnViolation.Block,
    });
    const spy = vi.fn().mockReturnValue(0);
    const result = evaluate({ ...baseTx, timestamp: now, amount: 4 }, policies, spy);
    expect(result.result).toBe('deny');
    expect(result.reason).toMatch(/exceeds per-transaction limit/);
  });

  it('denies per-hour violations', () => {
    const policies = makePolicy('alice', {
      name: 'p3',
      budget: { max_per_transaction: 10, max_per_hour: 5, max_per_day: 50 },
      allowed_resources: ['*'],
      on_violation: OnViolation.Block,
    });
    const spy = vi.fn().mockImplementation((_id: string, window: number) =>
      window === 3_600_000 ? 4 : 0,
    );
    const result = evaluate({ ...baseTx, timestamp: now, amount: 2 }, policies, spy);
    expect(result.result).toBe('deny');
    expect(result.reason).toMatch(/hourly spend would exceed limit/);
  });

  it('denies per-day violations', () => {
    const policies = makePolicy('alice', {
      name: 'p4',
      budget: { max_per_transaction: 10, max_per_hour: 100, max_per_day: 5 },
      allowed_resources: ['*'],
      on_violation: OnViolation.Block,
    });
    const spy = vi.fn().mockImplementation((_id: string, window: number) =>
      window === 86_400_000 ? 5 : 0,
    );
    const result = evaluate({ ...baseTx, timestamp: now, amount: 1 }, policies, spy);
    expect(result.result).toBe('deny');
    expect(result.reason).toMatch(/daily spend would exceed limit/);
  });

  it('applies default policy for unknown agents', () => {
    const policies = new Map<string, Policy>();
    const spy = vi.fn().mockReturnValue(0);
    // baseTx.amount = 1, default max_per_transaction = 1
    // amount 1 is NOT > 1, so it should allow
    const result = evaluate({ ...baseTx, timestamp: now, amount: 0.5 }, policies, spy);
    expect(result.result).toBe('allow');
    expect(result.matchedPolicy).toBe('default');
  });

  it('default policy denies when over $1/tx', () => {
    const policies = new Map<string, Policy>();
    const spy = vi.fn().mockReturnValue(0);
    const result = evaluate({ ...baseTx, timestamp: now, amount: 2 }, policies, spy);
    expect(result.result).toBe('deny');
    expect(result.matchedPolicy).toBe('default');
    expect(result.reason).toMatch(/exceeds per-transaction limit/);
  });

  it('allows wildcard resource policy', () => {
    const policies = makePolicy('alice', {
      name: 'permissive',
      budget: { max_per_transaction: 100, max_per_hour: 1000, max_per_day: 5000 },
      allowed_resources: ['*'],
      on_violation: OnViolation.Alert,
    });
    const spy = vi.fn().mockReturnValue(0);
    const result = evaluate({ ...baseTx, timestamp: now, amount: 50 }, policies, spy);
    expect(result.result).toBe('allow');
  });
});
