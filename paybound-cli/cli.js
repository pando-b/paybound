#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();
const DEFAULT_API = 'http://localhost:3001';

function apiUrl(opts) {
  return (opts.apiUrl || process.env.PAYBOUND_API_URL || DEFAULT_API).replace(/\/$/, '');
}

async function httpJson(url, options = {}) {
  const res = await fetch(url, {
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data.error || `Request failed with ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

program
  .name('paybound')
  .description('Paybound Vault CLI');

// orgs commands
const orgs = program.command('orgs').description('Manage organizations');
orgs.command('create')
  .argument('<name>')
  .option('--api-url <url>')
  .action(async (name, opts) => {
    const data = await httpJson(`${apiUrl(opts)}/v1/orgs`, {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    console.log(JSON.stringify(data, null, 2));
  });

// agents commands
const agents = program.command('agents').description('Manage agents');
agents.command('create')
  .argument('<name>')
  .requiredOption('--api-key <key>')
  .option('--api-url <url>')
  .action(async (name, opts) => {
    const data = await httpJson(`${apiUrl(opts)}/v1/agents`, {
      method: 'POST',
      headers: { 'x-api-key': opts.apiKey },
      body: JSON.stringify({ name })
    });
    console.log(JSON.stringify(data, null, 2));
  });

agents.command('list')
  .requiredOption('--api-key <key>')
  .option('--api-url <url>')
  .action(async (opts) => {
    const data = await httpJson(`${apiUrl(opts)}/v1/agents`, {
      headers: { 'x-api-key': opts.apiKey }
    });
    console.log(JSON.stringify(data, null, 2));
  });

agents.command('delete')
  .argument('<id>')
  .requiredOption('--api-key <key>')
  .option('--api-url <url>')
  .action(async (id, opts) => {
    const data = await httpJson(`${apiUrl(opts)}/v1/agents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'x-api-key': opts.apiKey }
    });
    console.log(JSON.stringify(data, null, 2));
  });

// credential commands
const credential = program.command('credential').description('Manage credentials');
credential.command('store')
  .argument('<tool>')
  .argument('<value>')
  .requiredOption('--agent-id <id>')
  .requiredOption('--api-key <key>')
  .option('--api-url <url>')
  .action(async (tool, value, opts) => {
    const data = await httpJson(`${apiUrl(opts)}/v1/credentials`, {
      method: 'POST',
      headers: { 'x-api-key': opts.apiKey },
      body: JSON.stringify({ agent_id: opts.agentId, tool, value })
    });
    console.log(JSON.stringify(data, null, 2));
  });

credential.command('get')
  .argument('<tool>')
  .requiredOption('--agent-token <token>')
  .option('--api-url <url>')
  .action(async (tool, opts) => {
    const data = await httpJson(`${apiUrl(opts)}/v1/credentials/${encodeURIComponent(tool)}`, {
      headers: { Authorization: `Bearer ${opts.agentToken}` }
    });
    console.log(JSON.stringify(data, null, 2));
  });

credential.command('revoke')
  .argument('<agent-id>')
  .argument('<tool>')
  .requiredOption('--api-key <key>')
  .option('--api-url <url>')
  .action(async (agentId, tool, opts) => {
    const data = await httpJson(`${apiUrl(opts)}/v1/credentials/${encodeURIComponent(agentId)}/${encodeURIComponent(tool)}`, {
      method: 'DELETE',
      headers: { 'x-api-key': opts.apiKey }
    });
    console.log(JSON.stringify(data, null, 2));
  });

// audit command
program.command('audit')
  .requiredOption('--api-key <key>')
  .option('--agent-id <id>')
  .option('--tool <tool>')
  .option('--api-url <url>')
  .action(async (opts) => {
    const params = new URLSearchParams();
    if (opts.agentId) params.set('agent_id', opts.agentId);
    if (opts.tool) params.set('tool', opts.tool);
    const qs = params.toString();
    const url = `${apiUrl(opts)}/v1/audit${qs ? `?${qs}` : ''}`;
    const data = await httpJson(url, {
      headers: { 'x-api-key': opts.apiKey }
    });
    console.log(JSON.stringify(data, null, 2));
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
