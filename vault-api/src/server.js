import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const MASTER_KEY = process.env.VAULT_MASTER_KEY || 'dev-master-key';
const JWT_SECRET = process.env.VAULT_JWT_SECRET || 'dev-jwt-secret';

const dbPath = path.join(process.cwd(), 'vault.db');
const db = new Database(dbPath);

const initSql = `
CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  name TEXT,
  api_key TEXT UNIQUE,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  name TEXT,
  token_hash TEXT,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  agent_id TEXT,
  tool TEXT,
  encrypted_value TEXT,
  created_at INTEGER,
  UNIQUE(org_id, agent_id, tool)
);
CREATE TABLE IF NOT EXISTS access_log (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  agent_id TEXT,
  tool TEXT,
  ip TEXT,
  ts INTEGER,
  action TEXT,
  token_seq INTEGER
);
CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  agent_id TEXT,
  token_hash TEXT UNIQUE,
  seq INTEGER,
  used INTEGER DEFAULT 0,
  created_at INTEGER
);
`;

db.exec(initSql);

const app = new Hono();

function now() {
  return Date.now();
}

function uuid() {
  return crypto.randomUUID();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function deriveOrgKey(orgId) {
  return crypto.createHmac('sha256', MASTER_KEY).update(orgId).digest();
}

function encryptValue(orgId, plaintext) {
  const key = deriveOrgKey(orgId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

function decryptValue(orgId, payload) {
  const data = Buffer.from(payload, 'base64');
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);
  const key = deriveOrgKey(orgId);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

function getIp(c) {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const raw = c.req.raw;
  return raw?.socket?.remoteAddress || 'unknown';
}

function adminAuth(c) {
  const apiKey = c.req.header('x-api-key');
  if (!apiKey) return null;
  const row = db.prepare('SELECT * FROM orgs WHERE api_key = ?').get(apiKey);
  return row || null;
}

function agentAuth(c) {
  const auth = c.req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(payload.agent_id);
    if (!agent) return null;
    if (agent.org_id !== payload.org_id) return null;
    // Single-use token validation
    const tHash = hashToken(token);
    const tokenRow = db.prepare('SELECT * FROM tokens WHERE token_hash = ? AND agent_id = ? AND used = 0').get(tHash, agent.id);
    if (!tokenRow) return null;
    // Mark token as used immediately (single-use)
    db.prepare('UPDATE tokens SET used = 1 WHERE id = ?').run(tokenRow.id);
    return { agent, org_id: agent.org_id, token, seq: tokenRow.seq };
  } catch {
    return null;
  }
}

function logAccess({ org_id, agent_id, tool, ip, action, token_seq }) {
  db.prepare(
    'INSERT INTO access_log (id, org_id, agent_id, tool, ip, ts, action, token_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(uuid(), org_id, agent_id, tool, ip, now(), action, token_seq || null);
}

app.get('/health', (c) => c.json({ status: 'ok' }));

app.post('/v1/orgs', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = body.name?.toString().trim();
  if (!name) return c.json({ error: 'name required' }, 400);
  const id = uuid();
  const apiKey = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO orgs (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run(id, name, apiKey, now());
  return c.json({ id, name, api_key: apiKey });
});

function issueToken(agentId, orgId, seq) {
  const token = jwt.sign({ agent_id: agentId, org_id: orgId, seq, single_use: true }, JWT_SECRET, { expiresIn: '1h' });
  db.prepare('INSERT INTO tokens (id, org_id, agent_id, token_hash, seq, used, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
    .run(uuid(), orgId, agentId, hashToken(token), seq, now());
  return token;
}

app.post('/v1/agents', async (c) => {
  const org = adminAuth(c);
  if (!org) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json().catch(() => ({}));
  const name = body.name?.toString().trim();
  if (!name) return c.json({ error: 'name required' }, 400);
  const id = uuid();
  const token = issueToken(id, org.id, 1);
  db.prepare('INSERT INTO agents (id, org_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, org.id, name, hashToken(token), now());
  return c.json({ id, name, token, token_seq: 1 });
});

app.get('/v1/agents', (c) => {
  const org = adminAuth(c);
  if (!org) return c.json({ error: 'unauthorized' }, 401);
  const rows = db.prepare('SELECT id, name, created_at FROM agents WHERE org_id = ? ORDER BY created_at DESC').all(org.id);
  return c.json({ agents: rows });
});

app.delete('/v1/agents/:id', (c) => {
  const org = adminAuth(c);
  if (!org) return c.json({ error: 'unauthorized' }, 401);
  const id = c.req.param('id');
  db.prepare('DELETE FROM agents WHERE id = ? AND org_id = ?').run(id, org.id);
  db.prepare('DELETE FROM credentials WHERE agent_id = ? AND org_id = ?').run(id, org.id);
  return c.json({ ok: true });
});

app.post('/v1/credentials', async (c) => {
  const org = adminAuth(c);
  if (!org) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json().catch(() => ({}));
  const agentId = body.agent_id?.toString();
  const tool = body.tool?.toString();
  const value = body.value?.toString();
  if (!agentId || !tool || !value) return c.json({ error: 'agent_id, tool, value required' }, 400);
  const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND org_id = ?').get(agentId, org.id);
  if (!agent) return c.json({ error: 'agent not found' }, 404);
  const encrypted = encryptValue(org.id, value);
  const id = uuid();
  db.prepare(
    'INSERT INTO credentials (id, org_id, agent_id, tool, encrypted_value, created_at) VALUES (?, ?, ?, ?, ?, ?) '
    + 'ON CONFLICT(org_id, agent_id, tool) DO UPDATE SET encrypted_value = excluded.encrypted_value, created_at = excluded.created_at'
  ).run(id, org.id, agentId, tool, encrypted, now());
  return c.json({ ok: true });
});

app.get('/v1/credentials/:tool', (c) => {
  const auth = agentAuth(c);
  if (!auth) return c.json({ error: 'unauthorized' }, 401);
  const tool = c.req.param('tool');
  const row = db.prepare('SELECT * FROM credentials WHERE org_id = ? AND agent_id = ? AND tool = ?')
    .get(auth.org_id, auth.agent.id, tool);
  if (!row) return c.json({ error: 'forbidden' }, 403);
  const value = decryptValue(auth.org_id, row.encrypted_value);
  const nextSeq = auth.seq + 1;
  // Issue next single-use token
  const nextToken = issueToken(auth.agent.id, auth.org_id, nextSeq);
  logAccess({
    org_id: auth.org_id,
    agent_id: auth.agent.id,
    tool,
    ip: getIp(c),
    action: 'retrieve',
    token_seq: auth.seq
  });
  return c.json({ tool, value, next_token: nextToken, token_seq: nextSeq });
});

app.delete('/v1/credentials/:agent_id/:tool', (c) => {
  const org = adminAuth(c);
  if (!org) return c.json({ error: 'unauthorized' }, 401);
  const agentId = c.req.param('agent_id');
  const tool = c.req.param('tool');
  db.prepare('DELETE FROM credentials WHERE org_id = ? AND agent_id = ? AND tool = ?')
    .run(org.id, agentId, tool);
  logAccess({
    org_id: org.id,
    agent_id: agentId,
    tool,
    ip: getIp(c),
    action: 'revoke'
  });
  return c.json({ ok: true });
});

app.get('/v1/audit', (c) => {
  const org = adminAuth(c);
  if (!org) return c.json({ error: 'unauthorized' }, 401);
  const agentId = c.req.query('agent_id');
  const tool = c.req.query('tool');
  const limit = Math.min(Number(c.req.query('limit') || 50), 200);
  const clauses = ['org_id = ?'];
  const params = [org.id];
  if (agentId) {
    clauses.push('agent_id = ?');
    params.push(agentId);
  }
  if (tool) {
    clauses.push('tool = ?');
    params.push(tool);
  }
  const sql = `SELECT * FROM access_log WHERE ${clauses.join(' AND ')} ORDER BY ts DESC LIMIT ?`;
  params.push(limit);
  const rows = db.prepare(sql).all(...params);
  return c.json({ audit: rows });
});

serve({ fetch: app.fetch, port: PORT }, () => {
  if (!process.env.VAULT_MASTER_KEY || !process.env.VAULT_JWT_SECRET) {
    fs.writeFileSync(
      path.join(process.cwd(), 'DEV_WARNING.txt'),
      'Running with default dev secrets. Set VAULT_MASTER_KEY and VAULT_JWT_SECRET in production.\n'
    );
  }
  console.log(`vault-api listening on http://localhost:${PORT}`);
});
