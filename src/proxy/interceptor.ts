export interface JsonRpcMessage {
  jsonrpc: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export function parseJsonRpcMessage(raw: string): JsonRpcMessage | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as JsonRpcMessage;
  } catch {
    return null;
  }
}

export function isToolCallRequest(msg: JsonRpcMessage): boolean {
  return msg.method === 'tools/call' && msg.id !== undefined;
}

export function isToolsListRequest(msg: JsonRpcMessage): boolean {
  return msg.method === 'tools/list' && msg.id !== undefined;
}

export function isToolCallResponse(msg: JsonRpcMessage): boolean {
  return msg.id !== undefined && msg.method === undefined && (msg.result !== undefined || msg.error !== undefined);
}

export function isToolsListResponse(msg: JsonRpcMessage): boolean {
  return isToolCallResponse(msg);
}

export function matchResponse(request: JsonRpcMessage, response: JsonRpcMessage): boolean {
  return request.id !== undefined && request.id === response.id;
}
