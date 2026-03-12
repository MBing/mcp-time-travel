import { describe, it, expect } from 'vitest';
import { extractSSEEvents, forwardHeaders } from './sse.js';

describe('extractSSEEvents', () => {
  it('parses a single complete event', () => {
    const buffer = 'data: {"jsonrpc":"2.0","id":1}\n\n';
    const { complete, remaining } = extractSSEEvents(buffer);

    expect(complete).toHaveLength(1);
    expect(complete[0].data).toBe('{"jsonrpc":"2.0","id":1}');
    expect(remaining).toBe('');
  });

  it('parses multiple events', () => {
    const buffer = 'data: first\n\ndata: second\n\n';
    const { complete, remaining } = extractSSEEvents(buffer);

    expect(complete).toHaveLength(2);
    expect(complete[0].data).toBe('first');
    expect(complete[1].data).toBe('second');
    expect(remaining).toBe('');
  });

  it('preserves incomplete data as remaining', () => {
    const buffer = 'data: complete\n\ndata: incom';
    const { complete, remaining } = extractSSEEvents(buffer);

    expect(complete).toHaveLength(1);
    expect(complete[0].data).toBe('complete');
    expect(remaining).toBe('data: incom');
  });

  it('parses event type and id fields', () => {
    const buffer = 'event: message\nid: 42\ndata: hello\n\n';
    const { complete } = extractSSEEvents(buffer);

    expect(complete).toHaveLength(1);
    expect(complete[0].event).toBe('message');
    expect(complete[0].id).toBe('42');
    expect(complete[0].data).toBe('hello');
  });

  it('parses retry field', () => {
    const buffer = 'retry: 5000\ndata: reconnect\n\n';
    const { complete } = extractSSEEvents(buffer);

    expect(complete).toHaveLength(1);
    expect(complete[0].retry).toBe(5000);
  });

  it('handles multi-line data', () => {
    const buffer = 'data: line1\ndata: line2\n\n';
    const { complete } = extractSSEEvents(buffer);

    expect(complete).toHaveLength(1);
    expect(complete[0].data).toBe('line1\nline2');
  });

  it('returns empty arrays for empty buffer', () => {
    const { complete, remaining } = extractSSEEvents('');
    expect(complete).toHaveLength(0);
    expect(remaining).toBe('');
  });
});

describe('forwardHeaders', () => {
  it('sets host to upstream URL host', () => {
    const headers = forwardHeaders({}, new URL('http://server:3000/mcp'));
    expect(headers.host).toBe('server:3000');
  });

  it('forwards content-type and accept', () => {
    const headers = forwardHeaders(
      { 'content-type': 'application/json', accept: 'text/event-stream' },
      new URL('http://server:3000/mcp'),
    );
    expect(headers['content-type']).toBe('application/json');
    expect(headers['accept']).toBe('text/event-stream');
  });

  it('forwards MCP-specific headers', () => {
    const headers = forwardHeaders(
      { 'mcp-session-id': 'abc123', 'mcp-protocol-version': '2025-03-26' },
      new URL('http://server:3000/mcp'),
    );
    expect(headers['mcp-session-id']).toBe('abc123');
    expect(headers['mcp-protocol-version']).toBe('2025-03-26');
  });

  it('forwards last-event-id', () => {
    const headers = forwardHeaders(
      { 'last-event-id': 'evt-42' },
      new URL('http://server:3000/mcp'),
    );
    expect(headers['last-event-id']).toBe('evt-42');
  });
});
