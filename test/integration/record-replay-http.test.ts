import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const CLI_PATH = path.join(PROJECT_ROOT, 'dist', 'cli.js');
const ECHO_SERVER_PATH = path.join(PROJECT_ROOT, 'test', 'fixtures', 'echo-server-http.ts');
const TSX_PATH = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');

function waitForPort(proc: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: proc.stdout! });
    const timer = setTimeout(() => reject(new Error('Timed out waiting for port')), 10_000);
    rl.once('line', (line) => {
      clearTimeout(timer);
      rl.close();
      resolve(parseInt(line.trim(), 10));
    });
    proc.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForStderr(proc: ChildProcess, marker: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: proc.stderr! });
    const timer = setTimeout(() => {
      rl.close();
      reject(new Error(`Timed out waiting for "${marker}"`));
    }, 10_000);
    rl.on('line', (line) => {
      if (line.includes(marker)) {
        clearTimeout(timer);
        rl.close();
        resolve();
      }
    });
    proc.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('Integration: HTTP record and replay flow', () => {
  let tmpDir: string;
  let outputDir: string;
  const SESSION_ID = 'test-http-integration-1';
  const PROXY_PORT = 19000 + Math.floor(Math.random() * 1000);
  const REPLAY_PORT = PROXY_PORT + 1;

  let echoServer: ChildProcess;
  let echoServerPort: number;

  let recordedEchoResult: Awaited<ReturnType<Client['callTool']>>;
  let recordedGreetResult: Awaited<ReturnType<Client['callTool']>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-replay-http-integ-'));
    outputDir = path.join(tmpDir, 'sessions');

    // Start the echo MCP server over HTTP on a random port
    echoServer = spawn(TSX_PATH, [ECHO_SERVER_PATH, '0'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    echoServerPort = await waitForPort(echoServer);
  }, 15_000);

  afterAll(() => {
    echoServer?.kill();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should record an HTTP session with tool calls', async () => {
    const proxy = spawn('node', [
      CLI_PATH,
      'record-http',
      '--upstream', `http://localhost:${echoServerPort}`,
      '--port', String(PROXY_PORT),
      '--session', SESSION_ID,
      '--output', outputDir,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Wait for proxy to be ready
    await waitForStderr(proxy, 'HTTP proxy ready');

    try {
      // Connect MCP client to the recording proxy
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${PROXY_PORT}`),
      );
      const client = new Client({ name: 'http-integration-test', version: '1.0.0' });
      await client.connect(transport);

      // List tools
      const tools = await client.listTools();
      expect(tools.tools.length).toBe(2);
      const toolNames = tools.tools.map(t => t.name).sort();
      expect(toolNames).toEqual(['echo', 'greet']);

      // Call echo tool
      recordedEchoResult = await client.callTool({
        name: 'echo',
        arguments: { message: 'hello-http' },
      });
      expect(recordedEchoResult).toBeDefined();

      // Call greet tool
      recordedGreetResult = await client.callTool({
        name: 'greet',
        arguments: { name: 'Bob' },
      });
      expect(recordedGreetResult).toBeDefined();

      await client.close();
    } finally {
      proxy.kill('SIGTERM');
      // Give it time to finalize the session
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }, 30_000);

  it('should have created recording files', () => {
    const sessionDir = path.join(outputDir, SESSION_ID);
    const metadataPath = path.join(sessionDir, 'metadata.json');
    const recordingPath = path.join(sessionDir, 'recording.jsonl');

    expect(fs.existsSync(metadataPath)).toBe(true);
    expect(fs.existsSync(recordingPath)).toBe(true);

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    expect(metadata.id).toBe(SESSION_ID);
    expect(metadata.transport).toBe('http');

    const lines = fs.readFileSync(recordingPath, 'utf-8').trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(3); // tools_list + 2 tool_calls

    const records = lines.map((line) => JSON.parse(line));
    const toolsList = records.filter((r: { type: string }) => r.type === 'tools_list');
    const toolCalls = records.filter((r: { type: string }) => r.type === 'tool_call');
    expect(toolsList.length).toBe(1);
    expect(toolCalls.length).toBe(2);
  });

  it('should replay the recorded HTTP session with matching results', async () => {
    const replayProc = spawn('node', [
      CLI_PATH,
      'replay-http',
      SESSION_ID,
      '--dir', outputDir,
      '--port', String(REPLAY_PORT),
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    await waitForStderr(replayProc, 'HTTP replay server ready');

    try {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${REPLAY_PORT}`),
      );
      const client = new Client({ name: 'http-replay-test', version: '1.0.0' });
      await client.connect(transport);

      // List tools from replay
      const tools = await client.listTools();
      expect(tools.tools.length).toBe(2);
      const toolNames = tools.tools.map(t => t.name).sort();
      expect(toolNames).toEqual(['echo', 'greet']);

      // Call echo tool from replay
      const replayedEchoResult = await client.callTool({
        name: 'echo',
        arguments: { message: 'hello-http' },
      });

      if ('content' in recordedEchoResult && 'content' in replayedEchoResult) {
        expect(replayedEchoResult.content).toEqual(recordedEchoResult.content);
      }

      // Call greet tool from replay
      const replayedGreetResult = await client.callTool({
        name: 'greet',
        arguments: { name: 'Bob' },
      });

      if ('content' in recordedGreetResult && 'content' in replayedGreetResult) {
        expect(replayedGreetResult.content).toEqual(recordedGreetResult.content);
      }

      await client.close();
    } finally {
      replayProc.kill('SIGTERM');
    }
  }, 30_000);
});
