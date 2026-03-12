import type { IncomingHttpHeaders } from 'node:http';

export interface SSEEvent {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

/**
 * Parse a buffer of SSE text into complete events and leftover text.
 * SSE events are separated by blank lines (\n\n).
 */
export function extractSSEEvents(buffer: string): { complete: SSEEvent[]; remaining: string } {
  const complete: SSEEvent[] = [];

  // SSE events are delimited by double newlines
  const parts = buffer.split('\n\n');

  // Last part may be incomplete
  const remaining = parts.pop() ?? '';

  for (const part of parts) {
    if (!part.trim()) continue;

    const event: SSEEvent = { data: '' };
    const dataLines: string[] = [];

    for (const line of part.split('\n')) {
      if (line.startsWith('event:')) {
        event.event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      } else if (line.startsWith('id:')) {
        event.id = line.slice(3).trim();
      } else if (line.startsWith('retry:')) {
        const val = parseInt(line.slice(6).trim(), 10);
        if (!isNaN(val)) event.retry = val;
      }
    }

    event.data = dataLines.join('\n');
    if (event.data || event.event) {
      complete.push(event);
    }
  }

  return { complete, remaining };
}

/**
 * Build headers for forwarding a request to the upstream MCP server.
 * Copies relevant headers and sets the host to the upstream URL's host.
 */
export function forwardHeaders(
  incomingHeaders: IncomingHttpHeaders,
  upstreamUrl: URL,
): Record<string, string> {
  const headers: Record<string, string> = {
    host: upstreamUrl.host,
  };

  // Forward content-type and accept
  if (incomingHeaders['content-type']) {
    headers['content-type'] = incomingHeaders['content-type'];
  }
  if (incomingHeaders['accept']) {
    headers['accept'] = incomingHeaders['accept'];
  }

  // Forward MCP-specific headers
  const mcpHeaders = ['mcp-session-id', 'mcp-protocol-version'];
  for (const h of mcpHeaders) {
    const val = incomingHeaders[h];
    if (typeof val === 'string') {
      headers[h] = val;
    }
  }

  // Forward Last-Event-ID for SSE resumption
  if (incomingHeaders['last-event-id']) {
    headers['last-event-id'] = incomingHeaders['last-event-id'] as string;
  }

  return headers;
}
