# Milestone 1: Core Engine — Policy + Proxy + Ledger

**Goal:** A working proxy that intercepts x402 payment flows, evaluates them against YAML policies, and logs every transaction to SQLite.

**Success criteria:** A test agent makes an x402 payment request → Paybound proxy intercepts it → policy engine evaluates → approved transactions pass through → denied transactions return error → all transactions logged with full context.

---

## Phase 1: Project Scaffold

### Tasks:
1. Initialize TypeScript monorepo with the following packages:
   - `packages/core` — Policy engine, types, schema
   - `packages/proxy` — HTTP proxy facilitator server
   - `packages/sdk` — Client SDK (`@paybound/sdk`)
   - `packages/ledger` — Transaction ledger (SQLite)
2. Configure:
   - TypeScript (strict mode)
   - ESLint + Prettier
   - Vitest for testing
   - tsup for building
   - pnpm workspaces
3. Add `.gitignore` entries for node_modules, dist, *.db

### Acceptance:
- `pnpm install` succeeds
- `pnpm build` succeeds (even if packages are empty stubs)
- `pnpm test` runs (even with no tests yet)

---

## Phase 2: Policy Engine (`packages/core`)

### Tasks:
1. Define TypeScript types:
   - `Policy` — name, budget limits, allowed resources, violation action
   - `PolicySet` — collection of policies keyed by agent ID
   - `Transaction` — agent ID, resource URL, amount, currency, timestamp, scheme
   - `PolicyEvaluation` — result (allow/deny), reason, policy that matched
2. YAML policy loader:
   - Parse YAML policy files into `PolicySet`
   - Validate schema on load (fail fast on bad config)
   - Support hot-reload (watch file for changes)
3. Policy evaluator:
   - `evaluate(transaction: Transaction, policies: PolicySet): PolicyEvaluation`
   - Check per-transaction limit
   - Check per-hour rolling window (requires ledger query)
   - Check per-day rolling window
   - Check allowed/denied resource lists
   - Return first violation found, or allow
4. Default policy:
   - If no policy matches agent ID, apply default: $1/tx, $10/hr, $50/day, all resources allowed, block+alert on violation

### Acceptance:
- Unit tests for all policy evaluation scenarios
- YAML parsing with schema validation
- Default policy correctly applied for unknown agents

---

## Phase 3: Transaction Ledger (`packages/ledger`)

### Tasks:
1. SQLite database with `better-sqlite3`:
   - Table: `transactions` (id, agent_id, resource_url, amount, currency, scheme, timestamp, policy_result, policy_reason, raw_payload)
2. Ledger API:
   - `record(tx: Transaction, evaluation: PolicyEvaluation): void`
   - `getSpendInWindow(agentId: string, windowMs: number): number` — sum of approved amounts in rolling window
   - `getTransactions(filters: { agentId?, since?, limit? }): Transaction[]`
3. Database migrations (simple version table + SQL scripts)

### Acceptance:
- Can record and query transactions
- Rolling window queries are correct
- Database is created automatically on first run

---

## Phase 4: Proxy Facilitator (`packages/proxy`)

### Tasks:
1. HTTP server (Express or Hono) that acts as an x402 facilitator proxy:
   - Accepts POST `/verify` — intercepts verification requests
   - Accepts POST `/settle` — intercepts settlement requests
   - Proxies to upstream facilitator after policy check
2. Payment interception flow:
   - Extract agent ID from custom header (`X-Paybound-Agent`) or from payment payload
   - Extract amount, resource URL, scheme from x402 PaymentPayload
   - Call policy engine `evaluate()`
   - If allowed: proxy to upstream facilitator, record in ledger
   - If denied: return 403 with policy violation details, record in ledger
3. Configuration:
   - Upstream facilitator URL (env var or config)
   - Policy file path (env var or config)
   - Port (env var, default 4020)
4. Health endpoint: `GET /health` returns status + policy count + transaction count

### Acceptance:
- Proxy starts and accepts connections
- Approved transactions forwarded to upstream facilitator
- Denied transactions blocked with clear error message
- All transactions logged in ledger
- Health endpoint returns correct stats

---

## Phase 5: Client SDK (`packages/sdk`)

### Tasks:
1. `PayboundClient` class:
   - Constructor: `{ agentId, proxy, wallet? }`
   - `fetch(url, options?)` — wraps standard fetch, routes through Paybound proxy
   - Adds `X-Paybound-Agent` header automatically
   - Handles 403 policy violations gracefully (typed error)
2. Types exported for consumers:
   - `PayboundConfig`
   - `PolicyViolationError`
   - `TransactionResult`

### Acceptance:
- SDK can be imported and instantiated
- fetch() adds correct headers
- Policy violations are caught and typed

---

## Phase 6: Integration Test

### Tasks:
1. End-to-end test:
   - Start proxy server
   - Create test policy (agent "test-bot", $5/tx max)
   - Use SDK to make a mock x402 payment under limit → should succeed
   - Make a payment over limit → should be denied
   - Query ledger → both transactions recorded
2. Docker compose (optional, nice-to-have):
   - Proxy + mock upstream facilitator

### Acceptance:
- Full flow works end-to-end
- Policy enforcement is correct
- Ledger contains accurate records

---

## Tech Stack Summary
- **Language:** TypeScript (strict)
- **Monorepo:** pnpm workspaces
- **Build:** tsup
- **Test:** Vitest
- **HTTP:** Hono (lightweight, fast, x402 ecosystem uses it)
- **Database:** better-sqlite3
- **Config:** YAML (js-yaml)
- **Schema validation:** Zod
