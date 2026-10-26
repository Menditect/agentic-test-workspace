#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const customLinter = path.join(__dirname, 'mta-lint.custom.mjs');
const baseLinter = path.join(__dirname, 'mta-lint.mjs');

// PAT-113 / ANTI-62: Pinned normalized (LF) SHA-256 baseline hash for tools/mta-lint.mjs v1.10.0
const EXPECTED_LINTER_SHA256 = '48e5560b8a241c5f5f03446c113e50d3f99a211b6cf83aa7ab7b078dbd67f882';

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

const normalizedLinterContent = fs.readFileSync(baseLinter, 'utf8').replace(/\r\n/g, '\n');
const actualSha256 = crypto.createHash('sha256').update(normalizedLinterContent, 'utf8').digest('hex');
if (actualSha256 !== EXPECTED_LINTER_SHA256) {
  console.error(`[FATAL] [ANTI-62 VIOLATION] Direct modification of vendor linter detected at tools/mta-lint.mjs.`);
  console.error(`Expected SHA-256: ${EXPECTED_LINTER_SHA256}`);
  console.error(`Actual SHA-256  : ${actualSha256}`);
  console.error('[GOVERNANCE] Per PAT-113 & ANTI-62, tools/mta-lint.mjs is strictly immutable read-only vendor software.');
  process.exit(2);
}

const result = spawnSync(process.execPath, [baseLinter, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 0);
