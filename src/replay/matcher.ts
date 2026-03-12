import type { ToolCallRecord } from '../storage/types.js';

export class SequenceMatcher {
  private position = 0;

  constructor(private records: ToolCallRecord[]) {
    // Sort by seq to ensure correct order regardless of file write order
    this.records.sort((a, b) => a.seq - b.seq);
  }

  next(): ToolCallRecord | null {
    if (this.position >= this.records.length) return null;
    return this.records[this.position++];
  }

  peek(): ToolCallRecord | null {
    if (this.position >= this.records.length) return null;
    return this.records[this.position];
  }

  remaining(): number {
    return this.records.length - this.position;
  }

  resetTo(position: number): void {
    this.position = Math.max(0, Math.min(position, this.records.length));
  }

  currentPosition(): number {
    return this.position;
  }

  total(): number {
    return this.records.length;
  }
}
