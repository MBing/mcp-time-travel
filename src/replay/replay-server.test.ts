import { describe, it, expect, beforeEach } from 'vitest';
import { ReplayHandler } from './replay-server.js';
import type { ToolCallRecord, ToolsListRecord, RecordEntry } from '../storage/types.js';

const toolsList: ToolsListRecord = {
  timestamp: '2026-03-12T10:00:00.000Z',
  type: 'tools_list',
  tools: [
    { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    { name: 'write_file', description: 'Write a file' },
  ],
};

const toolCalls: ToolCallRecord[] = [
  {
    seq: 1, timestamp: '2026-03-12T10:00:01.000Z', type: 'tool_call',
    tool: 'read_file', input: { path: '/foo' },
    output: { content: [{ type: 'text', text: 'hello' }] },
    latency_ms: 42, is_error: false,
  },
  {
    seq: 2, timestamp: '2026-03-12T10:00:02.000Z', type: 'tool_call',
    tool: 'write_file', input: { path: '/bar', content: 'world' },
    output: { content: [{ type: 'text', text: 'ok' }] },
    latency_ms: 15, is_error: false,
  },
];

describe('ReplayHandler', () => {
  let handler: ReplayHandler;

  beforeEach(() => {
    const records: RecordEntry[] = [toolsList, ...toolCalls];
    handler = new ReplayHandler(records, []);
  });

  it('returns the recorded tool list', () => {
    const tools = handler.getTools();
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('read_file');
    expect(tools[1].name).toBe('write_file');
  });

  it('returns recorded output for sequential tool calls', () => {
    const result1 = handler.handleToolCall('read_file', { path: '/foo' });
    expect(result1).toEqual({ content: [{ type: 'text', text: 'hello' }] });

    const result2 = handler.handleToolCall('write_file', { path: '/bar', content: 'world' });
    expect(result2).toEqual({ content: [{ type: 'text', text: 'ok' }] });
  });

  it('returns recorded output even if tool name differs (sequence-based)', () => {
    const result = handler.handleToolCall('different_tool', {});
    expect(result).toEqual({ content: [{ type: 'text', text: 'hello' }] });
  });

  it('returns an error when sequence is exhausted', () => {
    handler.handleToolCall('a', {});
    handler.handleToolCall('b', {});
    const result = handler.handleToolCall('c', {}) as { content: Array<{ type: string; text: string }>; isError: boolean };
    expect(result.isError).toBe(true);
  });

  it('applies overrides to output', () => {
    const records: RecordEntry[] = [toolsList, ...toolCalls];
    const overriddenHandler = new ReplayHandler(records, [
      { seq: 1, output: { content: [{ type: 'text', text: 'overridden!' }] } },
    ]);

    const result = overriddenHandler.handleToolCall('read_file', { path: '/foo' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'overridden!' }] });
  });
});
