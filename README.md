# Paybound Vault (Alpha)

Agent identity + credential management infrastructure.

## Quick start

```bash
# Install and run
cd vault-api && npm install && npm start
# In another terminal:
cd paybound-cli && npm install
node cli.js orgs create "My Org"
```

## Demo

```bash
bash demo.sh
```

The demo will:
- Start the API
- Create an org and agent
- Store credentials
- Retrieve credentials
- Show audit logs
- Revoke stripe and verify access is blocked

## Health check

```bash
curl http://localhost:3001/health
```

Expected response:

```json
{"status":"ok"}
```

## Optional: 402.coffee agent-trust screen

Paybound enforces **your** policy on the agent (budgets, allowed resources). It doesn't
ask whether the paying agent itself behaves sanely — will it pay a deliberately
over-priced "scam" order, or get its recipient swapped at signing? You can optionally
screen the payer against [402.coffee](https://api.402.coffee/integrations)'s free
`/verify` before proxying an allowed payment. **Off by default.**

> **Privacy:** enabling this sends the **payer's wallet address** to 402.coffee, a third
> party, on every screened payment. Opt in deliberately.

| Env var | Default | Meaning |
|---|---|---|
| `PAYBOUND_402COFFEE_VERIFY` | *(off)* | Set truthy to enable the screen |
| `PAYBOUND_402COFFEE_MODE` | `flag` | `flag` = annotate only (adds an `X-Paybound-Agent-Trust` response header); `block` = deny failing payers |
| `PAYBOUND_402COFFEE_REQUIRE` | *(none)* | Comma list of capabilities the payer must currently hold, e.g. `scam_resistance,recipient_awareness` |
| `PAYBOUND_402COFFEE_ON_ERROR` | `deny` | When the screen is unreachable **in block mode**: `deny` = fail closed (block), `allow` = fail open. `flag` mode always fails open |
| `PAYBOUND_402COFFEE_BASE` | `https://api.402.coffee` | Override the API base |

The screen is fail-open in `flag` mode and never breaks a policy-allowed payment. In
`block` mode it fails **closed** by default (an unreachable trust check blocks rather
than silently waving payers through); set `PAYBOUND_402COFFEE_ON_ERROR=allow` to invert
that. Every fail-open/closed event on an unreachable screen is logged.
