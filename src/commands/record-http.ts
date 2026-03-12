import { createServer, request as httpRequest } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SessionWriter } from '../storage/session.js';
import { RecordingProxy } from '../proxy/proxy.js';
import { generateSessionId } from '../utils/id.js';
import { extractSSEEvents } from '../transport/sse.js';
import type { JsonRpcMessage } from '../proxy/interceptor.js';

// Headers that should not be forwarded between client and upstream
const SKIP_REQUEST_HEADERS = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'te',
  'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate',
  'host',
]);

interface RecordHttpOptions {
  upstream: string;
  port: string;
  session?: string;
  output: string;
}

export async function recordHttpCommand(options: RecordHttpOptions): Promise<void> {
  const upstreamUrl = new URL(options.upstream);
  const port = parseInt(options.port, 10);
  const sessionId = options.session ?? generateSessionId();

  const writer = new SessionWriter({
    baseDir: options.output,
    sessionId,
    serverName: upstreamUrl.host,
    serverConfig: { url: options.upstream },
    transport: 'http',
  });
  await writer.initialize();

  const proxy = new RecordingProxy(writer);

  process.stderr.write(`[mcp-time-travel] Recording HTTP session: ${sessionId}\n`);
  process.stderr.write(`[mcp-time-travel] Upstream: ${options.upstream}\n`);
  process.stderr.write(`[mcp-time-travel] Listening on port ${port}\n`);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      await handleRequest(req, res, upstreamUrl, proxy);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[mcp-time-travel] Proxy error: ${errMsg}\n`);
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'proxy error' }));
      }
    }
  });

  server.listen(port, () => {
    process.stderr.write(`[mcp-time-travel] HTTP proxy ready\n`);
  });

  const cleanup = async () => {
    server.close();
    await writer.finalize();
    process.stderr.write(`[mcp-time-travel] Session saved: ${sessionId}\n`);
  };

  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await cleanup();
    process.exit(0);
  });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function buildUpstreamHeaders(incoming: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const [key, value] of Object.entries(incoming.headers)) {
    if (SKIP_REQUEST_HEADERS.has(key)) continue;
    if (typeof value === 'string') {
      headers[key] = value;
    } else if (Array.isArray(value)) {
      headers[key] = value.join(', ');
    }
  }

  return headers;
}

async function interceptMessages(
  proxy: RecordingProxy,
  body: string,
  direction: 'request' | 'response',
): Promise<void> {
  try {
    const parsed = JSON.parse(body);
    const messages: JsonRpcMessage[] = Array.isArray(parsed) ? parsed : [parsed];
    for (const msg of messages) {
      if (direction === 'request') {
        proxy.handleAgentRequest(msg);
      } else {
        await proxy.handleServerResponse(msg);
      }
    }
  } catch {
    // Not valid JSON — skip interception
  }
}

/**
 * Forward an HTTP request to the upstream using node:http.request.
 * We use http.request instead of fetch to avoid undici's connection pooling
 * issues (SocketError: other side closed) when upstream closes SSE connections.
 */
function forwardToUpstream(
  method: string,
  upstreamUrl: URL,
  headers: Record<string, string>,
  body?: string,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: upstreamUrl.hostname,
        port: upstreamUrl.port,
        path: upstreamUrl.pathname + upstreamUrl.search,
        method,
        headers,
        agent: false, // Disable connection pooling — each request gets a fresh connection
      },
      (upstreamRes) => resolve(upstreamRes),
    );
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  upstreamUrl: URL,
  proxy: RecordingProxy,
): Promise<void> {
  const method = req.method ?? 'GET';
  const headers = buildUpstreamHeaders(req);
  let body: string | undefined;

  // For POST, read body and intercept
  if (method === 'POST') {
    body = await readBody(req);
    await interceptMessages(proxy, body, 'request');
  }

  const upstreamRes = await forwardToUpstream(method, upstreamUrl, headers, body);

  // Copy response headers, filtering hop-by-hop
  const responseHeaders: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(upstreamRes.headers)) {
    if (key === 'transfer-encoding' || key === 'connection') continue;
    if (value !== undefined) {
      responseHeaders[key] = value;
    }
  }

  const contentType = upstreamRes.headers['content-type'] ?? '';

  if (contentType.includes('text/event-stream')) {
    // SSE response — stream through, intercepting data fields for recording
    res.writeHead(upstreamRes.statusCode ?? 200, responseHeaders);

    let sseBuffer = '';

    upstreamRes.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      sseBuffer += text;

      const { complete, remaining } = extractSSEEvents(sseBuffer);
      sseBuffer = remaining;

      for (const event of complete) {
        if (event.data) {
          interceptMessages(proxy, event.data, 'response');
        }
      }

      // Forward the raw chunk unchanged
      res.write(chunk);
    });

    upstreamRes.on('end', () => {
      // Process any remaining buffer
      if (sseBuffer.trim()) {
        const { complete } = extractSSEEvents(sseBuffer + '\n\n');
        for (const event of complete) {
          if (event.data) {
            interceptMessages(proxy, event.data, 'response');
          }
        }
      }
      res.end();
    });

    upstreamRes.on('error', (err) => {
      process.stderr.write(`[mcp-time-travel] Upstream SSE error: ${err.message}\n`);
      res.end();
    });
  } else {
    // Non-SSE response — read full body and intercept
    const chunks: Buffer[] = [];
    for await (const chunk of upstreamRes) {
      chunks.push(chunk as Buffer);
    }
    const responseBody = Buffer.concat(chunks).toString('utf-8');

    if (contentType.includes('application/json')) {
      await interceptMessages(proxy, responseBody, 'response');
    }

    res.writeHead(upstreamRes.statusCode ?? 200, responseHeaders);
    res.end(responseBody);
  }
}
