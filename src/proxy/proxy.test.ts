import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecordingProxy } from './proxy.js';
import type { SessionWriter } from '../storage/session.js';

describe('RecordingProxy message handling', () => {
  let mockWriter: SessionWriter;

  beforeEach(() => {
    mockWriter = {
      initialize: vi.fn(),
      writeRecord: vi.fn(),
      finalize: vi.fn(),
    } as unknown as SessionWriter;
  });

  it('records a tool call when request and response are processed', async () => {
    const proxy = new RecordingProxy(mockWriter);

    proxy.handleAgentMessage(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: '/foo' } },
    }));

    await proxy.handleServerMessage(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text: 'file contents' }] },
    }));

    expect(mockWriter.writeRecord).toHaveBeenCalledTimes(1);
    const record = (mockWriter.writeRecord as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(record.type).toBe('tool_call');
    expect(record.tool).toBe('read_file');
    expect(record.input).toEqual({ path: '/foo' });
    expect(record.output).toEqual({ content: [{ type: 'text', text: 'file contents' }] });
    expect(record.latency_ms).toBeGreaterThanOrEqual(0);
    expect(record.is_error).toBe(false);
  });

  it('records error tool calls', async () => {
    const proxy = new RecordingProxy(mockWriter);

    proxy.handleAgentMessage(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'write_file', arguments: { path: '/x' } },
    }));

    await proxy.handleServerMessage(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      result: { content: [{ type: 'text', text: 'error' }], isError: true },
    }));

    const record = (mockWriter.writeRecord as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(record.is_error).toBe(true);
  });

  it('records tools/list responses', async () => {
    const proxy = new RecordingProxy(mockWriter);

    proxy.handleAgentMessage(JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
      params: {},
    }));

    await proxy.handleServerMessage(JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      result: { tools: [{ name: 'read_file', description: 'Read' }] },
    }));

    expect(mockWriter.writeRecord).toHaveBeenCalledTimes(1);
    const record = (mockWriter.writeRecord as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(record.type).toBe('tools_list');
    expect(record.tools).toEqual([{ name: 'read_file', description: 'Read' }]);
  });

  it('does not record non-tool messages', async () => {
    const proxy = new RecordingProxy(mockWriter);

    proxy.handleAgentMessage(JSON.stringify({
      jsonrpc: '2.0',
      id: 4,
      method: 'initialize',
      params: { capabilities: {} },
    }));

    await proxy.handleServerMessage(JSON.stringify({
      jsonrpc: '2.0',
      id: 4,
      result: { capabilities: {} },
    }));

    expect(mockWriter.writeRecord).not.toHaveBeenCalled();
  });

  it('increments sequence numbers', async () => {
    const proxy = new RecordingProxy(mockWriter);

    for (let i = 1; i <= 3; i++) {
      proxy.handleAgentMessage(JSON.stringify({
        jsonrpc: '2.0',
        id: i,
        method: 'tools/call',
        params: { name: 'tool_' + i, arguments: {} },
      }));
      await proxy.handleServerMessage(JSON.stringify({
        jsonrpc: '2.0',
        id: i,
        result: { content: [] },
      }));
    }

    const calls = (mockWriter.writeRecord as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0].seq).toBe(1);
    expect(calls[1][0].seq).toBe(2);
    expect(calls[2][0].seq).toBe(3);
  });
});
