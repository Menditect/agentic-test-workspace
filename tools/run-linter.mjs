#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const customLinter = path.join(__dirname, 'mta-lint.custom.mjs');
const baseLinter = path.join(__dirname, 'mta-lint.mjs');
const targetLinter = fs.existsSync(customLinter) ? customLinter : baseLinter;

if (targetLinter === customLinter) {
  console.log('[NOTICE] Running local custom linter override: tools/mta-lint.custom.mjs\n');
}

if (!fs.existsSync(targetLinter)) {
  console.error(`[ERROR] MTA linter not found at: ${targetLinter}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [targetLinter, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 0);
