import { describe, it, expect } from 'vitest';
import { SequenceMatcher } from './matcher.js';
import type { ToolCallRecord } from '../storage/types.js';

const makeRecord = (seq: number, tool: string): ToolCallRecord => ({
  seq,
  timestamp: '2026-03-12T10:00:00.000Z',
  type: 'tool_call',
  tool,
  input: { key: `input-${seq}` },
  output: { content: [{ type: 'text', text: `output-${seq}` }] },
  latency_ms: 10,
  is_error: false,
});

describe('SequenceMatcher', () => {
  it('returns records in sequence order', () => {
    const records = [makeRecord(1, 'a'), makeRecord(2, 'b'), makeRecord(3, 'c')];
    const matcher = new SequenceMatcher(records);
    expect(matcher.next()?.tool).toBe('a');
    expect(matcher.next()?.tool).toBe('b');
    expect(matcher.next()?.tool).toBe('c');
  });

  it('returns null when sequence is exhausted', () => {
    const matcher = new SequenceMatcher([makeRecord(1, 'a')]);
    matcher.next();
    expect(matcher.next()).toBeNull();
  });

  it('reports remaining count', () => {
    const matcher = new SequenceMatcher([makeRecord(1, 'a'), makeRecord(2, 'b')]);
    expect(matcher.remaining()).toBe(2);
    matcher.next();
    expect(matcher.remaining()).toBe(1);
  });

  it('peeks without advancing', () => {
    const matcher = new SequenceMatcher([makeRecord(1, 'a'), makeRecord(2, 'b')]);
    expect(matcher.peek()?.tool).toBe('a');
    expect(matcher.peek()?.tool).toBe('a');
    expect(matcher.remaining()).toBe(2);
  });

  it('resets to a specific position', () => {
    const records = [makeRecord(1, 'a'), makeRecord(2, 'b'), makeRecord(3, 'c')];
    const matcher = new SequenceMatcher(records);
    matcher.next(); matcher.next();
    matcher.resetTo(0);
    expect(matcher.next()?.tool).toBe('a');
  });
});
