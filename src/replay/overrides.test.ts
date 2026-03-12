import { describe, it, expect } from 'vitest';
import { OverrideManager } from './overrides.js';
import type { ToolCallRecord } from '../storage/types.js';

describe('OverrideManager', () => {
  it('returns original record when no override exists', () => {
    const mgr = new OverrideManager([]);
    const record: ToolCallRecord = {
      seq: 1, timestamp: '', type: 'tool_call', tool: 'a',
      input: { k: 'v' }, output: { content: [] }, latency_ms: 10, is_error: false,
    };
    const result = mgr.apply(record);
    expect(result.output).toEqual({ content: [] });
  });

  it('overrides output for matching sequence', () => {
    const mgr = new OverrideManager([
      { seq: 2, output: { content: [{ type: 'text', text: 'overridden' }] } },
    ]);
    const record: ToolCallRecord = {
      seq: 2, timestamp: '', type: 'tool_call', tool: 'a',
      input: { k: 'v' }, output: { content: [] }, latency_ms: 10, is_error: false,
    };
    const result = mgr.apply(record);
    expect(result.output).toEqual({ content: [{ type: 'text', text: 'overridden' }] });
  });

  it('overrides input for matching sequence', () => {
    const mgr = new OverrideManager([
      { seq: 1, input: { key: 'new-value' } },
    ]);
    const record: ToolCallRecord = {
      seq: 1, timestamp: '', type: 'tool_call', tool: 'a',
      input: { key: 'old' }, output: {}, latency_ms: 10, is_error: false,
    };
    const result = mgr.apply(record);
    expect(result.input).toEqual({ key: 'new-value' });
  });

  it('can override both input and output', () => {
    const mgr = new OverrideManager([
      { seq: 1, input: { q: 'new' }, output: { content: [{ type: 'text', text: 'new' }] } },
    ]);
    const record: ToolCallRecord = {
      seq: 1, timestamp: '', type: 'tool_call', tool: 'a',
      input: { q: 'old' }, output: { content: [] }, latency_ms: 10, is_error: false,
    };
    const result = mgr.apply(record);
    expect(result.input).toEqual({ q: 'new' });
    expect(result.output).toEqual({ content: [{ type: 'text', text: 'new' }] });
  });
});
