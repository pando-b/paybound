# Paybound — Architecture Decision Records

**Date:** February 20, 2026  
**Author:** James

---

## ADR-001: Self-Hosted vs SaaS — Go with Both (Open-Core)

### Decision
Open-source self-hosted core. Managed SaaS for the dashboard/analytics layer.

### Reasoning

**Why not SaaS-only:**
- The x402 ecosystem is crypto-native. These developers are allergic to centralized gatekeepers. A SaaS-only governance layer on top of a decentralized payment protocol would be philosophically offensive to the target market. They wouldn't use it.
- Security-conscious enterprises won't route their agent payment traffic through a third-party SaaS proxy. The proxy handles payment signatures — that's sensitive.
- Self-hosted means the proxy runs in the customer's infrastructure, next to their agents. Lower latency, no single point of failure, no trust issues.

**Why not self-hosted-only:**
- Pure open-source doesn't generate revenue.
- The dashboard, analytics, and alerting layer is where the value capture happens — and that's naturally a SaaS offering.
- Enterprises will pay for managed monitoring even when they self-host the core.

**The model (open-core):**
| Layer | Deployment | License | Revenue |
|-------|-----------|---------|---------|
| Proxy Facilitator | Self-hosted | MIT | Free |
| Policy Engine | Self-hosted | MIT | Free |
| Client SDK | npm package | MIT | Free |
| Transaction Ledger (local) | Self-hosted | MIT | Free |
| Dashboard + Analytics | SaaS | Proprietary | $99-999/mo |
| Alerting + Anomaly Detection | SaaS | Proprietary | $99-999/mo |
| Multi-org management | SaaS | Proprietary | Enterprise |

**Precedents:** PostHog, Sentry, Grafana, GitLab — all succeeded with this exact pattern. Open-source core drives adoption, hosted features drive revenue.

**Go-to-market sequence:**
1. Ship the open-source proxy + SDK → developer adoption
2. Launch free dashboard (self-hosted, basic) → stickiness
3. Launch hosted dashboard with advanced features → revenue
4. Enterprise features (SSO, audit exports, SLAs) → upmarket

---

## ADR-002: Handling the `upto` Scheme

### Decision
Design the policy engine for `upto` from day one, even though x402 only ships `exact` today.

### Reasoning

The `exact` scheme is straightforward — fixed price, binary approve/deny. But `upto` (pay up to X based on consumption, like LLM token usage) is where governance becomes *critical* and where Paybound's value explodes.

With `upto`:
- An agent could authorize "up to $100" for an LLM call and the resource server charges based on actual token consumption
- Without governance, a poorly-prompted agent could burn through budgets with a single long-running request
- The policy engine needs to reason about *potential* spend, not just *actual* spend

**Policy engine design implications:**
```yaml
# upto-aware policy
policies:
  - name: "research-bot"
    budget:
      max_per_transaction: 5.00        # hard cap even for upto
      max_authorization: 10.00          # max the agent can authorize
      max_per_hour: 50.00
    upto_rules:
      require_max_amount: true          # agent must set a ceiling
      max_ceiling_multiplier: 2.0       # ceiling can't exceed 2x expected cost
```

**Why now:** If we bake `upto` awareness into the policy schema from the start, we don't have to do a breaking migration later. The `exact` scheme is just a special case where `authorization == actual`. Cost: minimal (a few extra fields in the schema). Benefit: ready when x402 ships `upto`, which could be any time.

---

## ADR-003: Default Policy for New Agents — Restrictive with Easy Escalation

### Decision
New agents get a restrictive default policy. Developers explicitly opt into higher limits.

### Reasoning

**The security argument:** An unrestricted agent with a funded wallet is a liability. The safe default is "spend nothing until configured." This matches how every enterprise security tool works — deny by default, allow by policy.

**The adoption argument:** Developers hate friction. If the default is "block everything," the first experience is a failure, and they'll bounce.

**The resolution — "training wheels" default:**

```yaml
# Default policy applied to every new agent
default_policy:
  budget:
    max_per_transaction: 1.00     # $1 max per transaction
    max_per_hour: 10.00           # $10/hr ceiling
    max_per_day: 50.00            # $50/day ceiling
  allowed_resources: "*"          # all resources allowed
  on_violation: block_and_alert   # block + notify, don't silently fail
  alert_channel: "webhook"        # configurable (webhook, email, Slack)
```

**Why this works:**
- Developer can get started immediately — $1 transactions work out of the box
- Nothing catastrophic can happen — $50/day cap prevents wallet drainage
- The first violation is a teaching moment, not a failure — they get an alert explaining the limit and how to raise it
- Raising limits is one config change, not a support ticket

**The unlock moment:** When a developer hits the default limit and gets a clear, helpful alert that says "Your agent tried to spend $5.00 but your limit is $1.00. Here's how to update your policy" — that's when they understand why Paybound exists. The product sells itself through the constraint.

---

## ADR-004: Build Our Own Facilitator? — No, Not Now

### Decision
Do not build a custom facilitator. Use existing facilitators (Coinbase CDP, potentially Cloudflare's).

### Reasoning

**Why it's tempting:**
- Full control over the payment flow end-to-end
- Deeper integration possibilities
- Could capture facilitator fees

**Why it's wrong for now:**
- Facilitators handle blockchain interactions, gas management, settlement confirmation — that's complex, regulated, and capital-intensive infrastructure
- Coinbase already has the best facilitator, and Cloudflare just joined the x402 Foundation. We'd be competing with two of the largest infrastructure companies in the world on their core competency.
- Building a facilitator distracts from our actual value proposition: governance, not payments
- The proxy architecture means we get the integration depth we need *without* being a facilitator

**When to reconsider:**
- If facilitator APIs become a bottleneck or reliability issue
- If we need payment flow features that facilitators won't build
- If the revenue opportunity from facilitator fees justifies the infrastructure cost
- Timeline: 12-18 months minimum, only if demand signals warrant it

**The right analogy:** Stripe didn't build a bank. They built the developer experience layer on top of banking infrastructure. Paybound shouldn't build a facilitator — we should build the governance layer on top of facilitator infrastructure.

---

*These decisions are binding until explicitly revisited. Each one has a "when to reconsider" trigger.*
