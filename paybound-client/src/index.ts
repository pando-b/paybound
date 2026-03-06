import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type CacheData = Record<string, string>;

function xorBuffer(data: Buffer, key: Buffer): Buffer {
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 1) {
    out[i] = data[i] ^ key[i % key.length];
  }
  return out;
}

function encryptString(plaintext: string, key: string): string {
  const data = Buffer.from(plaintext, 'utf8');
  const keyBuf = Buffer.from(key, 'utf8');
  return xorBuffer(data, keyBuf).toString('base64');
}

function decryptString(payload: string, key: string): string {
  const data = Buffer.from(payload, 'base64');
  const keyBuf = Buffer.from(key, 'utf8');
  return xorBuffer(data, keyBuf).toString('utf8');
}

export class PayboundClient {
  private apiUrl: string;
  private agentToken: string;
  private cachePath: string;

  constructor(options: { apiUrl: string; agentToken: string; localCachePath?: string }) {
    this.apiUrl = options.apiUrl.replace(/\/$/, '');
    this.agentToken = options.agentToken;
    this.cachePath = options.localCachePath || path.join(os.homedir(), '.paybound-cache.json');
  }

  private readCache(): CacheData {
    if (!fs.existsSync(this.cachePath)) return {};
    const raw = fs.readFileSync(this.cachePath, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  }

  private writeCache(data: CacheData) {
    fs.writeFileSync(this.cachePath, JSON.stringify(data, null, 2));
  }

  async getCredential(tool: string): Promise<string> {
    const url = `${this.apiUrl}/v1/credentials/${encodeURIComponent(tool)}`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.agentToken}` }
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      const cache = this.readCache();
      cache[tool] = encryptString(data.value, this.agentToken);
      this.writeCache(cache);
      return data.value;
    } catch (err) {
      const cache = this.readCache();
      const cached = cache[tool];
      if (!cached) throw err;
      return decryptString(cached, this.agentToken);
    }
  }

  async listTools(): Promise<string[]> {
    const cache = this.readCache();
    return Object.keys(cache);
  }
}
