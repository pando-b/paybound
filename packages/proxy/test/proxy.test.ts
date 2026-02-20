import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createProxy } from '../src/index';

describe('Paybound Proxy', () => {
  let app: ReturnType<typeof createProxy>['app'];
  let ledger: ReturnType<typeof createProxy>['ledger'];

  beforeAll(() => {
    const proxy = createProxy({
      port: 0,
      upstreamFacilitator: 'http://localhost:9999', // won't be reached in most tests
    });
    app = proxy.app;
    ledger = proxy.ledger;
  });

  afterAll(() => {
    ledger.close();
  });

  it('returns health status', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.1.0');
    expect(typeof body.transactions).toBe('number');
  });

  it('denies transactions exceeding default policy', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Paybound-Agent': 'test-agent',
      },
      body: JSON.stringify({
        resourceUrl: 'https://api.example.com/data',
        amount: '5.00', // default limit is $1/tx
        currency: 'USDC',
        scheme: 'exact',
      }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('policy_violation');
    expect(body.reason).toMatch(/exceeds per-transaction limit/);
  });

  it('records denied transactions in ledger', async () => {
    // The previous test already created a denied tx
    const txs = ledger.getTransactions({ agentId: 'test-agent' });
    expect(txs.length).toBeGreaterThan(0);
    expect(txs[0].policyResult).toBe('deny');
  });

  it('returns transactions via API', async () => {
    const res = await app.request('/transactions?agentId=test-agent');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transactions.length).toBeGreaterThan(0);
  });

  it('allows small transactions under default limit', async () => {
    // This will try to reach upstream (which won't work), but the policy check should pass
    const res = await app.request('/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Paybound-Agent': 'small-spender',
      },
      body: JSON.stringify({
        resourceUrl: 'https://api.example.com/data',
        amount: '0.50',
        currency: 'USDC',
        scheme: 'exact',
      }),
    });
    // Will get 502 (upstream unreachable) but NOT 403 — policy passed
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('upstream_error');
  });
});
