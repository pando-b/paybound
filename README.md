# Paybound

**Spending controls for AI agents.**

Paybound is the financial governance layer for autonomous AI agents making real payments via [x402](https://x402.org) and other payment protocols. Budgets, policies, audit trails, and circuit breakers — so your agents spend within bounds.

## Why

AI agents are starting to spend real money. The [x402 protocol](https://github.com/coinbase/x402) enables instant, programmatic payments on the internet. But there's no infrastructure for controlling *how much* agents spend, *on what*, or *who approved it*.

Paybound fixes that.

## How It Works

```
Agent → Paybound Proxy → Facilitator → Blockchain
         ↓
    Policy Engine
    (budgets, limits, approvals)
         ↓
    Transaction Ledger
    (audit trail, analytics)
```

1. Your agent makes an x402 payment request
2. Paybound intercepts it and evaluates against your policies
3. If approved, the payment flows through to the facilitator
4. Every transaction is logged for audit and analytics

## Quick Start

```bash
npm install @paybound/sdk
```

```typescript
import { PayboundClient } from '@paybound/sdk';

const client = new PayboundClient({
  agentId: 'my-agent',
  proxy: 'http://localhost:4020',
});

const response = await client.fetch('https://api.example.com/data');
```

## Features

- **Policy Engine** — Define spending limits per agent, per team, per time window
- **Proxy Facilitator** — Transparent interception of x402 payment flows
- **Transaction Ledger** — Full audit trail with cost attribution
- **Client SDK** — Drop-in replacement for `@x402/fetch`
- **Circuit Breakers** — Automatic spend freezes on anomalies

## Policy Example

```yaml
policies:
  - name: "research-bot"
    budget:
      max_per_transaction: 5.00
      max_per_hour: 50.00
      max_per_day: 200.00
    allowed_resources:
      - "api.openai.com"
      - "api.anthropic.com"
    on_violation: block
```

## Project Status

🚧 **Pre-alpha** — Architecture and specs phase. Not yet functional.

## Legal

Paybound is policy enforcement and audit software. It does not custody, transmit, or control funds. All payment settlement is handled by third-party facilitators (e.g., Coinbase CDP). Paybound is not a money transmitter, payment processor, or financial institution. This software is provided as-is. Consult qualified legal counsel before deploying in production.

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## License

MIT
