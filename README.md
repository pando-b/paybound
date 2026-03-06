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
