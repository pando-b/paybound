#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
API_URL="http://localhost:3001"
MASTER_KEY="demo-master-key"
JWT_SECRET="demo-jwt-secret"

# Remove stale DB
rm -f "$ROOT_DIR/vault-api/vault.db"

echo "🚀 Starting Paybound Vault API..."
cd "$ROOT_DIR/vault-api"
VAULT_MASTER_KEY="$MASTER_KEY" VAULT_JWT_SECRET="$JWT_SECRET" node src/server.js >/tmp/paybound-vault-api.log 2>&1 &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Wait for server
for i in $(seq 1 30); do
  if curl -s "$API_URL/health" | grep -q '"ok"'; then
    echo "✅ Server healthy"
    break
  fi
  sleep 0.3
  if [ "$i" -eq 30 ]; then
    echo "❌ Server failed to start. Logs:"
    cat /tmp/paybound-vault-api.log
    exit 1
  fi
done

cd "$ROOT_DIR/paybound-cli"

echo ""
echo "📦 Step 1: Create org 'Acme Corp'"
ORG_JSON=$(node cli.js orgs create "Acme Corp" --api-url "$API_URL")
echo "$ORG_JSON"
API_KEY=$(echo "$ORG_JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).api_key))")

echo ""
echo "🤖 Step 2: Register agent 'agent-7'"
AGENT_JSON=$(node cli.js agents create "agent-7" --api-key "$API_KEY" --api-url "$API_URL")
echo "$AGENT_JSON"
AGENT_ID=$(echo "$AGENT_JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")
AGENT_TOKEN=$(echo "$AGENT_JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).token))")
STOLEN_TOKEN="$AGENT_TOKEN"  # Save token #1 for replay attack demo

echo ""
echo "🔐 Step 3: Store credentials (openai, stripe, github)"
node cli.js credential store openai "sk-openai-test-123" --agent-id "$AGENT_ID" --api-key "$API_KEY" --api-url "$API_URL" > /dev/null
node cli.js credential store stripe "sk-stripe-test-456" --agent-id "$AGENT_ID" --api-key "$API_KEY" --api-url "$API_URL" > /dev/null
node cli.js credential store github "ghp-github-test-789" --agent-id "$AGENT_ID" --api-key "$API_KEY" --api-url "$API_URL" > /dev/null
echo '{"ok":true} × 3'

echo ""
echo "🔑 Step 4: Agent retrieves credentials (single-use token chain)"
echo "  openai (token seq 1):"
OPENAI_RESP=$(curl -s "$API_URL/v1/credentials/openai" -H "Authorization: Bearer $AGENT_TOKEN")
echo "$OPENAI_RESP"
AGENT_TOKEN=$(echo "$OPENAI_RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).next_token))")
echo "  → token rotated to seq 2"

echo "  stripe (token seq 2):"
STRIPE_RESP=$(curl -s "$API_URL/v1/credentials/stripe" -H "Authorization: Bearer $AGENT_TOKEN")
echo "$STRIPE_RESP"
AGENT_TOKEN=$(echo "$STRIPE_RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).next_token))")
echo "  → token rotated to seq 3"

echo "  github (token seq 3):"
GITHUB_RESP=$(curl -s "$API_URL/v1/credentials/github" -H "Authorization: Bearer $AGENT_TOKEN")
echo "$GITHUB_RESP"
AGENT_TOKEN=$(echo "$GITHUB_RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).next_token))")
echo "  → token rotated to seq 4"

echo ""
echo "📋 Step 5: Audit log (3 retrievals)"
node cli.js audit --api-key "$API_KEY" --api-url "$API_URL"

echo ""
echo "🚫 Step 6: Revoke stripe access"
node cli.js credential revoke "$AGENT_ID" stripe --api-key "$API_KEY" --api-url "$API_URL"

echo ""
echo "🔒 Step 7: Try to retrieve stripe (should fail — revoked)"
BLOCKED_RESP=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/v1/credentials/stripe" -H "Authorization: Bearer $AGENT_TOKEN")
if [ "$BLOCKED_RESP" = "403" ]; then
  echo "✅ Stripe access blocked — 403 Forbidden (token seq $((4)) spent, credential revoked)"
else
  echo "❌ Expected 403 but got $BLOCKED_RESP"
fi

echo ""
echo "🕵️ Step 8: Replay attack — try to reuse token #1 (already spent)"
REPLAY_RESP=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/v1/credentials/openai" -H "Authorization: Bearer $STOLEN_TOKEN")
if [ "$REPLAY_RESP" = "401" ]; then
  echo "✅ Replay blocked — 401 Unauthorized. Stolen token #1 is dead."
else
  echo "❌ Expected 401 but got $REPLAY_RESP"
fi

echo ""
echo "📋 Step 9: Full audit log (shows token sequence chain)"
node cli.js audit --api-key "$API_KEY" --api-url "$API_URL"

echo ""
echo "✅ Demo complete! Paybound Vault — single-use token chain working."
