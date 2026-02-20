/**
 * @paybound/sdk — Client SDK for Paybound-governed x402 payments.
 * Drop-in enhancement for fetch() that routes through a Paybound proxy.
 */

export interface PayboundConfig {
  /** Unique identifier for this agent */
  agentId: string;
  /** Paybound proxy URL (default: http://localhost:4020) */
  proxy?: string;
}

export class PolicyViolationError extends Error {
  public readonly reason: string;
  public readonly policy: string;
  public readonly agentId: string;

  constructor(data: { reason: string; policy: string; agentId: string }) {
    super(`Policy violation: ${data.reason} (policy: ${data.policy})`);
    this.name = 'PolicyViolationError';
    this.reason = data.reason;
    this.policy = data.policy;
    this.agentId = data.agentId;
  }
}

export interface TransactionResult {
  allowed: boolean;
  reason: string;
  policy: string;
  upstreamResponse?: unknown;
}

export class PayboundClient {
  private agentId: string;
  private proxyUrl: string;

  constructor(config: PayboundConfig) {
    this.agentId = config.agentId;
    this.proxyUrl = (config.proxy ?? 'http://localhost:4020').replace(/\/$/, '');
  }

  /**
   * Make an x402-enabled fetch through the Paybound proxy.
   * Automatically adds agent identity headers.
   */
  async fetch(url: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    headers.set('X-Paybound-Agent', this.agentId);

    return globalThis.fetch(url, {
      ...init,
      headers,
    });
  }

  /**
   * Submit a payment for verification through the Paybound proxy.
   * Throws PolicyViolationError if the payment is denied.
   */
  async verify(payment: {
    resourceUrl: string;
    amount: number | string;
    currency?: string;
    scheme?: string;
    payload?: unknown;
  }): Promise<TransactionResult> {
    const res = await globalThis.fetch(`${this.proxyUrl}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Paybound-Agent': this.agentId,
      },
      body: JSON.stringify({
        resourceUrl: payment.resourceUrl,
        amount: String(payment.amount),
        currency: payment.currency ?? 'USDC',
        scheme: payment.scheme ?? 'exact',
        ...(payment.payload ? { payload: payment.payload } : {}),
      }),
    });

    const body = await res.json();

    if (res.status === 403) {
      throw new PolicyViolationError({
        reason: body.reason ?? 'unknown',
        policy: body.policy ?? 'unknown',
        agentId: this.agentId,
      });
    }

    return {
      allowed: true,
      reason: 'within policy limits',
      policy: body.matchedPolicy ?? 'unknown',
      upstreamResponse: body,
    };
  }

  /**
   * Check proxy health.
   */
  async health(): Promise<{
    status: string;
    policies: number;
    transactions: number;
  }> {
    const res = await globalThis.fetch(`${this.proxyUrl}/health`);
    return res.json();
  }

  /**
   * Get transaction history for this agent.
   */
  async getTransactions(options?: { since?: number; limit?: number }): Promise<unknown[]> {
    const params = new URLSearchParams({ agentId: this.agentId });
    if (options?.since) params.set('since', String(options.since));
    if (options?.limit) params.set('limit', String(options.limit));

    const res = await globalThis.fetch(`${this.proxyUrl}/transactions?${params}`);
    const body = await res.json();
    return body.transactions;
  }
}
