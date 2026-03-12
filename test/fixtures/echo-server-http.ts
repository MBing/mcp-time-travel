#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'echo-server-http', version: '1.0.0' });

  server.tool(
    'echo',
    'Echoes input back',
    { message: z.string().optional() },
    async (args) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(args) }],
    }),
  );

  server.tool(
    'greet',
    'Returns a greeting',
    { name: z.string().optional() },
    async (args) => ({
      content: [{ type: 'text' as const, text: `Hello, ${args.name ?? 'world'}!` }],
    }),
  );

  return server;
}

const transports = new Map<string, StreamableHTTPServerTransport>();

const httpServer = createServer(async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  // Read body for POST requests
  let body: string | undefined;
  if (req.method === 'POST') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    body = Buffer.concat(chunks).toString('utf-8');
  }

  if (req.method === 'POST') {
    // Existing session
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
      return;
    }

    // New session — only for initialize requests
    const parsed = body ? JSON.parse(body) : undefined;
    if (!parsed || !isInitializeRequest(parsed)) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null,
      }));
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports.set(sid, transport);
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        transports.delete(transport.sessionId);
      }
    };

    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, parsed);
  } else if (req.method === 'GET') {
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
    } else {
      res.writeHead(400);
      res.end('Bad request');
    }
  } else if (req.method === 'DELETE') {
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
    } else {
      res.writeHead(400);
      res.end('Bad request');
    }
  } else {
    res.writeHead(405);
    res.end('Method not allowed');
  }
});

const port = parseInt(process.argv[2] ?? '0', 10);
httpServer.listen(port, () => {
  const addr = httpServer.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  process.stdout.write(`${actualPort}\n`);
});
