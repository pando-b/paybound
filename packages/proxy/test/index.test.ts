import { describe, it, expect } from 'vitest';
import { hello } from '../src/index.js';

describe('proxy', () => {
  it('exports hello()', () => {
    expect(hello()).toBe('hello from proxy');
  });
});
