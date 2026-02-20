import { describe, it, expect, beforeEach } from 'vitest';
import { Ledger, LedgerTransaction } from '../src/index';

describe('Ledger', () => {
  let ledger: Ledger;

  beforeEach(() => {
    ledger = new Ledger(':memory:');
  });

  const baseTx: LedgerTransaction = {
    agentId: 'bot-1',
    resourceUrl: 'https://api.example.com/data',
    amount: 2.5,
    currency: 'USDC',
    scheme: 'exact',
    timestamp: Date.now(),
    policyResult: 'allow',
    policyReason: 'within limits',
    matchedPolicy: 'default',
  };

  it('records and retrieves transactions', () => {
    ledger.record(baseTx);
    const txs = ledger.getTransactions();
    expect(txs).toHaveLength(1);
    expect(txs[0].agentId).toBe('bot-1');
    expect(txs[0].amount).toBe(2.5);
  });

  it('filters by agentId', () => {
    ledger.record(baseTx);
    ledger.record({ ...baseTx, agentId: 'bot-2', amount: 1 });
    const txs = ledger.getTransactions({ agentId: 'bot-1' });
    expect(txs).toHaveLength(1);
    expect(txs[0].agentId).toBe('bot-1');
  });

  it('filters by since', () => {
    const old = Date.now() - 100_000;
    ledger.record({ ...baseTx, timestamp: old });
    ledger.record({ ...baseTx, timestamp: Date.now() });
    const txs = ledger.getTransactions({ since: Date.now() - 1000 });
    expect(txs).toHaveLength(1);
  });

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) {
      ledger.record({ ...baseTx, timestamp: Date.now() + i });
    }
    const txs = ledger.getTransactions({ limit: 3 });
    expect(txs).toHaveLength(3);
  });

  it('calculates spend in window correctly', () => {
    const now = Date.now();
    // 3 allowed transactions
    ledger.record({ ...baseTx, amount: 5, timestamp: now - 1000 });
    ledger.record({ ...baseTx, amount: 3, timestamp: now - 2000 });
    ledger.record({ ...baseTx, amount: 2, timestamp: now - 3000 });
    // 1 denied transaction (should not count)
    ledger.record({ ...baseTx, amount: 100, timestamp: now - 500, policyResult: 'deny' });
    // 1 old transaction outside window
    ledger.record({ ...baseTx, amount: 50, timestamp: now - 200_000 });

    const spend = ledger.getSpendInWindow('bot-1', 60_000); // 1 minute window
    expect(spend).toBe(10); // 5 + 3 + 2
  });

  it('returns zero for empty window', () => {
    const spend = ledger.getSpendInWindow('nonexistent', 60_000);
    expect(spend).toBe(0);
  });

  it('returns correct stats', () => {
    ledger.record(baseTx);
    ledger.record({ ...baseTx, agentId: 'bot-2', amount: 7.5 });
    const stats = ledger.getStats();
    expect(stats.count).toBe(2);
    expect(stats.totalVolume).toBe(10);
    expect(stats.agents).toBe(2);
  });
});
