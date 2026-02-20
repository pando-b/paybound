import { describe, it, expect } from 'vitest';
import { hello } from '../src/index.js';

describe('core', () => {
  it('exports hello()', () => {
    expect(hello()).toBe('hello from core');
  });
});
