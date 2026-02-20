/**
 * Paybound Basic Example
 *
 * Demonstrates how an AI agent uses Paybound to make
 * policy-controlled x402 payments.
 *
 * Prerequisites:
 *   1. Start the Paybound proxy: npx tsx packages/proxy/src/index.ts
 *   2. Run this example: npx tsx examples/basic.ts
 *
 * Note: This example uses a mock upstream facilitator.
 * For real x402 payments, configure PAYBOUND_UPSTREAM to point
 * to a Coinbase CDP facilitator.
 */

import { PayboundClient } from '../packages/sdk/src/index';

async function main() {
  // Create a Paybound client for your agent
  const client = new PayboundClient({
    agentId: 'research-bot',
    proxy: 'http://localhost:4020',
  });

  console.log('🔒 Paybound Basic Example\n');

  // Example 1: Make a request through Paybound
  console.log('1. Making a policy-controlled request...');
  try {
    const response = await client.fetch('https://api.example.com/data');
    console.log(`   Status: ${response.status}`);
    console.log('   ✅ Request passed policy checks\n');
  } catch (err: any) {
    console.log(`   ❌ ${err.message}\n`);
  }

  // Example 2: Check the health endpoint
  console.log('2. Checking proxy health...');
  try {
    const health = await fetch('http://localhost:4020/health');
    const data = await health.json();
    console.log('   Proxy status:', JSON.stringify(data, null, 2));
  } catch {
    console.log('   ⚠️  Proxy not running. Start it first:');
    console.log('      npx tsx packages/proxy/src/index.ts\n');
  }

  // Example 3: Query transaction history
  console.log('\n3. Querying transaction history...');
  try {
    const txs = await fetch('http://localhost:4020/transactions?agentId=research-bot');
    const data = await txs.json();
    console.log(`   Found ${data.transactions.length} transactions`);
  } catch {
    console.log('   ⚠️  Proxy not running.');
  }
}

main().catch(console.error);
