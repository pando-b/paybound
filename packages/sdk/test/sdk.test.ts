import { describe, it, expect } from 'vitest';
import { PayboundClient, PolicyViolationError } from '../src/index';

describe('PayboundClient', () => {
  it('creates client with config', () => {
    const client = new PayboundClient({
      agentId: 'test-agent',
      proxy: 'http://localhost:4020',
    });
    expect(client).toBeDefined();
  });

  it('uses default proxy URL', () => {
    const client = new PayboundClient({ agentId: 'bot-1' });
    // Verify it doesn't throw
    expect(client).toBeDefined();
  });

  it('PolicyViolationError has correct properties', () => {
    const err = new PolicyViolationError({
      reason: 'exceeded limit',
      policy: 'default',
      agentId: 'bot-1',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PolicyViolationError');
    expect(err.reason).toBe('exceeded limit');
    expect(err.policy).toBe('default');
    expect(err.agentId).toBe('bot-1');
    expect(err.message).toContain('exceeded limit');
  });
});
