# mcp-replay Design

## Overview

mcp-replay is a developer tool for recording, replaying, and debugging MCP (Model Context Protocol) tool calls. It acts as a transparent proxy between an AI agent and real MCP servers, capturing every tool call with metadata. Recorded sessions can be replayed deterministically or stepped through interactively for debugging.

Distributed as an npm package, usable via `npx mcp-replay`.

## Architecture

### Record Mode

```
Agent (Claude Code, Cursor, etc.)
  │  stdio (JSON-RPC)
  ▼
mcp-replay (proxy)
  │  ├── Intercepts all JSON-RPC messages
  │  ├── Logs to .mcp-replay/sessions/<id>/recording.jsonl
  │  └── Forwards to real server
  ▼
Real MCP Server (child process, stdio)
```

The proxy:
1. Reads the real server config from Claude Code's `mcpServers` JSON format
2. Spawns the real server as a child process
3. Pipes all stdin from the agent to the real server
4. Pipes all stdout from real server to the agent
5. Logs every `tools/call` request/response pair with metadata to JSONL

### Replay Mode

```
Agent
  │  stdio (JSON-RPC)
  ▼
mcp-replay (replay server)
  │  ├── Reads recording.jsonl
  │  ├── On tools/list → returns recorded tool list
  │  └── On tools/call → returns recorded output (matched by sequence)
  │
  (no real server needed)
```

Full replacement of the real server. Fully deterministic, works offline.

### Debug Mode (not an MCP server)

```
Terminal
  │
mcp-replay debug session-123
  │  ├── Reads recording.jsonl
  │  ├── Displays each call interactively
  │  └── Allows modify/skip/override
```

## Transport

stdio only. This is how Claude Code, Cursor, and most CLI-based agents communicate with MCP servers, and what `npx` naturally supports.

## Session Storage

```
.mcp-replay/
  sessions/
    <session-id>/
      metadata.json      # session info, timestamps
      recording.jsonl     # tool calls as JSONL
```

### metadata.json

```json
{
  "id": "20260312-100000-abc",
  "serverName": "my-server",
  "serverConfig": {
    "command": "node",
    "args": ["server.js"]
  },
  "startTime": "2026-03-12T10:00:00.000Z",
  "endTime": "2026-03-12T10:05:00.000Z",
  "toolCount": 5,
  "tools": ["read_file", "write_file", "run_query"]
}
```

### recording.jsonl

Each line:

```json
{
  "seq": 1,
  "timestamp": "2026-03-12T10:00:00.000Z",
  "type": "tool_call",
  "tool": "read_file",
  "input": { "path": "/foo/bar.ts" },
  "output": { "content": [{ "type": "text", "text": "..." }] },
  "latency_ms": 42,
  "is_error": false
}
```

## CLI Interface

### `npx mcp-replay record`

Record a session by proxying to a real MCP server.

```
npx mcp-replay record --server <name> --config <path>

Options:
  --server <name>    Name of the server in the config file (required)
  --config <path>    Path to MCP config JSON (default: ~/.claude/mcp.json)
  --session <id>     Custom session ID (default: auto-generated)
  --output <dir>     Output directory (default: .mcp-replay/)
```

Behavior: spawns as MCP server on stdio, spawns real server as child process, proxies all traffic, logs tool calls. On exit, writes metadata.json and prints session ID.

### `npx mcp-replay replay <session-id>`

Replay a recorded session.

```
npx mcp-replay replay <session-id>

Options:
  --dir <dir>        Sessions directory (default: .mcp-replay/)
  --speed <factor>   Replay speed: 0 = instant, 1 = real-time (default: 0)
  --override <file>  JSON file with input/output overrides
```

Behavior: acts as MCP server on stdio, serves recorded tool list and responses, matches calls by sequence number.

### `npx mcp-replay debug <session-id>`

Interactive step-through debugger.

```
npx mcp-replay debug <session-id>

Options:
  --dir <dir>        Sessions directory (default: .mcp-replay/)
  --step <n>         Start at step N (default: 1)

Interactive commands:
  n / next           → Advance to next tool call
  m / modify         → Edit the input JSON before replaying
  o / override       → Edit the output JSON
  s / skip           → Skip this tool call
  r / replay         → Replay from current step with modifications
  l / list           → Show all tool calls in session
  q / quit           → Exit debugger
```

### `npx mcp-replay list`

List recorded sessions.

```
npx mcp-replay list

Options:
  --dir <dir>        Sessions directory (default: .mcp-replay/)
```

## Core Proxy Logic

### Recording

The proxy handles MCP's JSON-RPC protocol. Key messages:

1. **`initialize`** — Pass through, log the capabilities negotiation
2. **`tools/list`** — Pass through, record the available tools (needed for replay)
3. **`tools/call`** — Record request params, forward to real server, record response, measure latency
4. **All other messages** — Pass through transparently

The proxy does NOT need to understand every MCP message type. It parses JSON-RPC envelopes to identify `tools/call` messages, captures input/output/timing for those, and pipes everything else through unchanged.

### Replay Matching

During replay, tool calls are matched by **sequence number** (the Nth tool call returns the Nth recorded response). If the agent sends a call that doesn't match the recording (different tool name or input), a warning is logged but the recorded output at that sequence position is still returned. This keeps replay deterministic.

### Override System

An override file (JSON) specifies replacements:

```json
{
  "overrides": [
    { "seq": 3, "output": { "content": [{ "type": "text", "text": "modified!" }] } },
    { "seq": 5, "input": { "query": "SELECT * FROM users LIMIT 1" } }
  ]
}
```

During replay, if an override exists for the current sequence, it is used instead of the recorded data. During debug mode, interactive modifications are equivalent to overrides.

## Technology Stack

- **TypeScript** — type safety, npm ecosystem
- **@modelcontextprotocol/sdk** — official MCP SDK for server/client implementation
- **commander** — CLI argument parsing
- **nanoid** — session ID generation
- **chalk** — terminal colors for debug mode
- **readline** — Node built-in for interactive debug mode

## Project Structure

```
mcp-replay/
  package.json          # bin: { "mcp-replay": "./dist/cli.js" }
  tsconfig.json
  src/
    cli.ts              # Entry point, commander setup
    commands/
      record.ts         # Record command handler
      replay.ts         # Replay command handler
      debug.ts          # Debug command handler
      list.ts           # List sessions command
    proxy/
      proxy.ts          # Core proxy logic (intercept, forward, log)
      interceptor.ts    # JSON-RPC message parsing and tool call detection
    replay/
      replay-server.ts  # MCP server that serves recorded data
      matcher.ts        # Sequence-based matching logic
      overrides.ts      # Override loading and application
    storage/
      session.ts        # Session read/write (metadata.json + recording.jsonl)
      types.ts          # ToolCallRecord, SessionMetadata types
    debug/
      debugger.ts       # Interactive terminal debugger
    config/
      loader.ts         # Load MCP config from Claude Code format
    utils/
      id.ts             # Session ID generation
      logger.ts         # Structured logging
```

## Key Types

```typescript
interface SessionMetadata {
  id: string;
  serverName: string;
  serverConfig: McpServerConfig;
  startTime: string;
  endTime: string;
  toolCount: number;
  tools: string[];
}

interface ToolCallRecord {
  seq: number;
  timestamp: string;
  type: 'tool_call';
  tool: string;
  input: Record<string, unknown>;
  output: { content: Content[] } | { error: string };
  latency_ms: number;
  is_error: boolean;
}

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}
```
