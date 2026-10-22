#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const customLinter = path.join(__dirname, 'mta-lint.custom.mjs');
const baseLinter = path.join(__dirname, 'mta-lint.mjs');

if (fs.existsSync(customLinter)) {
  console.error('[FATAL] Unauthorized local linter override detected at tools/mta-lint.custom.mjs.');
  console.error('[GOVERNANCE] Per PAT-113 & ANTI-62, modifying or overriding the grading linter is strictly prohibited.');
  console.error('Please delete tools/mta-lint.custom.mjs to restore the baseline linter and submit a bug report to support@menditect.com if you encountered an upstream issue.');
  process.exit(1);
}

if (!fs.existsSync(baseLinter)) {
  console.error(`[ERROR] MTA linter not found at: ${baseLinter}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [baseLinter, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 0);
