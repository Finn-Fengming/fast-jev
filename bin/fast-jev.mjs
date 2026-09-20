#!/usr/bin/env node
import { main } from '../src/cli.mjs';
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
process.stdout.on('error', error => {
  if (error.code === 'EPIPE') { controller.abort(); process.exit(0); }
  throw error;
});
await main(process.argv.slice(2), { signal: controller.signal });
