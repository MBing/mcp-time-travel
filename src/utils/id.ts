import { nanoid } from 'nanoid';

export function generateSessionId(): string {
  const now = new Date();
  const date = now.toISOString().replace(/[-:T]/g, '').slice(0, 8);
  const time = now.toISOString().replace(/[-:T]/g, '').slice(8, 14);
  return `${date}-${time}-${nanoid(6)}`;
}
