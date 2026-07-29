// Optional: screen the paying agent against 402.coffee's trust layer before
// proxying an allowed payment. OFF by default — enable with PAYBOUND_402COFFEE_VERIFY=1.
//
// Paybound enforces *your* policy on the agent (budgets, allowed resources).
// 402.coffee grades the *agent's* payment behaviour: does it refuse deliberately
// over-priced "scam" orders, and does it check who it's paying (recipient-swap)?
// Every result is a fact observed on-chain. The /verify endpoint is free.
//   Guide: https://api.402.coffee/integrations
//
// Env:
//   PAYBOUND_402COFFEE_VERIFY   truthy → enable the screen (default: off)
//   PAYBOUND_402COFFEE_MODE     "flag" (default, annotate only) | "block" (deny)
//   PAYBOUND_402COFFEE_REQUIRE  comma list of capabilities that must be held,
//                               e.g. "scam_resistance,recipient_awareness"
//   PAYBOUND_402COFFEE_ON_ERROR "deny" (default, block mode fails CLOSED) | "allow"
//                               — only applies in block mode when the screen is unreachable
//   PAYBOUND_402COFFEE_BASE     override API base (default https://api.402.coffee)

const BASE = process.env.PAYBOUND_402COFFEE_BASE ?? 'https://api.402.coffee';
const REQUIRE = (process.env.PAYBOUND_402COFFEE_REQUIRE ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export interface AgentTrust {
  checked: boolean;
  verified: boolean;
  freshFail: boolean;
  missingRequired: string[];
  activity?: { settled_payments: number; distinct_counterparties: number; last_seen_days: number | null };
  source: '402.coffee';
}

/** Best-effort extraction of the payer wallet from an x402 verify body. */
export function extractPayer(body: any): string | null {
  const candidates = [
    body?.paymentPayload?.payload?.authorization?.from,
    body?.payload?.authorization?.from,
    body?.paymentPayload?.authorization?.from,
    body?.from,
    body?.payer,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && /^0x[0-9a-fA-F]{40}$/.test(c)) return c.toLowerCase();
  }
  return null;
}

/**
 * Call 402.coffee /verify for a payer wallet. Returns null on any failure or if
 * the wallet is unknown — the screen is fail-open and never breaks the proxy.
 */
export async function checkAgentTrust(wallet: string | null): Promise<AgentTrust | null> {
  if (!wallet) return null;
  try {
    const r = await fetch(`${BASE}/verify?wallet=${wallet}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    const caps: Record<string, any> = j?.capabilities ?? {};
    const freshFail = Object.values(caps).some(
      (c: any) => c?.tested && c?.result === 'fail' && c?.expired !== true,
    );
    const missingRequired = REQUIRE.filter((name) => {
      const c = caps[name];
      return !(c?.tested && c?.result === 'pass' && c?.expired !== true);
    });
    return {
      checked: true,
      verified: j?.verified === true,
      freshFail,
      missingRequired,
      activity: j?.activity,
      source: '402.coffee',
    };
  } catch {
    return null; // fail-open: a trust-check blip must never block a policy-allowed payment
  }
}

/** Is this screen enabled? */
export function agentTrustEnabled(): boolean {
  return !!process.env.PAYBOUND_402COFFEE_VERIFY;
}

/**
 * In block mode, should this result deny the payment?
 * `trust === null` means the screen couldn't produce a result (unreachable, timeout,
 * or no payer wallet). In block mode that is governed by PAYBOUND_402COFFEE_ON_ERROR:
 * default "deny" fails CLOSED so an unreachable screen can't silently wave payers
 * through; "allow" fails open. flag mode never blocks.
 */
export function shouldBlock(trust: AgentTrust | null): { block: boolean; reason?: string } {
  const blockMode = (process.env.PAYBOUND_402COFFEE_MODE ?? 'flag') === 'block';
  if (!trust) {
    const onError = (process.env.PAYBOUND_402COFFEE_ON_ERROR ?? 'deny').toLowerCase();
    if (blockMode && onError === 'deny') {
      return { block: true, reason: '402.coffee trust check unavailable — failing closed (set PAYBOUND_402COFFEE_ON_ERROR=allow to fail open)' };
    }
    return { block: false };
  }
  if (!blockMode) return { block: false };
  if (trust.freshFail) return { block: true, reason: 'payer has a current failed 402.coffee conformance test (signed a bait payment within 30 days)' };
  if (trust.missingRequired.length) return { block: true, reason: `payer missing required 402.coffee capability: ${trust.missingRequired.join(', ')}` };
  return { block: false };
}
