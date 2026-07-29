import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { evaluate, loadPolicies, Ledger } from './deps';
import type { Transaction, PolicySet } from '@paybound/core';
import { checkAgentTrust, extractPayer, agentTrustEnabled, shouldBlock, type AgentTrust } from './agentTrust';

export interface ProxyConfig {
  port?: number;
  policyFile?: string;
  upstreamFacilitator?: string;
}

export function createProxy(config: ProxyConfig = {}) {
  const port = config.port ?? parseInt(process.env.PAYBOUND_PORT ?? '4020', 10);
  const policyFile = config.policyFile ?? process.env.PAYBOUND_POLICY_FILE;
  const upstream = config.upstreamFacilitator ?? process.env.PAYBOUND_UPSTREAM ?? 'https://x402.org/facilitator';

  // Facilitator compliance warning
  const knownCompliantFacilitators = ['x402.org', 'coinbase.com', 'cdp.coinbase.com'];
  const isCompliantFacilitator = knownCompliantFacilitators.some((f) => upstream.includes(f));
  if (!isCompliantFacilitator) {
    console.warn(
      '[paybound] ⚠️  Non-standard facilitator detected: %s',
      upstream,
    );
    console.warn(
      '[paybound] ⚠️  Ensure your facilitator performs OFAC/KYT compliance screening.',
    );
    console.warn(
      '[paybound] ⚠️  See https://docs.x402.org for compliant facilitator options.',
    );
  }

  // Load policies
  let policies: PolicySet = new Map();
  if (policyFile) {
    try {
      policies = loadPolicies(policyFile);
      console.log(`[paybound] Loaded ${policies.size} policies from ${policyFile}`);
    } catch (err) {
      console.warn(`[paybound] Failed to load policies from ${policyFile}:`, err);
    }
  } else {
    console.log('[paybound] No policy file specified, using default policy for all agents');
  }

  // Initialize ledger
  const dbPath = process.env.PAYBOUND_DB ?? 'paybound.db';
  const ledger = new Ledger(dbPath);

  const app = new Hono();

  // Health endpoint
  app.get('/health', (c) => {
    const stats = ledger.getStats();
    return c.json({
      status: 'ok',
      version: '0.1.0',
      policies: policies.size,
      transactions: stats.count,
      totalVolume: stats.totalVolume,
      agents: stats.agents,
    });
  });

  // Verify endpoint — intercepts x402 payment verification
  app.post('/verify', async (c) => {
    const body = await c.req.json();
    const agentId = c.req.header('X-Paybound-Agent') ?? 'unknown';

    // Extract transaction details from x402 payload
    const tx: Transaction = {
      agentId,
      resourceUrl: body.resourceUrl ?? body.resource ?? '',
      amount: parseFloat(body.amount ?? body.maxAmountRequired ?? '0'),
      currency: body.currency ?? 'USDC',
      timestamp: new Date(),
      scheme: body.scheme ?? 'exact',
    };

    // Evaluate against policies
    const evaluation = evaluate(
      tx,
      policies,
      (id, windowMs) => ledger.getSpendInWindow(id, windowMs),
    );

    // Optional 402.coffee agent-trust screen (off unless PAYBOUND_402COFFEE_VERIFY is set).
    // Paybound checks YOUR policy on the agent; 402.coffee checks the agent's on-chain
    // payment behaviour (does it refuse over-priced scams / verify the recipient).
    // The screen result is folded into a SINGLE ledger write below.
    let finalResult = evaluation.result;
    let finalReason = evaluation.reason;
    let finalPolicy = evaluation.matchedPolicy;

    let agentTrust: AgentTrust | null = null;
    if (finalResult !== 'deny' && agentTrustEnabled()) {
      agentTrust = await checkAgentTrust(extractPayer(body));
      const decision = shouldBlock(agentTrust);
      if (agentTrust === null) {
        // Screen produced no result — log whether we failed open or closed (never silent).
        console.warn(
          '[paybound] 402.coffee screen could not verify payer (unreachable/timeout/no wallet) — %s',
          decision.block ? 'failing CLOSED (blocked)' : 'failing open (allowed)',
        );
      }
      if (decision.block) {
        finalResult = 'deny';
        finalReason = decision.reason ?? '402coffee_trust';
        finalPolicy = '402.coffee';
      }
    }

    // Record ONCE — the final decision. A screen-blocked payment logs a single deny row
    // (never allow+deny), so it never consumes the agent's rolling budget or double-counts /health.
    ledger.record({
      agentId: tx.agentId,
      resourceUrl: tx.resourceUrl,
      amount: tx.amount,
      currency: tx.currency,
      scheme: tx.scheme,
      timestamp: Date.now(),
      policyResult: finalResult,
      policyReason: finalReason,
      matchedPolicy: finalPolicy,
    });

    // If denied (by policy or the trust screen), return 403.
    if (finalResult === 'deny') {
      if (finalPolicy === '402.coffee') {
        return c.json({ error: '402coffee_trust', reason: finalReason, agentTrust }, 403);
      }
      return c.json(
        { error: 'policy_violation', reason: finalReason, policy: finalPolicy, agentId },
        403,
      );
    }

    // Build the trust header BEFORE the upstream call, ASCII-safe and size-bounded, so a
    // non-ASCII byte can't throw inside the try and get mis-reported as an upstream_error 502.
    // ponytail: URI-encoded JSON, 1KB ceiling; consumers decodeURIComponent(). Raise cap if needed.
    const trustHeader = agentTrust
      ? encodeURIComponent(JSON.stringify(agentTrust)).slice(0, 1024)
      : null;
    if (trustHeader) c.header('X-Paybound-Agent-Trust', trustHeader);

    // If allowed, proxy to upstream facilitator
    try {
      const upstreamRes = await fetch(`${upstream}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(c.req.header('Authorization')
            ? { Authorization: c.req.header('Authorization')! }
            : {}),
        },
        body: JSON.stringify(body),
      });
      const upstreamBody = await upstreamRes.json();
      return c.json(upstreamBody, upstreamRes.status as any);
    } catch (err) {
      return c.json({ error: 'upstream_error', message: String(err) }, 502);
    }
  });

  // Settle endpoint — intercepts x402 payment settlement
  app.post('/settle', async (c) => {
    const body = await c.req.json();
    const agentId = c.req.header('X-Paybound-Agent') ?? 'unknown';

    // For settlement, we trust that verify already passed.
    // Just proxy and log.
    try {
      const upstreamRes = await fetch(`${upstream}/settle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(c.req.header('Authorization')
            ? { Authorization: c.req.header('Authorization')! }
            : {}),
        },
        body: JSON.stringify(body),
      });
      const upstreamBody = await upstreamRes.json();
      return c.json(upstreamBody, upstreamRes.status as any);
    } catch (err) {
      return c.json({ error: 'upstream_error', message: String(err) }, 502);
    }
  });

  // Transaction query endpoint
  app.get('/transactions', (c) => {
    const agentId = c.req.query('agentId');
    const since = c.req.query('since');
    const limit = c.req.query('limit');

    const txs = ledger.getTransactions({
      agentId: agentId ?? undefined,
      since: since ? parseInt(since, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });

    return c.json({ transactions: txs });
  });

  return { app, ledger, port };
}

/**
 * Start the Paybound proxy server.
 */
export function startProxy(config: ProxyConfig = {}) {
  const { app, port } = createProxy(config);

  console.log(`[paybound] Proxy starting on port ${port}`);
  console.log(`[paybound] Health: http://localhost:${port}/health`);

  const server = serve({ fetch: app.fetch, port });
  return server;
}

// CLI entry
if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  startProxy();
}
