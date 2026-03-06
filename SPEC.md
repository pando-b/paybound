# Paybound Vault — Product Specification v1

*Last updated: 2026-03-04*

---

## Product Vision

**Paybound Vault is the identity and credential infrastructure layer for AI agents.**

Agents today operate with scattered credentials, no persistent identity, and zero visibility into what they access. Paybound Vault gives agents a single front door to get their credentials — and gives the humans who deploy them full visibility and control over what those agents can access.

We are not a proxy. We are not an observability tool. We are not a guardrails product. We are the **lockbox** — the place where agent credentials live, scoped by identity, logged on every access, and revocable in an instant.

**The analogy:** Plaid became the identity and access layer between fintechs and banks. We become the identity and access layer between agents and the services they consume.

**The dual value prop:**
- **For the agent:** "You're not selling me a leash. You're selling me legs." — Persistent identity, single auth call for all credentials, faster than managing scattered env files.
- **For the human (dev/CFO/security):** Full audit trail, per-agent access control, instant revocation, zero-knowledge security — your secrets stay yours.

**Target user (alpha):** Solo developers and small teams (2-20 people) deploying AI agents. Keys scattered across projects, no spend visibility, no revocation plan. Not thinking about governance yet — but they know their `.env` file approach doesn't scale.

**What we are NOT:**
- Not SaaS (the SaaSacre is real)
- Not a payment proxy or gateway
- Not an observability platform (we're not competing with Datadog)
- Not agent guardrails (we're not competing with Bedrock)
- Not a financial institution (we never custody funds or process payments)

**Business model:** Open-core infrastructure.
- Free: self-hosted, open source core
- Paid: managed cloud hosting (usage-based), enterprise features (RBAC, SSO, fleet management), support/SLA contracts

---

## High-Level Feature Set

### Alpha (Monday, March 9)

1. **Agent Registration** — Create a persistent agent identity with scoped permissions
2. **Credential Storage** — Store encrypted credentials mapped to tool/service names
3. **Credential Retrieval** — Agent authenticates, requests credentials for a specific tool, gets them
4. **Access Logging** — Every retrieval logged: which agent, which tool, when, from where
5. **Revocation** — Instantly revoke an agent's access to any credential or all credentials
6. **Local Encrypted Backup** — Client package maintains encrypted local fallback file
7. **Offline Mode** — If cloud is unreachable, client falls back to local encrypted cache

### Post-Alpha (Backlog)

- Dashboard UI (per-agent access patterns, usage visualization)
- Spend correlation (map credential access to billing data from providers)
- Team management (multiple humans managing multiple agents)
- MCP Server (native tool discovery for MCP-compatible agents)
- Python client (`pip install paybound`)
- Policy engine (rules like "Agent 7 can only access OpenAI between 9am-5pm")
- Anomaly detection (unusual access patterns trigger alerts)
- Enterprise: self-hosted container with cloud control plane sync
- Enterprise: SSO, RBAC, audit export

---

## Architecture

### System Components

```
┌─────────────────────────────────────────────────┐
│                  Developer                       │
│  (registers agents, stores credentials via CLI)  │
└─────────────┬───────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────┐
│            Paybound Vault API                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Identity │ │ Vault    │ │ Access Log       │ │
│  │ Service  │ │ Service  │ │ Service          │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
│  ┌──────────────────────────────────────────┐   │
│  │ Encrypted Credential Store (DB)          │   │
│  └──────────────────────────────────────────┘   │
└─────────────┬───────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────┐
│         Agent Runtime (customer's infra)         │
│  ┌──────────────────────────────────────────┐   │
│  │ Paybound Client (npm / pip package)      │   │
│  │  - Authenticates with Vault API          │   │
│  │  - Retrieves credentials for tools       │   │
│  │  - Logs access asynchronously            │   │
│  │  - Maintains local encrypted cache       │   │
│  │  - Falls back to local if cloud is down  │   │
│  └──────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────┐   │
│  │ Agent (Claude, GPT, etc.)                │   │
│  │  - Calls paybound.getCredential("openai")│   │
│  │  - Gets credential, uses it directly     │   │
│  │  - Never talks to Vault API directly     │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### How It Works (Flow)

```
1. Developer: paybound init → creates org + gets API key
2. Developer: paybound agent create "agent-7" → registers agent identity
3. Developer: paybound credential store --agent agent-7 --tool openai --value sk-xxx
   → Encrypted, stored in Vault, local backup written
4. Agent runtime starts → client authenticates with agent-7's token
5. Agent needs OpenAI → client calls vault API → gets credential → agent uses it directly
6. Every retrieval is logged (agent, tool, timestamp, IP)
7. Developer: paybound credential revoke --agent agent-7 --tool openai → instant kill
```

### Data Flow (Critical: We Are NOT in the Execution Path)

```
Agent → Paybound Client → Vault API (get credential)
Agent → OpenAI directly (use credential)
         ↑
         NOT through us. We hand over the key. Agent goes direct.
```

### Encryption Model

- Credentials encrypted at rest using customer-controlled encryption key
- Vault API stores encrypted blobs — cannot read plaintext
- Client package holds (or derives) the decryption key
- Local backup file uses same encryption — portable, offline-readable
- Standalone decrypt CLI tool available if customer needs emergency access without our client

---

## Risks, Pain Points & Why We Chose This Path

### Risk 1: "Why can't the agent just bypass you?"
**Reality:** It can, if the developer gives it raw credentials. But if the developer configures the agent to use our client as its credential source, the agent uses it because it's the path of least resistance. We don't enforce — we make compliance the easiest option.

**Why we're okay with this:** 100% enforcement is impossible without being a proxy (which creates bigger problems). Detection + accountability is what actually works — same as corporate expense management for humans. The audit trail catches violations after the fact.

### Risk 2: "What if your service goes down and agents can't get credentials?"
**Solution:** The client package maintains a local encrypted cache. If the cloud API is unreachable, it falls back to the local store. The developer can also export a standalone encrypted backup at any time with a CLI decrypt tool.

**Why this is sufficient:** Agents don't go dark. Worst case = they run on cached credentials until cloud comes back. New credential registrations would wait, but active agents keep working.

### Risk 3: "I don't trust you with my secrets"
**Solution:** Zero-knowledge encryption. We store encrypted blobs. The decryption key lives with the customer (in their client config or derived from their master key). We literally cannot read the credentials.

**Why this is credible:** Same model as password managers (1Password, Bitwarden). The code is open source — customers can audit the encryption path.

### Risk 4: "This is just HashiCorp Vault with agent branding"
**Differentiators:**
- HashiCorp Vault is infrastructure for DevOps teams. We're purpose-built for AI agent workflows.
- Agent identity as a first-class concept (not just "machine identity")
- Access logging designed for agent attribution (which agent, which tool, which session)
- Client packages designed for agent runtimes (MCP integration, framework plugins)
- Open source core with managed cloud option — simpler than running Vault yourself

**The real moat:** Network effects. As more agents use Paybound identities, the identity graph becomes valuable. Agent reputation, cross-org agent authentication, agent-to-agent trust — these features only work at scale.

### Risk 5: Regulatory exposure
**Current posture:** Low risk. We are a credential management / secrets management tool. We do NOT:
- Custody funds
- Process payments
- Issue financial instruments
- Handle PII beyond what's in credentials (which we can't read anyway)

**Watch items:**
- SOC 2 compliance will be expected by larger customers (post-alpha)
- GDPR applies if EU customers store data (standard data processor obligations)
- If we ever correlate to financial spend data, we stay read-only / analytical — no money transmission

### Why NOT These Alternatives

| Approach | Why We Rejected It |
|----------|-------------------|
| **Proxy/Gateway** | Sits in the data path = security liability. Enterprises won't route payment traffic through a third party. Single point of failure. |
| **Network-level enforcement** | Too DevOps heavy. Not viable as a simple product. Requires deep infrastructure access. |
| **Credential rotation on third-party services** | Creates a proxy by another name. Depends on each service supporting programmatic key rotation. Most don't. |
| **Billing API scraping** | Only gives org-level data, not agent-level. No attribution without per-agent API keys, which customers won't restructure for us. |
| **Pure observability/telemetry** | Just a worse Datadog/Coralogix. No differentiation. Entrenched competitors. |
| **Pure governance/guardrails** | Just a worse AWS Bedrock Guardrails. Content filtering isn't our game. |
| **System prompt only** | Fragile, no cryptographic guarantee, varies by model provider. Good supplement, not a foundation. |

---

## Implementation Pattern

### Alpha Tech Stack

**API:**
- Node.js + Express (or Hono for edge-ready)
- PostgreSQL (credentials store, access logs, agent registry)
- AES-256-GCM encryption for credentials at rest
- JWT for agent authentication
- Rate limiting per agent

**Client Package (npm):**
- `paybound` — TypeScript, zero dependencies where possible
- Methods: `init()`, `getCredential(tool)`, `listTools()`, `reportUsage()`
- Built-in local encrypted cache (JSON file, same AES-256-GCM)
- Automatic cloud → local fallback
- Async access log shipping (non-blocking)

**CLI:**
- `paybound init` — create org, get API key
- `paybound agent create <name>` — register agent
- `paybound credential store --agent <name> --tool <tool> --value <secret>` — store credential
- `paybound credential revoke --agent <name> --tool <tool>` — revoke
- `paybound credential export --agent <name>` — encrypted local backup
- `paybound decrypt <file>` — standalone emergency decrypt

### API Endpoints (Alpha)

```
POST   /v1/agents                  — Register new agent
GET    /v1/agents                  — List agents
DELETE /v1/agents/:id              — Deregister agent

POST   /v1/credentials             — Store encrypted credential
GET    /v1/credentials/:agent/:tool — Retrieve credential (agent auth required)
DELETE /v1/credentials/:agent/:tool — Revoke credential

GET    /v1/audit                   — Query access logs (filtered by agent, tool, time range)

POST   /v1/auth/token              — Issue agent auth token
POST   /v1/auth/refresh            — Refresh agent token
```

### MCP Integration (Post-Alpha)

```json
{
  "name": "paybound",
  "tools": [
    {
      "name": "get_credential",
      "description": "Retrieve a stored credential for a specific tool/service",
      "parameters": {
        "tool": { "type": "string", "description": "Service name (e.g., openai, stripe)" }
      }
    },
    {
      "name": "list_available_tools",
      "description": "List all tools this agent has credentials for"
    },
    {
      "name": "report_usage",
      "description": "Report usage/spend for a tool",
      "parameters": {
        "tool": { "type": "string" },
        "amount_usd": { "type": "number" },
        "metadata": { "type": "object" }
      }
    }
  ]
}
```

---

## What Success Looks Like (Monday Alpha)

1. A developer can `npm install paybound` and register an agent in under 60 seconds
2. The agent can retrieve credentials via the client library
3. If the cloud goes down, the agent keeps working via local cache
4. The developer can see an access log of every credential retrieval
5. The developer can revoke an agent's access with one command
6. James (the AI agent) can actually use it in a live demo

---

*This spec is a living document. Built from the Paybound hackathon session between Ben, Chris, and James on March 4, 2026.*
