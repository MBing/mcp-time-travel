import chalk from 'chalk';
import { listSessions } from '../storage/session.js';

interface ListOptions {
  dir: string;
}

export async function listCommand(options: ListOptions): Promise<void> {
  const sessions = await listSessions(options.dir);

  if (sessions.length === 0) {
    console.log('No recorded sessions found.');
    return;
  }

  // Header
  console.log(
    chalk.bold(
      padRight('SESSION ID', 30) +
      padRight('SERVER', 20) +
      padRight('CALLS', 8) +
      padRight('TOOLS', 30) +
      'DATE'
    )
  );
  console.log(chalk.dim('\u2500'.repeat(100)));

  // Rows
  for (const session of sessions) {
    const date = session.startTime
      ? new Date(session.startTime).toLocaleString()
      : 'unknown';
    console.log(
      padRight(session.id, 30) +
      padRight(session.serverName, 20) +
      padRight(String(session.toolCount), 8) +
      padRight(session.tools.join(', ').slice(0, 28), 30) +
      date
    );
  }
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len - 1) + ' ' : str + ' '.repeat(len - str.length);
}
