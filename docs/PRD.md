# Paybound — Product Requirements Document

**Version:** 0.1  
**Date:** February 20, 2026  
**Author:** James (Chief of Staff) for Paybound Team  
**Status:** Draft — Awaiting Ben's review

---

## Vision

Paybound is the financial governance layer for autonomous AI agents. When AI agents spend real money via protocols like x402, Paybound ensures they spend within policy — with budgets, approvals, audit trails, and circuit breakers.

**One-liner:** "Spending controls for AI agents."

## Problem

x402 enables AI agents to make instant payments on the internet. But there is zero infrastructure for controlling *how much* they spend, *on what*, or *who approved it*. Today, giving an AI agent a wallet is like giving an intern a corporate credit card with no limit and no expense reports.

As agent commerce scales ($24M+ already flowing through x402), enterprises need:
- Budget enforcement per agent, per team, per time window
- Audit trails for compliance and cost attribution
- Circuit breakers to prevent runaway spending
- Human-in-the-loop approval for high-value transactions

Nobody is building this. Paybound is.

## Target Users

### Primary: Engineering Teams Deploying AI Agents
- Building agents that interact with paid APIs via x402
- Need programmatic spending controls
- Want a simple SDK that wraps existing x402 flows

### Secondary: CFOs / Finance Teams
- Need visibility into agent spending across the org
- Want dashboards, alerts, and budget management
- Require audit trails for compliance

### Tertiary: CISOs / Security Teams
- Concerned about wallet security and unauthorized spending
- Need anomaly detection and automatic freezes
- Want role-based access to spending capabilities

## Core Features (MVP)

### 1. Policy Engine
- Define spending policies as code (YAML/JSON)
- Per-agent budget limits (total, per-transaction, per-time-window)
- Allow/deny lists for resource servers
- Configurable actions on policy violation: block, alert, log-only

```yaml
# Example policy
policies:
  - name: "agent-research-bot"
    budget:
      max_per_transaction: 5.00
      max_per_hour: 50.00
      max_per_day: 200.00
    allowed_resources:
      - "api.openai.com"
      - "api.anthropic.com"
    on_violation: block
```

### 2. Proxy Facilitator
- Sits between x402 client and facilitator
- Intercepts PAYMENT-SIGNATURE before settlement
- Enforces policies in real-time
- Transparent to both client and resource server
- Supports multiple upstream facilitators

### 3. Transaction Ledger
- Every transaction logged with full context
- Agent ID, resource server, amount, timestamp, policy evaluation result
- Queryable via API
- Exportable for accounting/compliance

### 4. Client SDK
- TypeScript first (matches x402 ecosystem)
- Drop-in replacement for `@x402/fetch`
- Adds agent identity and policy context to requests

```typescript
import { PayboundClient } from '@paybound/sdk';

const client = new PayboundClient({
  agentId: 'research-bot-1',
  policyServer: 'https://paybound.example.com',
});

// Works exactly like @x402/fetch, but with governance
const response = await client.fetch('https://api.weather.com/forecast');
```

### 5. Dashboard (Post-MVP)
- Real-time spend visibility across all agents
- Budget utilization gauges
- Transaction history with filtering
- Alerts and anomaly detection
- Team/project cost attribution

## Architecture Overview

```
┌─────────┐     ┌──────────────┐     ┌─────────────┐     ┌────────────┐
│  Agent   │────▶│   Paybound   │────▶│ Facilitator  │────▶│ Blockchain │
│ (Client) │     │    Proxy     │     │  (Coinbase)  │     │            │
└─────────┘     └──────┬───────┘     └─────────────┘     └────────────┘
                       │
                ┌──────▼───────┐
                │   Policy     │
                │   Engine     │
                ├──────────────┤
                │  Transaction │
                │   Ledger     │
                ├──────────────┤
                │   Dashboard  │
                │   (API)      │
                └──────────────┘
```

## Tech Stack

- **Runtime:** Node.js / TypeScript
- **Policy Engine:** Custom, YAML/JSON config
- **Database:** SQLite (MVP) → PostgreSQL (scale)
- **API:** Express or Hono
- **SDK:** TypeScript, published to npm as `@paybound/sdk`
- **Deployment:** Docker → Vercel/Railway

## Success Metrics

| Metric | Target (90 days) |
|--------|-----------------|
| Working proxy facilitator | ✅ Functional |
| SDK published on npm | ✅ Published |
| Transactions processed in testnet | 1,000+ |
| Policy violations caught | Demonstrated |
| Beta users (developers) | 5-10 |
| GitHub stars | 100+ |

## Revenue Model (Future)

| Tier | Price | Features |
|------|-------|----------|
| **Open Source** | Free | Proxy + SDK + basic policies |
| **Pro** | $99/mo | Dashboard, alerts, analytics |
| **Enterprise** | $999/mo+ | SSO, audit exports, SLAs, custom policies |

Open-source core drives adoption. Dashboard/analytics drives revenue.

## Non-Goals (MVP)

- Fiat payment support (x402 is crypto-first)
- Multi-chain optimization (start with Base/EVM)
- Mobile SDK
- Custom facilitator (use existing ones)

## Key Decisions (see docs/architecture/decisions.md for full reasoning)

1. **Open-core model** — Self-hosted proxy + SDK (MIT). SaaS dashboard + analytics (proprietary). Follows PostHog/Sentry/Grafana playbook.
2. **Design for `upto` from day one** — Policy schema supports both `exact` and `upto` schemes even though x402 only ships `exact` today. Prevents breaking migration later.
3. **Restrictive defaults with easy escalation** — New agents get $1/tx, $10/hr, $50/day limits. First violation = helpful alert that teaches why Paybound exists. The product sells itself through the constraint.
4. **No custom facilitator** — Use Coinbase/Cloudflare facilitators. We're the governance layer, not the payment rail. Stripe didn't build a bank.

---

*This PRD is the source of truth for Paybound development. All implementation work references this document.*
