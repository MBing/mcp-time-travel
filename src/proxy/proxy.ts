import { parseJsonRpcMessage, isToolCallRequest, isToolsListRequest } from './interceptor.js';
import type { JsonRpcMessage } from './interceptor.js';
import type { SessionWriter } from '../storage/session.js';
import type { ToolCallRecord, ToolsListRecord } from '../storage/types.js';

interface PendingRequest {
  message: JsonRpcMessage;
  method: string;
  startTime: number;
}

export class RecordingProxy {
  private pendingRequests = new Map<number | string, PendingRequest>();
  private seq = 0;

  constructor(private writer: SessionWriter) {}

  handleAgentMessage(raw: string): string {
    const msg = parseJsonRpcMessage(raw);
    if (msg && msg.id !== undefined && (isToolCallRequest(msg) || isToolsListRequest(msg))) {
      this.pendingRequests.set(msg.id, {
        message: msg,
        method: msg.method!,
        startTime: Date.now(),
      });
    }
    return raw;
  }

  async handleServerMessage(raw: string): Promise<string> {
    const msg = parseJsonRpcMessage(raw);
    if (msg && msg.id !== undefined) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        const latency = Date.now() - pending.startTime;

        if (pending.method === 'tools/call') {
          this.seq++;
          const params = pending.message.params as { name: string; arguments?: Record<string, unknown> };
          const result = msg.result as { content?: unknown[]; isError?: boolean } | undefined;
          const record: ToolCallRecord = {
            seq: this.seq,
            timestamp: new Date().toISOString(),
            type: 'tool_call',
            tool: params.name,
            input: params.arguments ?? {},
            output: msg.error ? { error: msg.error } : (msg.result ?? {}),
            latency_ms: latency,
            is_error: !!(msg.error || result?.isError),
          };
          await this.writer.writeRecord(record);
        } else if (pending.method === 'tools/list') {
          const result = msg.result as { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> } | undefined;
          if (result?.tools) {
            const record: ToolsListRecord = {
              timestamp: new Date().toISOString(),
              type: 'tools_list',
              tools: result.tools.map(t => ({
                name: t.name,
                ...(t.description ? { description: t.description } : {}),
                ...(t.inputSchema ? { inputSchema: t.inputSchema } : {}),
              })),
            };
            await this.writer.writeRecord(record);
          }
        }
      }
    }
    return raw;
  }
}
