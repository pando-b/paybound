import { describe, it, expect } from 'vitest';
import { hello } from '../src/index.js';

describe('sdk', () => {
  it('exports hello()', () => {
    expect(hello()).toBe('hello from sdk');
  });
});
