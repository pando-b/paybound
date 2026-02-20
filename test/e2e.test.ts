import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, unlinkSync } from 'fs';
import { createProxy } from '../packages/proxy/src/index';
import { PayboundClient, PolicyViolationError } from '../packages/sdk/src/index';

describe('Paybound E2E', () => {
  let proxyApp: ReturnType<typeof createProxy>['app'];
  let ledger: ReturnType<typeof createProxy>['ledger'];
  const policyFile = '/tmp/paybound-test-policies.yaml';

  beforeAll(() => {
    // Write test policy file
    writeFileSync(
      policyFile,
      `
test-bot:
  name: test-bot-policy
  budget:
    max_per_transaction: 5.0
    max_per_hour: 20.0
    max_per_day: 100.0
  allowed_resources:
    - "https://api.weather.com"
    - "https://api.openai.com"
  on_violation: block
`,
    );

    const proxy = createProxy({
      policyFile,
      upstreamFacilitator: 'http://localhost:9999',
    });
    proxyApp = proxy.app;
    ledger = proxy.ledger;
  });

  afterAll(() => {
    ledger.close();
    try { unlinkSync(policyFile); } catch {}
  });

  it('allows a transaction under policy limits', async () => {
    const res = await proxyApp.request('/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Paybound-Agent': 'test-bot',
      },
      body: JSON.stringify({
        resourceUrl: 'https://api.weather.com/forecast',
        amount: '2.00',
        currency: 'USDC',
        scheme: 'exact',
      }),
    });
    // 502 = policy passed but upstream unreachable (expected)
    expect(res.status).toBe(502);
  });

  it('denies a transaction exceeding per-transaction limit', async () => {
    const res = await proxyApp.request('/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Paybound-Agent': 'test-bot',
      },
      body: JSON.stringify({
        resourceUrl: 'https://api.weather.com/forecast',
        amount: '10.00',
        currency: 'USDC',
        scheme: 'exact',
      }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('policy_violation');
    expect(body.reason).toMatch(/exceeds per-transaction limit/);
    expect(body.policy).toBe('test-bot-policy');
  });

  it('denies access to disallowed resources', async () => {
    const res = await proxyApp.request('/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Paybound-Agent': 'test-bot',
      },
      body: JSON.stringify({
        resourceUrl: 'https://api.evil.com/steal-data',
        amount: '0.01',
        currency: 'USDC',
        scheme: 'exact',
      }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.reason).toMatch(/not allowed/);
  });

  it('applies default policy for unknown agents', async () => {
    const res = await proxyApp.request('/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Paybound-Agent': 'rogue-agent',
      },
      body: JSON.stringify({
        resourceUrl: 'https://api.example.com/data',
        amount: '2.00', // default limit is $1
        currency: 'USDC',
        scheme: 'exact',
      }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.policy).toBe('default');
  });

  it('records all transactions in the ledger', async () => {
    const txs = ledger.getTransactions();
    expect(txs.length).toBeGreaterThanOrEqual(4);

    const allowed = txs.filter((t) => t.policyResult === 'allow');
    const denied = txs.filter((t) => t.policyResult === 'deny');
    expect(allowed.length).toBeGreaterThanOrEqual(1);
    expect(denied.length).toBeGreaterThanOrEqual(3);
  });

  it('health endpoint reflects transaction count', async () => {
    const res = await proxyApp.request('/health');
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.transactions).toBeGreaterThanOrEqual(4);
    expect(body.agents).toBeGreaterThanOrEqual(2);
  });
});
