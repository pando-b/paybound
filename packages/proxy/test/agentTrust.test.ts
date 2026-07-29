import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shouldBlock, extractPayer, agentTrustEnabled, type AgentTrust } from '../src/agentTrust';
import { createProxy } from '../src/index';

const PAYER = '0x' + 'aB'.repeat(20); // 40 hex chars, mixed case
const trust = (over: Partial<AgentTrust> = {}): AgentTrust => ({
  checked: true,
  verified: true,
  freshFail: false,
  missingRequired: [],
  source: '402.coffee',
  ...over,
});

const TRUST_ENV = [
  'PAYBOUND_402COFFEE_VERIFY',
  'PAYBOUND_402COFFEE_MODE',
  'PAYBOUND_402COFFEE_ON_ERROR',
  'PAYBOUND_402COFFEE_REQUIRE',
];
function clearTrustEnv() {
  for (const k of TRUST_ENV) delete process.env[k];
}

describe('shouldBlock — flag / block / fail-open decision', () => {
  beforeEach(clearTrustEnv);

  it('flag mode never blocks, even on a fresh fail', () => {
    process.env.PAYBOUND_402COFFEE_MODE = 'flag';
    expect(shouldBlock(trust({ freshFail: true })).block).toBe(false);
  });

  it('block mode blocks a fresh fail', () => {
    process.env.PAYBOUND_402COFFEE_MODE = 'block';
    expect(shouldBlock(trust({ freshFail: true })).block).toBe(true);
  });

  it('block mode blocks a missing required capability', () => {
    process.env.PAYBOUND_402COFFEE_MODE = 'block';
    expect(shouldBlock(trust({ missingRequired: ['scam_resistance'] })).block).toBe(true);
  });

  it('block mode allows a clean payer', () => {
    process.env.PAYBOUND_402COFFEE_MODE = 'block';
    expect(shouldBlock(trust()).block).toBe(false);
  });

  it('block mode fails CLOSED on an unavailable result by default', () => {
    process.env.PAYBOUND_402COFFEE_MODE = 'block';
    expect(shouldBlock(null).block).toBe(true);
  });

  it('block mode fails open on unavailable when ON_ERROR=allow', () => {
    process.env.PAYBOUND_402COFFEE_MODE = 'block';
    process.env.PAYBOUND_402COFFEE_ON_ERROR = 'allow';
    expect(shouldBlock(null).block).toBe(false);
  });

  it('flag mode never blocks on an unavailable result', () => {
    process.env.PAYBOUND_402COFFEE_MODE = 'flag';
    expect(shouldBlock(null).block).toBe(false);
  });
});

describe('extractPayer', () => {
  it('extracts and lowercases a valid payer wallet', () => {
    const body = { paymentPayload: { payload: { authorization: { from: PAYER } } } };
    expect(extractPayer(body)).toBe(PAYER.toLowerCase());
  });
  it('returns null when no payer is present', () => {
    expect(extractPayer({})).toBe(null);
  });
});

describe('agentTrustEnabled — off by default', () => {
  beforeEach(clearTrustEnv);
  it('is off unless PAYBOUND_402COFFEE_VERIFY is set', () => {
    expect(agentTrustEnabled()).toBe(false);
    process.env.PAYBOUND_402COFFEE_VERIFY = '1';
    expect(agentTrustEnabled()).toBe(true);
  });
});

describe('proxy handler + 402.coffee screen', () => {
  beforeEach(() => {
    clearTrustEnv();
    process.env.PAYBOUND_DB = ':memory:';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTrustEnv();
    delete process.env.PAYBOUND_DB;
  });

  it('off by default: screen never runs, request proxies to upstream', async () => {
    const { app, ledger } = createProxy({ port: 0, upstreamFacilitator: 'http://localhost:9999' });
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Paybound-Agent': 'off' },
      body: JSON.stringify({ resourceUrl: 'https://api.example.com/data', amount: '0.10', currency: 'USDC' }),
    });
    expect(res.status).toBe(502); // upstream unreachable — screen was never consulted
    ledger.close();
  });

  it('block mode + fresh fail: 403 with exactly ONE deny row and no budget consumed', async () => {
    process.env.PAYBOUND_402COFFEE_VERIFY = '1';
    process.env.PAYBOUND_402COFFEE_MODE = 'block';
    // Mock 402.coffee /verify to report a current failed conformance test.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            verified: false,
            capabilities: { scam_resistance: { tested: true, result: 'fail', expired: false } },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const { app, ledger } = createProxy({ port: 0, upstreamFacilitator: 'http://localhost:9999' });
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Paybound-Agent': 'bad' },
      body: JSON.stringify({
        resourceUrl: 'https://api.example.com/data',
        amount: '0.10',
        currency: 'USDC',
        paymentPayload: { payload: { authorization: { from: PAYER } } },
      }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('402coffee_trust');

    const txs = ledger.getTransactions({ agentId: 'bad' });
    expect(txs.length).toBe(1); // single deny row — not allow + deny (Bug 1)
    expect(txs[0].policyResult).toBe('deny');
    expect(ledger.getSpendInWindow('bad', 60_000)).toBe(0); // blocked payment consumed no budget
    ledger.close();
  });
});
