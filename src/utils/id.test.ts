import { describe, it, expect } from 'vitest';
import { generateSessionId } from './id.js';

describe('generateSessionId', () => {
  it('generates a string', () => {
    const id = generateSessionId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateSessionId()));
    expect(ids.size).toBe(100);
  });

  it('starts with a date-like prefix', () => {
    const id = generateSessionId();
    // Format: YYYYMMDD-HHmmss-<random>
    expect(id).toMatch(/^\d{8}-\d{6}-.+$/);
  });
});
