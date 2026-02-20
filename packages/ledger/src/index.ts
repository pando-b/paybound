import Database from 'better-sqlite3';

export interface LedgerTransaction {
  id?: number;
  agentId: string;
  resourceUrl: string;
  amount: number;
  currency: string;
  scheme: string;
  timestamp: number; // epoch ms
  policyResult: 'allow' | 'deny';
  policyReason: string;
  matchedPolicy: string;
}

export interface TransactionFilters {
  agentId?: string;
  since?: number; // epoch ms
  limit?: number;
}

export class Ledger {
  private db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        resource_url TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        scheme TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        policy_result TEXT NOT NULL,
        policy_reason TEXT NOT NULL,
        matched_policy TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_timestamp ON transactions(agent_id, timestamp);
    `);
  }

  /**
   * Record a transaction with its policy evaluation result.
   */
  record(tx: LedgerTransaction): void {
    const stmt = this.db.prepare(`
      INSERT INTO transactions (agent_id, resource_url, amount, currency, scheme, timestamp, policy_result, policy_reason, matched_policy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      tx.agentId,
      tx.resourceUrl,
      tx.amount,
      tx.currency,
      tx.scheme,
      tx.timestamp,
      tx.policyResult,
      tx.policyReason,
      tx.matchedPolicy,
    );
  }

  /**
   * Get total approved spend for an agent within a rolling time window.
   * Used by the policy engine for per-hour/per-day limit checks.
   */
  getSpendInWindow(agentId: string, windowMs: number): number {
    const cutoff = Date.now() - windowMs;
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM transactions
      WHERE agent_id = ? AND timestamp >= ? AND policy_result = 'allow'
    `);
    const row = stmt.get(agentId, cutoff) as { total: number };
    return row.total;
  }

  /**
   * Query transactions with optional filters.
   */
  getTransactions(filters: TransactionFilters = {}): LedgerTransaction[] {
    let sql = 'SELECT * FROM transactions WHERE 1=1';
    const params: unknown[] = [];

    if (filters.agentId) {
      sql += ' AND agent_id = ?';
      params.push(filters.agentId);
    }
    if (filters.since) {
      sql += ' AND timestamp >= ?';
      params.push(filters.since);
    }
    sql += ' ORDER BY timestamp DESC';
    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      id: number;
      agent_id: string;
      resource_url: string;
      amount: number;
      currency: string;
      scheme: string;
      timestamp: number;
      policy_result: string;
      policy_reason: string;
      matched_policy: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      agentId: r.agent_id,
      resourceUrl: r.resource_url,
      amount: r.amount,
      currency: r.currency,
      scheme: r.scheme,
      timestamp: r.timestamp,
      policyResult: r.policy_result as 'allow' | 'deny',
      policyReason: r.policy_reason,
      matchedPolicy: r.matched_policy,
    }));
  }

  /**
   * Get transaction count and total volume.
   */
  getStats(): { count: number; totalVolume: number; agents: number } {
    const row = this.db.prepare(`
      SELECT 
        COUNT(*) as count, 
        COALESCE(SUM(amount), 0) as totalVolume,
        COUNT(DISTINCT agent_id) as agents
      FROM transactions
    `).get() as { count: number; totalVolume: number; agents: number };
    return row;
  }

  close(): void {
    this.db.close();
  }
}
