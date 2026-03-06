# Paybound Vault — Product Brief (for Chris)

*Last updated: March 6, 2026*

---

## What Is It

Paybound Vault is the credential infrastructure layer for AI agents. It stores encrypted API keys, scopes access per agent, logs every retrieval, and uses single-use tokens so stolen credentials are worthless.

**One-liner:** "HashiCorp Vault meets Plaid — but for AI agents."

**Positioning:** We are NOT a proxy, NOT in the payment/data path. We hand the agent its credential, the agent talks to services directly. We're the lockbox, not the middleman.

---

## What's Built (Alpha — as of March 6)

### Components

| Component | Location | Description |
|-----------|----------|-------------|
| **Vault API** | `vault-api/src/server.js` | Hono + SQLite + AES-256-GCM. 280 lines. |
| **CLI** | `paybound-cli/cli.js` | Admin CLI for orgs, agents, credentials, audit |
| **Client SDK** | `paybound-client/src/index.ts` | TypeScript SDK with local encrypted cache fallback |
| **Dashboard** | `dashboard/index.html` | Admin web UI (843 lines, self-contained HTML) |
| **Demo Dashboard** | `dashboard.html` | Static demo visualization (token chain + audit) |
| **Landing Page** | `docs/index.html` | Live at paybound.dev, email waitlist capture |
| **Demo Script** | `demo.sh` | End-to-end CLI demo, runs in ~10 seconds |

### Tech Stack
- **Runtime:** Node.js
- **Framework:** Hono (lightweight, edge-ready)
- **Database:** SQLite via better-sqlite3 (swap to Postgres for production)
- **Encryption:** AES-256-GCM with HMAC-derived per-org keys
- **Auth:** JWT (single-use tokens), SHA-256 token hashing
- **CORS:** Enabled for dashboard cross-origin requests

---

## Database Schema

```sql
-- Organizations
CREATE TABLE orgs (
  id TEXT PRIMARY KEY,           -- UUID
  name TEXT,
  api_key TEXT UNIQUE,           -- 48-char hex, used for admin auth
  created_at INTEGER             -- epoch ms
);

-- Agents (one org has many agents)
CREATE TABLE agents (
  id TEXT PRIMARY KEY,           -- UUID
  org_id TEXT,                   -- FK to orgs
  name TEXT,
  token_hash TEXT,               -- SHA-256 hash of current JWT
  created_at INTEGER
);

-- Credentials (one agent has many tool credentials)
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  agent_id TEXT,
  tool TEXT,                     -- e.g., "openai", "stripe", "github"
  encrypted_value TEXT,          -- AES-256-GCM encrypted, base64 encoded
  created_at INTEGER,
  UNIQUE(org_id, agent_id, tool)
);

-- Audit log (every retrieval and revocation)
CREATE TABLE access_log (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  agent_id TEXT,
  tool TEXT,
  ip TEXT,
  ts INTEGER,                    -- epoch ms
  action TEXT,                   -- "retrieve" | "revoke"
  token_seq INTEGER              -- which token in the chain was used
);

-- Single-use token registry
CREATE TABLE tokens (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  agent_id TEXT,
  token_hash TEXT UNIQUE,        -- SHA-256 hash
  seq INTEGER,                   -- sequence number (1, 2, 3, ...)
  used INTEGER DEFAULT 0,        -- 0 = active, 1 = spent
  created_at INTEGER
);
```

---

## API Routes

All routes are under `/v1`. Two auth modes:
- **Admin auth:** `X-API-Key: <org_api_key>` header — for org management
- **Agent auth:** `Authorization: Bearer <agent_token>` header — for credential retrieval

### Health
```
GET /health
→ { "status": "ok" }
```

### Organizations (no auth required for create)
```
POST /v1/orgs
Body: { "name": "Acme Corp" }
→ { "id": "uuid", "name": "Acme Corp", "api_key": "48char_hex" }
```

### Agents (admin auth: X-API-Key)
```
POST /v1/agents
Body: { "name": "agent-7" }
→ { "id": "uuid", "name": "agent-7", "token": "jwt...", "token_seq": 1 }

GET /v1/agents
→ { "agents": [{ "id": "uuid", "name": "agent-7", "created_at": 1772828193 }] }

DELETE /v1/agents/:id
→ { "ok": true }
```

### Credentials

**Store credential (admin auth: X-API-Key):**
```
POST /v1/credentials
Body: { "agent_id": "uuid", "tool": "openai", "value": "sk-xxx" }
→ { "ok": true }
# Value is AES-256-GCM encrypted at rest. Upserts on (org_id, agent_id, tool).
```

**Retrieve credential (agent auth: Bearer token) — THIS IS THE KEY ENDPOINT:**
```
GET /v1/credentials/:tool
Headers: Authorization: Bearer <single_use_token>
→ {
    "tool": "openai",
    "value": "sk-xxx",              # Decrypted just-in-time
    "next_token": "new_jwt...",      # ← NEW single-use token
    "token_seq": 2                   # ← Incremented sequence number
  }
# The token used in this request is NOW DEAD. Only next_token works.
# If you replay the old token → 401 Unauthorized.
```

**Revoke credential (admin auth: X-API-Key):**
```
DELETE /v1/credentials/:agent_id/:tool
→ { "ok": true }
# Logged in audit as action: "revoke"
```

### Audit Log (admin auth: X-API-Key)
```
GET /v1/audit?agent_id=uuid&tool=openai&limit=50
→ {
    "audit": [
      {
        "id": "uuid",
        "org_id": "uuid",
        "agent_id": "uuid",
        "tool": "openai",
        "ip": "127.0.0.1",
        "ts": 1772828194,
        "action": "retrieve",
        "token_seq": 1
      }
    ]
  }
```

---

## Single-Use Token Chain — How It Works

This is the core innovation. Every token is valid for exactly ONE request.

```
1. Agent registers     → gets Token #1 (seq=1)
2. Agent retrieves     → sends Token #1, gets credential + Token #2 (seq=2)
                          Token #1 is now DEAD
3. Agent retrieves     → sends Token #2, gets credential + Token #3 (seq=3)
                          Token #2 is now DEAD
4. Attacker replays    → sends Token #1 again → 401 Unauthorized
                          Token was already marked used=1 in DB
```

**Token JWT payload:**
```json
{
  "agent_id": "uuid",
  "org_id": "uuid",
  "seq": 1,
  "single_use": true,
  "iat": 1772828193,
  "exp": 1772831793    // 1 hour expiry (safety net, but single-use is primary control)
}
```

**Why this matters:**
- `token_seq` in the audit log = exact action count per agent
- Gap detection: seq 1, 2, 3 → 47 means something happened outside the vault
- Replay impossible: token is marked `used=1` the instant it's validated
- Observability is free: auth frequency = API usage signal

---

## Encryption Model

```
Master Key (env var: VAULT_MASTER_KEY)
  ↓ HMAC-SHA256(master_key, org_id)
Per-Org Key (32 bytes, derived deterministically)
  ↓ AES-256-GCM(per_org_key, random_iv)
Encrypted Credential (stored as base64: iv + auth_tag + ciphertext)
```

- Vault stores encrypted blobs — cannot read plaintext without the master key
- Each org gets a unique derived key (org compromise doesn't affect other orgs)
- IV is random per encryption (same plaintext → different ciphertext)
- Auth tag prevents tampering

---

## Demo Workflow (what the demo.sh does)

```bash
# 1. Start the vault API
cd vault-api && VAULT_MASTER_KEY="key" VAULT_JWT_SECRET="secret" node src/server.js

# 2. Create an organization
curl -X POST http://localhost:3001/v1/orgs \
  -H "Content-Type: application/json" \
  -d '{"name": "Acme Corp"}'
# → returns api_key

# 3. Register an agent
curl -X POST http://localhost:3001/v1/agents \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <api_key>" \
  -d '{"name": "agent-7"}'
# → returns agent id + first single-use token (seq=1)

# 4. Store credentials for the agent
curl -X POST http://localhost:3001/v1/credentials \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <api_key>" \
  -d '{"agent_id": "<agent_id>", "tool": "openai", "value": "sk-xxx"}'

# 5. Agent retrieves credential (uses token, gets new one)
curl http://localhost:3001/v1/credentials/openai \
  -H "Authorization: Bearer <token_seq_1>"
# → { "tool": "openai", "value": "sk-xxx", "next_token": "...", "token_seq": 2 }
# Token #1 is now DEAD

# 6. Check audit log
curl http://localhost:3001/v1/audit \
  -H "X-API-Key: <api_key>"
# → shows retrieve action with token_seq: 1

# 7. Revoke a credential
curl -X DELETE http://localhost:3001/v1/credentials/<agent_id>/openai \
  -H "X-API-Key: <api_key>"
# → { "ok": true }

# 8. Agent tries to retrieve revoked credential → 403

# 9. Replay old token → 401 Unauthorized
```

---

## URL Structure (agreed with Chris)

| Service | URL | Status |
|---------|-----|--------|
| Marketing site | paybound.dev | ✅ LIVE |
| Vault API | api.paybound.dev/v1 | 🔲 Deploy this weekend |
| Admin dashboard | app.paybound.dev | 🔲 Deploy this weekend |

---

## What's Coming (Monday Beta Target)

| Feature | Owner | Status |
|---------|-------|--------|
| MCP Server | James | 🔲 Starting tonight |
| npm package (`paybound`) | James | 🔲 This weekend |
| n8n custom node | James | 🔲 This weekend |
| Rails implementation | Chris | 🔲 Chris building |
| API deployed to api.paybound.dev | James | 🔲 This weekend |
| Dashboard deployed to app.paybound.dev | James | 🔲 This weekend |
| Credential scoping (permission tiers) | TBD | 🔲 Post-beta |
| Team/RBAC | TBD | 🔲 Post-beta |

---

## Running Locally

```bash
git clone git@github.com:pando-b/paybound.git
cd paybound

# Install deps
cd vault-api && npm install && cd ..
cd paybound-cli && npm install && cd ..

# Run the full demo
bash demo.sh

# Or start API manually
cd vault-api
VAULT_MASTER_KEY="your-key" VAULT_JWT_SECRET="your-secret" node src/server.js

# Dashboard (separate terminal)
cd dashboard && python3 -m http.server 8890
# Open http://localhost:8890
```

---

## Key Design Decisions (from our March 4 + March 6 sessions)

1. **NOT a proxy** — we don't sit in the data/payment path (Chris killed this approach, correctly)
2. **NOT enforcement** — we can't force agents to use us, so we make it the path of least resistance
3. **Open-core** — MIT licensed core, paid cloud/enterprise tier
4. **Single-use tokens** — Chris's idea, turned auth into observability
5. **Self-hostable** — secrets never leave the customer's network unless they choose cloud
6. **x402 is dropped** — we target ALL AI developers, not just x402 ecosystem

---

*Chris — match this API contract in Rails and both backends will work with the same MCP server, npm package, and dashboard. Let's ship Monday. 🦬🤖*
