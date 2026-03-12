import { describe, it, expect } from 'vitest';
import { parseJsonRpcMessage, isToolCallRequest, isToolCallResponse, isToolsListRequest, isToolsListResponse, matchResponse } from './interceptor.js';

describe('parseJsonRpcMessage', () => {
  it('parses a valid JSON-RPC request', () => {
    const msg = parseJsonRpcMessage('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"read_file","arguments":{"path":"/foo"}}}');
    expect(msg).toBeTruthy();
    expect(msg!.method).toBe('tools/call');
    expect(msg!.id).toBe(1);
  });

  it('returns null for invalid JSON', () => {
    const msg = parseJsonRpcMessage('not json');
    expect(msg).toBeNull();
  });

  it('parses a JSON-RPC response', () => {
    const msg = parseJsonRpcMessage('{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"hello"}]}}');
    expect(msg).toBeTruthy();
    expect(msg!.id).toBe(1);
    expect(msg!.result).toBeTruthy();
  });
});

describe('isToolCallRequest', () => {
  it('identifies tools/call requests', () => {
    const msg = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_file', arguments: {} } };
    expect(isToolCallRequest(msg)).toBe(true);
  });

  it('rejects other methods', () => {
    const msg = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
    expect(isToolCallRequest(msg)).toBe(false);
  });
});

describe('isToolsListRequest', () => {
  it('identifies tools/list requests', () => {
    const msg = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
    expect(isToolsListRequest(msg)).toBe(true);
  });
});

describe('matchResponse', () => {
  it('matches response to request by id', () => {
    const req = { jsonrpc: '2.0', id: 5, method: 'tools/call', params: {} };
    const res = { jsonrpc: '2.0', id: 5, result: {} };
    expect(matchResponse(req, res)).toBe(true);
  });

  it('does not match different ids', () => {
    const req = { jsonrpc: '2.0', id: 5, method: 'tools/call', params: {} };
    const res = { jsonrpc: '2.0', id: 6, result: {} };
    expect(matchResponse(req, res)).toBe(false);
  });
});
