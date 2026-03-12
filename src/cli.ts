#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('mcp-replay')
  .description('Record, replay, and debug MCP tool call sessions')
  .version('0.1.0');

program.parse();
