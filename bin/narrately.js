#!/usr/bin/env node
import { run } from '../src/cli.js';

run(process.argv.slice(2)).catch((error) => {
  console.error('\x1b[31m✗\x1b[0m', error?.message ?? error);
  if (process.env.NARRATELY_DEBUG === '1') console.error(error);
  process.exit(1);
});
