import type { ToolCallRecord } from '../storage/types.js';

export interface Override {
  seq: number;
  input?: Record<string, unknown>;
  output?: unknown;
}

export class OverrideManager {
  private overrideMap: Map<number, Override>;

  constructor(overrides: Override[]) {
    this.overrideMap = new Map(overrides.map(o => [o.seq, o]));
  }

  apply(record: ToolCallRecord): ToolCallRecord {
    const override = this.overrideMap.get(record.seq);
    if (!override) return record;
    return {
      ...record,
      ...(override.input !== undefined ? { input: override.input } : {}),
      ...(override.output !== undefined ? { output: override.output } : {}),
    };
  }

  has(seq: number): boolean {
    return this.overrideMap.has(seq);
  }
}

export interface OverrideFile {
  overrides: Override[];
}

export function loadOverrides(raw: string): Override[] {
  const parsed: OverrideFile = JSON.parse(raw);
  return parsed.overrides ?? [];
}
