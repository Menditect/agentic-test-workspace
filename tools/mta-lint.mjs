#!/usr/bin/env node
/**
 * Menditect Test Automation (MTA) Linter & Verification Tool
 * 
 * Standalone, zero-dependency Node.js ESM tool that validates:
 * 1. Execution Plans (EP_*.md) against canonical MTA schemas and pattern rules (PAT-*, ANTI-*).
 * 2. Post-construction Smoke Audits (4-Phase semantic ledger diff against MTA server JSON).
 * 3. Configuration files (mta_config.json).
 * 
 * Usage:
 *   node tools/mta-lint.mjs plan <path/to/EP_*.md> [--json]
 *   node tools/mta-lint.mjs audit <path/to/EP_*.md> <path/to/server-response.json> [--json]
 *   node tools/mta-lint.mjs config [path/to/mta_config.json] [--json]
 *   node tools/mta-lint.mjs self-test
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';

export const LINTER_VERSION = "1.10.0";
const VERSION = LINTER_VERSION;

// ==========================================
// CLI Argument Dispatcher
// ==========================================
async function main() {
  // PAT-113 / ANTI-62: Vendor Tool Immutability & Custom Override Guard
  const __dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1'));
  const customOverridePath = path.join(__dir, 'mta-lint.custom.mjs');
  if (fs.existsSync(customOverridePath)) {
    console.error('🚨 [ANTI-62 VIOLATION] Unauthorized local linter override detected: tools/mta-lint.custom.mjs');
    console.error('Creating or modifying local linter overrides to bypass MTA quality checks is strictly prohibited under PAT-113 / ANTI-62.');
    console.error('Please delete tools/mta-lint.custom.mjs and fix the Execution Plan or report false positives to support@menditect.com.');
    process.exit(2);
  }

  const args = process.argv.slice(2);
  const command = args[0];
  const isJson = args.includes('--json');

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  if (command === '--version' || command === '-v') {
    console.log(`mta-lint v${VERSION}`);
    process.exit(0);
  }

  try {
    switch (command) {
      case 'lock': {
        const filePath = args[1];
        const force = args.includes('--force');
        const resealWiring = args.includes('--reseal-wiring');
        if (!filePath || filePath.startsWith('--')) {
          console.error("Error: Missing execution plan path. Usage: mta-lint lock <path/to/EP_*.md> [--force] [--reseal-wiring]");
          process.exit(1);
        }
        const result = lockExecutionPlan(filePath, { force, resealWiring });
        outputResult(result, isJson, "Execution Plan Cryptographic Lock Seal");
        process.exit(result.valid ? 0 : 1);
        break;
      }
      case 'verify-lock': {
        const filePath = args[1];
        if (!filePath || filePath.startsWith('--')) {
          console.error("Error: Missing execution plan path. Usage: mta-lint verify-lock <path/to/EP_*.md>");
          process.exit(1);
        }
        const result = verifyLockedExecutionPlan(filePath);
        outputResult(result, isJson, "Execution Plan Lock Verification");
        process.exit(result.valid ? 0 : 1);
        break;
      }
      case 'pre-build': {
        const filePath = args[1];
        if (!filePath || filePath.startsWith('--')) {
          console.error("Error: Missing execution plan path. Usage: mta-lint pre-build <path/to/EP_*.md>");
          process.exit(1);
        }
        const result = verifyPreBuildGate(filePath);
        outputResult(result, isJson, "MTA Pre-Build Human Approval & Placement Gate");
        process.exit(result.valid ? 0 : 1);
        break;
      }
      case 'pre-exec': {
        const filePath = args[1];
        if (!filePath || filePath.startsWith('--')) {
          console.error("Error: Missing execution plan path. Usage: mta-lint pre-exec <path/to/EP_*.md>");
          process.exit(1);
        }
        const result = verifyPreExecGate(filePath);
        outputResult(result, isJson, "MTA Pre-Execution Plan Persistence & Approval Gate (PAT-43, ANTI-46)");
        process.exit(result.valid ? 0 : 1);
        break;
      }
      case 'plan': {
        const filePath = args[1];
        if (!filePath || filePath.startsWith('--')) {
          console.error("Error: Missing execution plan path. Usage: mta-lint plan <path/to/EP_*.md>");
          process.exit(1);
        }
        const result = lintExecutionPlan(filePath);
        outputResult(result, isJson, "Execution Plan Quality & Compliance Audit");
        process.exit(result.valid ? 0 : 1);
        break;
      }
      case 'audit': {
        const planPath = args[1];
        const serverJsonPaths = args.slice(2).filter(a => !a.startsWith('--'));
        if (!planPath || planPath.startsWith('--') || serverJsonPaths.length === 0) {
          console.error("Error: Missing arguments. Usage: mta-lint audit <path/to/EP_*.md> <path/to/server-data1.json> [server-data2.json ...]");
          process.exit(1);
        }
        const result = runSmokeAudit(planPath, serverJsonPaths.length === 1 ? serverJsonPaths[0] : serverJsonPaths);
        outputResult(result, isJson, "MTA Post-Construction 4-Phase Smoke Audit");
        process.exit(result.valid ? 0 : 1);
        break;
      }
      case 'artifacts':
      case 'artifact': {
        const outputDir = args[1] && !args[1].startsWith('--') ? args[1] : 'menditect-output';
        const result = lintArtifacts(outputDir);
        outputResult(result, isJson, "MTA Artifact Traceability Audit (MTA-LINT-E010)");
        process.exit(result.valid ? 0 : 1);
        break;
      }
      case 'config': {
        const configPath = args[1] && !args[1].startsWith('--') ? args[1] : 'mta_config.json';
        const result = lintConfig(configPath);
        outputResult(result, isJson, "MTA Configuration Validation");
        process.exit(result.valid ? 0 : 1);
        break;
      }
      case 'self-test': {
        const result = runSelfTest();
        outputResult(result, isJson, "mta-lint Self-Test Suite");
        process.exit(result.valid ? 0 : 1);
        break;
      }
      default:
        console.error(`Unknown command: '${command}'. Available commands: plan, audit, config, self-test`);
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    if (isJson) {
      console.log(JSON.stringify({ valid: false, fatalError: err.message }, null, 2));
    } else {
      console.error(`Fatal execution error: ${err.message}`);
      if (process.env.DEBUG) console.error(err.stack);
    }
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
Menditect Test Automation Linter (mta-lint v${VERSION})

Commands:
  lock <file> [--force]                Cryptographically seal an Execution Plan (one-way latch)
  verify-lock <file>                   Verify an Execution Plan has not been modified after locking
  pre-build <file> [--json]            Verify Gate 1 human approval & Gate 2 placement before construction
  pre-exec <file> [--json]             Verify persisted plan & approval status before Option A execution
  plan <file> [--json]                 Validate Execution Plan syntax, schema, and pattern rules
  audit <plan-file> <server-json>      Verify constructed MTA server state against plan (4-phase diff)
  artifacts [dir] [--json]             Audit execution outputs against Execution Plan artifacts (MTA-LINT-E010)
  config [path] [--json]               Validate mta_config.json structure and path integrity
  self-test                            Run internal unit tests and rule compliance checks

Options:
  --json                               Output results formatted as JSON
  --version, -v                        Show mta-lint version
  --help, -h                           Show this help message
`);
}

function outputResult(result, isJson, title) {
  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`\n==================================================`);
  console.log(`  ${title}`);
  console.log(`==================================================`);
  if (result.target) console.log(`Target  : ${result.target}`);
  console.log(`Status  : ${result.valid ? 'PASS' : 'FAIL'}`);
  console.log(`Score   : ${result.passedCount}/${result.totalCount} checks passed\n`);

  if (result.checks && result.checks.length > 0) {
    for (const check of result.checks) {
      const mark = check.pass ? '[OK]  ' : '[FAIL]';
      console.log(`  ${mark} ${check.name}`);
      if (!check.pass && check.reason) {
        console.log(`         Reason: ${check.reason}`);
      }
      if (check.details) {
        console.log(`         Details: ${check.details}`);
      }
    }
  }

  if (result.errors && result.errors.length > 0) {
    console.log(`\nIdentified Violations:`);
    for (const err of result.errors) {
      console.log(`  - [${err.code || 'ERROR'}] ${err.message}`);
    }
  }

  if (result.receipt) {
    console.log(`\nAudit Receipt Markdown:`);
    console.log(result.receipt);
  }

  console.log(`--------------------------------------------------\n`);
}

// ==========================================
// Markdown & Table Parser Utilities
// ==========================================

/**
 * Extracts YAML frontmatter or YAML block inside <details><summary>...Metadata...</summary>
 */
function extractMetadata(content) {
  // 1. Standard YAML frontmatter --- ... ---
  const standardMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (standardMatch) {
    return parseSimpleYaml(standardMatch[1]);
  }

  // 2. Collapsible <details> block containing ```yaml ... ```
  const detailsMatch = content.match(/<details[\s\S]*?<summary>[\s\S]*?(?:Metadata|Tracking)[\s\S]*?<\/summary>[\s\S]*?```ya?ml\r?\n([\s\S]*?)\r?\n```[\s\S]*?<\/details>/i);
  if (detailsMatch) {
    return parseSimpleYaml(detailsMatch[1]);
  }

  // 3. Fallback: Any ```yaml block with plan_id
  const anyYamlMatch = content.match(/```ya?ml\r?\n([\s\S]*?plan_id[\s\S]*?)\r?\n```/i);
  if (anyYamlMatch) {
    return parseSimpleYaml(anyYamlMatch[1]);
  }

  return null;
}

function parseYamlScalar(val) {
  if (typeof val !== 'string') return val;
  val = val.trim();
  // Strip trailing comments if any (outside quotes)
  if (!val.startsWith('"') && !val.startsWith("'")) {
    const hashIdx = val.indexOf('#');
    if (hashIdx !== -1) val = val.slice(0, hashIdx).trim();
  }
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  } else if (val === 'true') {
    return true;
  } else if (val === 'false') {
    return false;
  } else if (val === 'null' || val === '~' || val === '') {
    return null;
  } else if (val === '[]') {
    return [];
  } else if (val === '{}') {
    return {};
  } else if (!isNaN(Number(val)) && val !== '') {
    return Number(val);
  }
  return val;
}

function parseSimpleYaml(yamlStr) {
  const meta = {};
  const lines = yamlStr.split(/\r?\n/);
  let currentKey = null;
  let currentArrayKey = null;
  let currentObjKey = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = rawLine.search(/\S/);

    // Array item
    if (trimmed.startsWith('- ')) {
      const itemContent = trimmed.slice(2).trim();
      const targetArrayKey = currentArrayKey || currentKey;
      if (targetArrayKey) {
        if (!Array.isArray(meta[targetArrayKey])) {
          meta[targetArrayKey] = [];
        }
        const colonIdx = itemContent.indexOf(':');
        if (colonIdx !== -1) {
          const itemKey = itemContent.slice(0, colonIdx).trim();
          const itemVal = parseYamlScalar(itemContent.slice(colonIdx + 1).trim());
          const itemObj = { [itemKey]: itemVal };
          meta[targetArrayKey].push(itemObj);

          // Peek following lines that are part of this object
          while (i + 1 < lines.length) {
            const nextRaw = lines[i + 1];
            const nextTrimmed = nextRaw.trim();
            if (!nextTrimmed || nextTrimmed.startsWith('#')) {
              i++;
              continue;
            }
            const nextIndent = nextRaw.search(/\S/);
            if (nextIndent > indent && !nextTrimmed.startsWith('- ')) {
              const nextColon = nextTrimmed.indexOf(':');
              if (nextColon !== -1) {
                const subK = nextTrimmed.slice(0, nextColon).trim();
                const subV = parseYamlScalar(nextTrimmed.slice(nextColon + 1).trim());
                itemObj[subK] = subV;
              }
              i++;
            } else {
              break;
            }
          }
        } else {
          meta[targetArrayKey].push(parseYamlScalar(itemContent));
        }
      }
      continue;
    }

    // Key-value pair
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const rawVal = trimmed.slice(colonIdx + 1).trim();

    if (indent === 0) {
      currentKey = key;
      currentArrayKey = null;
      currentObjKey = null;

      // Check if value is empty -> indicates nested map or array
      let peekIdx = i + 1;
      while (peekIdx < lines.length && (!lines[peekIdx].trim() || lines[peekIdx].trim().startsWith('#'))) {
        peekIdx++;
      }
      if ((rawVal === '' || rawVal === null) && peekIdx < lines.length) {
        const nextTrimmed = lines[peekIdx].trim();
        const nextIndent = lines[peekIdx].search(/\S/);
        if (nextIndent > 0) {
          if (nextTrimmed.startsWith('- ')) {
            currentArrayKey = key;
            meta[key] = [];
          } else {
            currentObjKey = key;
            meta[key] = {};
          }
          continue;
        }
      }
      meta[key] = parseYamlScalar(rawVal);
    } else if (indent > 0 && currentObjKey) {
      meta[currentObjKey][key] = parseYamlScalar(rawVal);
    }
  }

  return meta;
}

/**
 * Parses markdown pipe tables into structured rows and column headers
 */
function parseMarkdownTables(content) {
  const tables = [];
  const lines = content.split(/\r?\n/);
  let currentTable = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('|') && line.endsWith('|')) {
      if (!currentTable) {
        currentTable = { startLine: i + 1, rawLines: [] };
      }
      currentTable.rawLines.push(line);
    } else {
      if (currentTable) {
        if (currentTable.rawLines.length >= 3) {
          tables.push(processTable(currentTable));
        }
        currentTable = null;
      }
    }
  }

  if (currentTable && currentTable.rawLines.length >= 3) {
    tables.push(processTable(currentTable));
  }

  return tables;
}

function processTable(rawTable) {
  const rawLines = rawTable.rawLines;
  const parseRow = (line) => {
    // Strip outer pipes and split by unescaped pipe
    const inner = line.replace(/^\|/, '').replace(/\|$/, '');
    return inner.split('|').map(cell => cell.trim());
  };

  const headers = parseRow(rawLines[0]);
  // row 1 is separator |:---|:---|
  const dataRows = [];
  for (let i = 2; i < rawLines.length; i++) {
    const cells = parseRow(rawLines[i]);
    const rowObj = {};
    headers.forEach((h, idx) => {
      rowObj[h] = cells[idx] !== undefined ? cells[idx] : '';
    });
    rowObj._cells = cells;
    dataRows.push(rowObj);
  }

  return {
    startLine: rawTable.startLine,
    headers,
    rows: dataRows,
    rawLines
  };
}

// ==========================================
// Cryptographic Lock & Tamper Engine (PAT-124, ANTI-78)
// ==========================================

export function computePlanHash(content) {
  // Slice before Section 5 / Section 6 so post-construction receipts in Section 6 never overwrite Section 3/4 tables
  const coreSectionsContent = content.split(/##\s*[56]\.\s*(?:Quality|Pre-Approval|Verification|Build\s*Receipt|Smoke\s*Audit)/i)[0] || content;
  const tables = parseMarkdownTables(coreSectionsContent);
  let stepLedgerTable = null;
  let variationMatrixTable = null;

  for (const t of tables) {
    const headerStr = t.headers.join(' ').toLowerCase();
    if (!stepLedgerTable && (headerStr.includes('step action') || headerStr.includes('output handle') || headerStr.includes('action & target'))) {
      stepLedgerTable = t;
    } else if (!variationMatrixTable && (headerStr.includes('step target') || headerStr.includes('scenario #1') || (headerStr.includes('scenario name') && headerStr.includes('scenario')))) {
      variationMatrixTable = t;
    }
  }

  // Extract anchor if present
  const anchorMatch = content.match(/(?:###\s*🔒?\s*IMMUTABLE_ASSERTION_ANCHOR:\s*([^\r\n]+)|###\s*🔒?\s*IMMUTABLE_ASSERTION_ANCHOR[^\r\n]*\r?\n([^\r\n#]+)|IMMUTABLE_ASSERTION_ANCHOR:\s*([^\r\n]+))/i);
  const anchor = anchorMatch ? (anchorMatch[1] || anchorMatch[2] || anchorMatch[3] || '').trim() : null;

  // Extract Section 3 and Section 4 text fallbacks from coreSectionsContent if present
  const sec3Match = coreSectionsContent.match(/##\s*3\.\s*(?:Test\s*Steps|Master\s*Step)[\s\S]*?(?=##\s*[4-9]\.|$)/i);
  const sec4Match = coreSectionsContent.match(/##\s*4\.\s*(?:Test\s*Scenarios|Target-Bound\s*Data|Data\s*Variation)[\s\S]*?(?=##\s*[5-9]\.|$)/i);

  const canonical = {
    anchor: anchor || null,
    stepHeaders: stepLedgerTable ? stepLedgerTable.headers.map(h => h.trim()) : [],
    stepRows: stepLedgerTable ? stepLedgerTable.rows.map(r => (r._cells || Object.values(r)).map(c => String(c).trim())) : [],
    varHeaders: variationMatrixTable ? variationMatrixTable.headers.map(h => h.trim()) : [],
    varRows: variationMatrixTable ? variationMatrixTable.rows.map(r => (r._cells || Object.values(r)).map(c => String(c).trim())) : [],
    rawSec3: !stepLedgerTable && sec3Match ? sec3Match[0].replace(/\r?\n\s*/g, ' ').trim() : null,
    rawSec4: !variationMatrixTable && sec4Match ? sec4Match[0].replace(/\r?\n\s*/g, ' ').trim() : null
  };

  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function lockExecutionPlan(filePath, options = {}) {
  const force = options.force || false;
  const resealWiring = options.resealWiring || false;
  if (!fs.existsSync(filePath)) {
    return {
      valid: false,
      target: filePath,
      passedCount: 0,
      totalCount: 1,
      checks: [{ name: "File Existence", pass: false, reason: `File not found: ${filePath}` }],
      errors: [{ code: "FILE_NOT_FOUND", message: `Execution plan does not exist at ${filePath}` }]
    };
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const metadata = extractMetadata(content);

  if (metadata && metadata.locked_sha256 && !force) {
    if (!resealWiring) {
      return {
        valid: false,
        target: filePath,
        passedCount: 0,
        totalCount: 1,
        checks: [{ name: "One-Way Cryptographic Latch (PAT-124)", pass: false, reason: `Plan already locked with hash '${metadata.locked_sha256}'. Use --force to overwrite (human only) or --reseal-wiring for verified promotion/wiring repair.` }],
        errors: [{ code: "ALREADY_LOCKED", message: `Execution plan is already locked with hash '${metadata.locked_sha256}'. One-way latch engaged (PAT-124).` }]
      };
    }

    // --reseal-wiring requires an intact IMMUTABLE_ASSERTION_ANCHOR whose target assertion value still matches Section 3/4
    const anchorMatch = content.match(/(?:###\s*🔒?\s*IMMUTABLE_ASSERTION_ANCHOR:\s*([^\r\n]+)|###\s*🔒?\s*IMMUTABLE_ASSERTION_ANCHOR[^\r\n]*\r?\n([^\r\n#]+)|IMMUTABLE_ASSERTION_ANCHOR:\s*([^\r\n]+))/i);
    const anchorStr = anchorMatch ? (anchorMatch[1] || anchorMatch[2] || anchorMatch[3] || '').trim() : null;
    if (!anchorStr) {
      return {
        valid: false,
        target: filePath,
        passedCount: 0,
        totalCount: 1,
        checks: [{ name: "Wiring Re-Seal Anchor Verification (PAT-124)", pass: false, reason: "Cannot use --reseal-wiring without an intact IMMUTABLE_ASSERTION_ANCHOR in Section 1." }],
        errors: [{ code: "MISSING_ASSERTION_ANCHOR", message: "--reseal-wiring requires an intact IMMUTABLE_ASSERTION_ANCHOR in Section 1." }]
      };
    }
    const assertTokens = [...anchorStr.matchAll(/ASSERT_([A-Z_]+)\s*=\s*([^\r\n|]+)/gi)].map(m => ({
      type: m[1].trim().toUpperCase(),
      val: m[2].trim().replace(/^['"`]|['"`]$/g, '')
    }));
    const coreSectionsContent = content.split(/##\s*[56]\.\s*(?:Quality|Pre-Approval|Verification|Build\s*Receipt|Smoke\s*Audit)/i)[0] || content;
    const coreTables = parseMarkdownTables(coreSectionsContent);
    let stepLedgerTable = null;
    let variationMatrixTable = null;
    for (const t of coreTables) {
      const headerStr = t.headers.join(' ').toLowerCase();
      if (!stepLedgerTable && (headerStr.includes('step action') || headerStr.includes('output handle') || headerStr.includes('action & target'))) {
        stepLedgerTable = t;
      } else if (!variationMatrixTable && (headerStr.includes('step target') || headerStr.includes('scenario #1') || (headerStr.includes('scenario name') && headerStr.includes('scenario')))) {
        variationMatrixTable = t;
      }
    }

    const assertionTexts = [];
    if (stepLedgerTable) {
      const assertColIdx = stepLedgerTable.headers.findIndex(h => /assert/i.test(h));
      for (const row of stepLedgerTable.rows) {
        const cells = row._cells || Object.values(row);
        if (assertColIdx !== -1 && cells[assertColIdx] !== undefined) {
          assertionTexts.push(String(cells[assertColIdx]));
        } else if (cells[6] !== undefined) {
          assertionTexts.push(String(cells[6]));
        }
      }
    }
    if (variationMatrixTable) {
      for (const row of variationMatrixTable.rows) {
        const cells = row._cells || Object.values(row);
        const rowTarget = String(cells[0] || '');
        if (/assert|validation|feedback|return\s*value/i.test(rowTarget)) {
          assertionTexts.push(cells.slice(1).join(' | '));
        }
      }
    }
    const combinedAssertionSurface = assertionTexts.join(' | ');
    for (const tok of assertTokens) {
      if (tok.val && !combinedAssertionSurface.includes(tok.val)) {
        return {
          valid: false,
          target: filePath,
          passedCount: 0,
          totalCount: 1,
          checks: [{ name: "Wiring Re-Seal Assertion Integrity (ANTI-78)", pass: false, reason: `Anchored assertion value '${tok.val}' (ASSERT_${tok.type}) was removed or altered in Section 3 Embedded Assertions / Section 4 assertion rows! --reseal-wiring cannot weaken or alter the oracle assertion (ANTI-78).` }],
          errors: [{ code: "LOCKED_TEST_TAMPERED", message: `Anchored assertion value '${tok.val}' missing from Section 3 Embedded Assertions / Section 4 assertion rows during --reseal-wiring (ANTI-78).` }]
        };
      }
    }
  }

  const hash = computePlanHash(content);
  const updatedContent = injectLockedHash(content, hash);
  fs.writeFileSync(filePath, updatedContent, 'utf-8');

  return {
    valid: true,
    target: filePath,
    passedCount: 2,
    totalCount: 2,
    hash,
    checks: [
      { name: "One-Way Cryptographic Latch (PAT-124)", pass: true },
      { name: "Test Hash Computed & Sealed (SHA-256)", pass: true, details: { hash } }
    ],
    errors: []
  };
}

export function verifyLockedExecutionPlan(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      valid: false,
      target: filePath,
      passedCount: 0,
      totalCount: 1,
      checks: [{ name: "File Existence", pass: false, reason: `File not found: ${filePath}` }],
      errors: [{ code: "FILE_NOT_FOUND", message: `Execution plan does not exist at ${filePath}` }]
    };
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const metadata = extractMetadata(content);

  if (!metadata || !metadata.locked_sha256) {
    return {
      valid: false,
      target: filePath,
      passedCount: 0,
      totalCount: 1,
      checks: [{ name: "Lock Presence", pass: false, reason: "Missing 'locked_sha256' in plan metadata" }],
      errors: [{ code: "NOT_LOCKED", message: `Execution plan is not locked (missing locked_sha256 in metadata)` }]
    };
  }

  const currentHash = computePlanHash(content);
  const expectedHash = metadata.locked_sha256;
  const isMatch = currentHash === expectedHash;

  return {
    valid: isMatch,
    target: filePath,
    passedCount: isMatch ? 1 : 0,
    totalCount: 1,
    hash: currentHash,
    expectedHash,
    checks: [
      {
        name: "Cryptographic Lock Verification (PAT-124, ANTI-78)",
        pass: isMatch,
        reason: isMatch ? null : `Test plan tampered! Sealed hash: ${expectedHash}, Current hash: ${currentHash}`,
        details: { sealedHash: expectedHash, currentHash }
      }
    ],
    errors: isMatch ? [] : [
      {
        code: "LOCKED_TEST_TAMPERED",
        message: `Locked test plan was modified after sealing! Modifying a locked test is strictly prohibited (ANTI-78). Expected: ${expectedHash}, Got: ${currentHash}`
      }
    ]
  };
}

function injectLockedHash(content, hash) {
  // 1. Standard YAML frontmatter --- ... ---
  if (/^---\r?\n[\s\S]*?\r?\n---/.test(content)) {
    return content.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (match, yamlBody) => {
      let updatedYaml = yamlBody;
      if (/locked_sha256:/i.test(updatedYaml)) {
        updatedYaml = updatedYaml.replace(/locked_sha256:.*$/m, `locked_sha256: "${hash}"`);
      } else {
        updatedYaml = updatedYaml.trimEnd() + `\nprotection_level: "locked"\nlocked_sha256: "${hash}"`;
      }
      if (/protection_level:/i.test(updatedYaml)) {
        updatedYaml = updatedYaml.replace(/protection_level:.*$/m, `protection_level: "locked"`);
      }
      return `---\n${updatedYaml}\n---`;
    });
  }

  // 2. <details> with ```yaml
  if (/<details[\s\S]*?```ya?ml\r?\n([\s\S]*?)\r?\n```[\s\S]*?<\/details>/i.test(content)) {
    return content.replace(/(<details[\s\S]*?```ya?ml\r?\n)([\s\S]*?)(\r?\n```[\s\S]*?<\/details>)/i, (match, prefix, yamlBody, suffix) => {
      let updatedYaml = yamlBody;
      if (/locked_sha256:/i.test(updatedYaml)) {
        updatedYaml = updatedYaml.replace(/locked_sha256:.*$/m, `locked_sha256: "${hash}"`);
      } else {
        updatedYaml = updatedYaml.trimEnd() + `\nprotection_level: "locked"\nlocked_sha256: "${hash}"`;
      }
      if (/protection_level:/i.test(updatedYaml)) {
        updatedYaml = updatedYaml.replace(/protection_level:.*$/m, `protection_level: "locked"`);
      }
      return `${prefix}${updatedYaml}${suffix}`;
    });
  }

  // 3. Fallback: prepend YAML frontmatter
  return `---\nprotection_level: "locked"\nlocked_sha256: "${hash}"\n---\n\n${content}`;
}

// ==========================================
// Pre-Build Verification Engine (mta-lint pre-build)
// ==========================================
export function verifyPreBuildGate(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      valid: false,
      target: filePath,
      passedCount: 0,
      totalCount: 1,
      checks: [{ name: "File Existence", pass: false, reason: `File not found: ${filePath}` }],
      errors: [{ code: "FILE_NOT_FOUND", message: `Execution plan does not exist at ${filePath}` }]
    };
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const metadata = extractMetadata(content);

  const checks = [];
  const errors = [];

  const addCheck = (name, pass, reason = null, code = null, details = null) => {
    checks.push({ name, pass, reason, details });
    if (!pass) {
      errors.push({ code: code || 'CHECK_FAILED', message: reason });
    }
  };

  if (!metadata) {
    addCheck("Metadata Block Present", false, "Missing metadata block", "MISSING_METADATA");
    return {
      valid: false,
      target: filePath,
      passedCount: 0,
      totalCount: 1,
      checks,
      errors
    };
  }

  // 1. Status is APPROVED
  const isApproved = metadata.status === 'APPROVED';
  addCheck(
    "Plan Approval Status (Gate 1)",
    isApproved,
    isApproved ? null : `Execution plan status is '${metadata.status || 'UNDEFINED'}'. Persistent MTA platform construction requires explicit user approval (status: 'APPROVED'). Halting per PAT-43 / ANTI-56.`,
    "PLAN_NOT_APPROVED"
  );

  // 2. Approved By and Approved At
  const hasApprovedBy = !!metadata.approved_by && String(metadata.approved_by).trim().length > 0;
  const hasApprovedAt = !!metadata.approved_at && String(metadata.approved_at).trim().length > 0;
  addCheck(
    "Approval Provenance (approved_by & approved_at)",
    hasApprovedBy && hasApprovedAt,
    (hasApprovedBy && hasApprovedAt) ? null : "Missing approval provenance (approved_by and approved_at must be populated when status is 'APPROVED')",
    "MISSING_APPROVAL_PROVENANCE"
  );

  // 3. Target Configuration Key (numeric > 0, strictly non-null / non-boolean / non-empty)
  const rawConfigKey = metadata.target_configuration_key;
  const isNonEmptyConfigVal = rawConfigKey !== null && rawConfigKey !== undefined && typeof rawConfigKey !== 'boolean' && String(rawConfigKey).trim() !== '';
  const configKey = isNonEmptyConfigVal ? Number(rawConfigKey) : NaN;
  const validConfig = !isNaN(configKey) && configKey > 0;
  addCheck(
    "Target Configuration Placement (Gate 2)",
    validConfig,
    validConfig ? null : `Invalid or missing target_configuration_key: '${rawConfigKey}'. Gate 2 placement discovery required.`,
    "INVALID_CONFIGURATION_KEY"
  );

  // 4. Target Suite Key (numeric > 0 or "NEW_SUITE" with non-empty target_suite, strictly non-null / non-boolean / non-empty)
  const suiteKey = metadata.target_suite_key;
  const isNonEmptySuiteVal = suiteKey !== null && suiteKey !== undefined && typeof suiteKey !== 'boolean' && String(suiteKey).trim() !== '';
  const rawSuiteName = metadata.target_suite !== null && metadata.target_suite !== undefined ? String(metadata.target_suite).trim() : '';
  const hasValidNewSuiteName = rawSuiteName.length > 0 && !/^<.*>$|^null$|^tbd$/i.test(rawSuiteName);
  const validSuite = (suiteKey === "NEW_SUITE" && hasValidNewSuiteName) || (isNonEmptySuiteVal && !isNaN(Number(suiteKey)) && Number(suiteKey) > 0);
  addCheck(
    "Target Test Suite Placement (Gate 2)",
    validSuite,
    validSuite ? null : `Invalid or missing target_suite_key: '${metadata.target_suite_key}' (must be integer > 0, or 'NEW_SUITE' with non-empty target_suite; 0 is prohibited). Gate 2 placement discovery required.`,
    "INVALID_SUITE_KEY"
  );

  // 5. Post-Green TDBF Lock Integrity Gate (PAT-124, ANTI-78)
  if (metadata.test_intent === 'bug_reproduction' && metadata.verified_at) {
    const isLockedAttr = metadata.protection_level === 'locked' && !!metadata.locked_sha256;
    const lockRes = isLockedAttr ? verifyLockedExecutionPlan(filePath) : { valid: false, errors: [{ message: "Post-green bug_reproduction plan must have protection_level: 'locked' and valid locked_sha256" }] };
    addCheck(
      "TDBF Oracle Lock Integrity (PAT-124, ANTI-78)",
      lockRes.valid,
      lockRes.valid ? null : (lockRes.errors[0]?.message || "Locked oracle test verification failed before Option B build"),
      "LOCKED_TEST_TAMPERED"
    );
  }

  const valid = checks.every(c => c.pass);
  return {
    valid,
    target: filePath,
    passedCount: checks.filter(c => c.pass).length,
    totalCount: checks.length,
    checks,
    errors
  };
}

function evaluateAutoApprovedGuard(metadata, content = '') {
  const reasons = [];
  const rollbackStr = metadata.rollback !== undefined && metadata.rollback !== null ? String(metadata.rollback).trim().toLowerCase() : null;
  if (rollbackStr !== null && rollbackStr !== 'yes') {
    reasons.push(`rollback is '${metadata.rollback}' (auto-execution requires rollback: 'Yes' with zero live database mutation)`);
  }
  if (metadata.category !== 'Backend') {
    reasons.push(`category is '${metadata.category}' (only Backend in-memory tests can auto-execute; Frontend requires MTA Platform Gate 1 & Gate 2 approval per PAT-62)`);
  }
  const execTarget = metadata.execution_target !== undefined && metadata.execution_target !== null ? String(metadata.execution_target).trim() : null;
  if (execTarget !== null && execTarget !== 'MTA_plugin') {
    reasons.push(`execution_target is '${metadata.execution_target}' (persistent MTA Platform mutations cannot auto-execute per ANTI-56)`);
  }
  const intent = metadata.test_intent ? String(metadata.test_intent).trim() : null;
  if (intent === 'bug_reproduction') {
    reasons.push("test_intent is 'bug_reproduction' (requires Checkpoint 1 Case 6 human approval per PAT-124)");
  } else if (intent === 'data_seeding') {
    reasons.push("test_intent is 'data_seeding' (live data seeding requires explicit user approval)");
  } else if ((intent === 'exploratory_feature' || intent === 'tdd') && metadata.spec_source && metadata.spec_source.type === 'prompt_spec') {
    reasons.push(`test_intent is '${intent}' with spec_source.type='prompt_spec' (Conservative Gate requires human confirmation of inferred requirements at Checkpoint 1)`);
  }
  return {
    allowed: reasons.length === 0,
    reasons
  };
}

export function verifyPreExecGate(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      valid: false,
      target: filePath,
      passedCount: 0,
      totalCount: 1,
      checks: [{ name: "File Existence (PAT-43, ANTI-46)", pass: false, reason: `File not found: ${filePath}` }],
      errors: [{ code: "FILE_NOT_FOUND", message: `Execution plan does not exist at ${filePath}. Calling execute-testcase without a persisted EP_*.md file is strictly prohibited (ANTI-46).` }]
    };
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const metadata = extractMetadata(content);

  const checks = [];
  const errors = [];

  const addCheck = (name, pass, reason = null, code = null, details = null) => {
    checks.push({ name, pass, reason, details });
    if (!pass) {
      errors.push({ code: code || 'CHECK_FAILED', message: reason });
    }
  };

  const baseName = path.basename(filePath);
  const validFileName = /^EP_[A-Za-z0-9_.-]+\.md$/i.test(baseName);
  addCheck(
    "Canonical EP_*.md Filename (PAT-43)",
    validFileName,
    validFileName ? null : `Execution plan filename '${baseName}' must match 'EP_<TestCaseName>.md'`,
    "INVALID_EP_FILENAME"
  );

  if (!metadata) {
    addCheck("Metadata Block Present", false, "Missing metadata block", "MISSING_METADATA");
    return {
      valid: false,
      target: filePath,
      passedCount: checks.filter(c => c.pass).length,
      totalCount: checks.length,
      checks,
      errors
    };
  }

  const allowedStatuses = ['AUTO_APPROVED', 'APPROVED', 'BUILT_AND_VERIFIED'];
  const statusOk = allowedStatuses.includes(metadata.status);
  addCheck(
    "Execution Approval Status (PAT-43, ANTI-46)",
    statusOk,
    statusOk ? null : `Execution plan status is '${metadata.status || 'UNDEFINED'}'. In-memory Option A execution requires status in [${allowedStatuses.join(', ')}] (ANTI-46).`,
    "PLAN_NOT_EXECUTABLE"
  );

  // Validate provenance for APPROVED / BUILT_AND_VERIFIED, and enforce strict scope guards on AUTO_APPROVED
  if (metadata.status === 'APPROVED' || metadata.status === 'BUILT_AND_VERIFIED') {
    const hasApprovedBy = !!metadata.approved_by && String(metadata.approved_by).trim().length > 0;
    const hasApprovedAt = !!metadata.approved_at && String(metadata.approved_at).trim().length > 0;
    addCheck(
      "Approval Provenance (approved_by & approved_at)",
      hasApprovedBy && hasApprovedAt,
      (hasApprovedBy && hasApprovedAt) ? null : `Missing approval provenance (approved_by and approved_at must be populated when status is '${metadata.status}')`,
      "MISSING_APPROVAL_PROVENANCE"
    );
  } else if (metadata.status === 'AUTO_APPROVED') {
    const autoGuard = evaluateAutoApprovedGuard(metadata, content);
    addCheck(
      "AUTO_APPROVED Execution Guard (PAT-43, ANTI-46, ANTI-56)",
      autoGuard.allowed,
      autoGuard.allowed ? null : `status 'AUTO_APPROVED' is prohibited: ${autoGuard.reasons.join('; ')}. Explicit human approval (status: 'APPROVED') is required.`,
      "AUTO_APPROVE_FORBIDDEN"
    );
  }

  // Run structural plan lint checks
  const planRes = lintExecutionPlan(filePath);
  addCheck(
    "Execution Plan Structural & Pattern Compliance",
    planRes.valid,
    planRes.valid ? null : `Plan failed ${planRes.errors.length} lint check(s): ${planRes.errors.map(e => e.message).join('; ')}`,
    "PLAN_LINT_FAILED",
    `${planRes.passedCount}/${planRes.totalCount} plan checks passed`
  );

  const valid = checks.every(c => c.pass);
  return {
    valid,
    target: filePath,
    passedCount: checks.filter(c => c.pass).length,
    totalCount: checks.length,
    checks,
    errors
  };
}

// ==========================================
// Execution Plan Linter Engine (mta-lint plan)
// ==========================================
export function lintExecutionPlan(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      valid: false,
      target: filePath,
      passedCount: 0,
      totalCount: 1,
      checks: [{ name: "File Existence", pass: false, reason: `File not found: ${filePath}` }],
      errors: [{ code: "FILE_NOT_FOUND", message: `Execution plan does not exist at ${filePath}` }]
    };
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const metadata = extractMetadata(content);
  const tables = parseMarkdownTables(content);

  const checks = [];
  const errors = [];

  const addCheck = (name, pass, reason = null, code = null, details = null) => {
    checks.push({ name, pass, reason, details });
    if (!pass) {
      errors.push({ code: code || 'CHECK_FAILED', message: reason });
    }
  };

  // 1. Metadata Verification
  if (!metadata) {
    addCheck("Metadata Block Present", false, "Missing metadata block (either YAML frontmatter or <details> with YAML)", "MISSING_METADATA");
  } else {
    addCheck("Metadata Block Present", true);
    addCheck("Plan ID Specified", !!metadata.plan_id, "Missing 'plan_id' in metadata", "MISSING_PLAN_ID");
    addCheck("Category Specified", ['Backend', 'Frontend'].includes(metadata.category), `Category must be 'Backend' or 'Frontend', found: '${metadata.category}'`, "INVALID_CATEGORY");

    // Approval Status & Provenance (PLAN-STATUS-DRAFT-ON-CREATION)
    if (metadata.status === 'APPROVED' || metadata.status === 'BUILT_AND_VERIFIED') {
      const hasApprovedBy = !!metadata.approved_by && String(metadata.approved_by).trim().length > 0;
      const hasApprovedAt = !!metadata.approved_at && String(metadata.approved_at).trim().length > 0;
      addCheck(
        "Plan Status Approval Provenance (PAT-43, ANTI-56)",
        hasApprovedBy && hasApprovedAt,
        (hasApprovedBy && hasApprovedAt) ? null : `Plan marked as ${metadata.status} without valid approval provenance (approved_by and approved_at must be non-empty)`,
        "PLAN-STATUS-DRAFT-ON-CREATION"
      );
    } else if (metadata.status === 'AUTO_APPROVED') {
      const autoGuard = evaluateAutoApprovedGuard(metadata, content);
      if (!autoGuard.allowed) {
        addCheck(
          "AUTO_APPROVED Scope Guard (PAT-43, ANTI-46, ANTI-56)",
          false,
          `Plan cannot use status 'AUTO_APPROVED' when: ${autoGuard.reasons.join('; ')}.`,
          "AUTO_APPROVE_FORBIDDEN"
        );
      } else {
        addCheck("AUTO_APPROVED Scope Guard (PAT-43, ANTI-46, ANTI-56)", true);
      }
    } else if (metadata.status && !['DRAFT', 'REJECTED'].includes(metadata.status)) {
      addCheck(
        "Plan Status Valid Value",
        false,
        `Invalid status '${metadata.status}'. Must be DRAFT, APPROVED, REJECTED, AUTO_APPROVED, or BUILT_AND_VERIFIED.`,
        "INVALID_PLAN_STATUS"
      );
    }
  }

  // 2. Sections Discovery
  const hasSection1 = /##\s*1\.\s*(?:Purpose\s*&|Test\s*Objectives|Placement)/i.test(content);
  const hasSection2 = /##\s*2\.\s*(?:Component\s*Under\s*Test|Target\s*Component|Verified\s*Model)/i.test(content);
  const hasSection3 = /##\s*3\.\s*(?:Test\s*Steps|Master\s*Step)/i.test(content) || /Section\s*5:\s*Master\s*Step/i.test(content);
  const hasSection4 = /##\s*4\.\s*(?:Test\s*Scenarios|Target-Bound\s*Data|Data\s*Variation)/i.test(content) || /Section\s*6:\s*(?:Target-Bound\s*Data|Data\s*Variation)/i.test(content);
  const hasSection5 = /##\s*5\.\s*(?:Quality\s*&|Pre-Approval|Pre-Approval\s*Quality)/i.test(content) || /Section\s*7:\s*Pre-Approval/i.test(content);

  addCheck("Section 1: Purpose & Scope Present", hasSection1, "Section 1 (Purpose & Scope / Test Objectives) missing", "MISSING_SEC_1");
  addCheck("Section 2: Component Under Test Present", hasSection2, "Section 2 (Component Under Test / AST Summary) missing", "MISSING_SEC_2");
  addCheck("Section 3: Test Steps & Action Sequence Present", hasSection3, "Section 3 (Test Steps / Master Step Ledger) missing", "MISSING_SEC_3");
  addCheck("Section 4: Test Scenarios & Test Data Present", hasSection4, "Section 4 (Test Scenarios / Data Variation Matrix) missing", "MISSING_SEC_4");
  addCheck("Section 5: Quality & Compliance Checks Present", hasSection5, "Section 5 (Quality & Compliance / Pre-Approval Verification) missing", "MISSING_SEC_5");

  // 3. Find Master Step Specification Ledger
  let stepLedgerTable = null;
  let variationMatrixTable = null;

  for (const t of tables) {
    const headerStr = t.headers.join(' ').toLowerCase();
    if (!stepLedgerTable && (headerStr.includes('step action') || headerStr.includes('output handle') || headerStr.includes('action & target'))) {
      stepLedgerTable = t;
    } else if (!variationMatrixTable && (headerStr.includes('step target') || headerStr.includes('scenario #1') || (headerStr.includes('scenario name') && headerStr.includes('scenario')))) {
      variationMatrixTable = t;
    }
  }

  // Validate Master Step Ledger
  if (!stepLedgerTable) {
    addCheck("Master Step Specification Ledger Table Found", false, "Could not find Master Step Specification table in document", "MISSING_STEP_LEDGER");
  } else {
    addCheck("Master Step Specification Ledger Table Found", true);

    // Check required columns (PAT-111, Unified Promotable Blueprint)
    const isBackendUnit = metadata && metadata.category === 'Backend';
    const hHeaders = stepLedgerTable.headers.map(h => h.toLowerCase());

    const hasInput = hHeaders.some(h => /input|\bin\b/i.test(h));
    const hasOutput = hHeaders.some(h => /output|\bout\b/i.test(h));
    const hasParams = hHeaders.some(h => /parameter|binding|value|initial/i.test(h));
    const hasSettings = hHeaders.some(h => /setting|exec/i.test(h));
    const hasCase = hHeaders.some(h => /\bcase\b/i.test(h));

    const missingCols = [];
    if (!hasInput) missingCols.push('input');
    if (!hasOutput) missingCols.push('output');
    if (!hasParams) missingCols.push('parameters');
    if (!hasSettings) missingCols.push('settings');
    if (!isBackendUnit && !hasCase) missingCols.push('case');

    if (missingCols.length > 0) {
      addCheck("Step Ledger Required Columns", false, `Missing required columns matching: ${missingCols.join(', ')}`, "INCOMPLETE_LEDGER_COLUMNS");
    } else {
      addCheck("Step Ledger Required Columns", true);
    }

    // Step Rules Validation
    validateStepLedgerRules(stepLedgerTable, metadata, addCheck);
    validatePipedRetrieveObjectCount(stepLedgerTable, addCheck);
  }

  // Validate Target-Bound Data Variation Matrix
  if (!variationMatrixTable) {
    addCheck("Data Variation Matrix Table Found", false, "Could not find Data Variation Matrix table in document", "MISSING_VARIATION_MATRIX");
  } else {
    addCheck("Data Variation Matrix Table Found", true);
    validateVariationMatrix(variationMatrixTable, addCheck);
  }

  // 3b. Cross-Table Semantic Audit: PAT-07 Empty-Guard & Null-Boundary Verification
  if (stepLedgerTable && variationMatrixTable) {
    validatePat07EmptyBoundaries(stepLedgerTable, variationMatrixTable, metadata, addCheck);
  }

  // 3c. DateTime & DatePicker Format Audit (PAT-94, PAT-42, ANTI-45, ANTI-53)
  validateDateTimeAndDatePickerFormats(content, stepLedgerTable, variationMatrixTable, metadata, tables, addCheck);

  // 3d. Frontend Validation Feedback Assertions (PAT-119, ANTI-20, PAT-12)
  validateFrontendValidationFeedback(content, stepLedgerTable, metadata, addCheck);

  // 3e. Frontend High-Level Locator Generator Mandate (PAT-64, ANTI-79)
  validateFrontendLocatorTools(content, stepLedgerTable, metadata, addCheck);

  // 3e-2. Frontend Session Startup & Authentication Mandate (PAT-125, ANTI-81)
  validateFrontendAuthenticationStartup(content, stepLedgerTable, metadata, addCheck);

  // 3f. Intent Classification & Ground Truth Traceability (PAT-121, ANTI-68..ANTI-72)
  validateIntentAndGroundTruth(metadata, content, stepLedgerTable, variationMatrixTable, addCheck);
  // 3g. Cryptographic Lock Verification (PAT-124, ANTI-78)
  if (metadata && metadata.locked_sha256) {
    const isSupersededDraftRevision = metadata.status === 'DRAFT' && Number(metadata.revision) > 1 && !!metadata.supersedes_plan_id;
    if (isSupersededDraftRevision) {
      addCheck(
        "PAT-124: Superseded Draft Revision (Pre-Relock)",
        true,
        null,
        null,
        `Draft revision ${metadata.revision} superseding ${metadata.supersedes_plan_id} (ready for mta-lint lock)`
      );
    } else {
      const lockRes = verifyLockedExecutionPlan(filePath);
      addCheck(
        "PAT-124: Cryptographic Lock Verification",
        lockRes.valid,
        lockRes.valid ? null : (lockRes.errors[0]?.message || "Locked test plan tampered"),
        "LOCKED_TEST_TAMPERED",
        lockRes.valid ? `Hash verified: ${lockRes.hash}` : "Tamper detected"
      );
    }
  }


  // 4. Negative Anti-Pattern Scans
  scanAntiPatterns(content, stepLedgerTable, variationMatrixTable, addCheck);

  const passedCount = checks.filter(c => c.pass).length;
  const totalCount = checks.length;
  const valid = errors.length === 0;

  return {
    valid,
    target: path.basename(filePath),
    filePath,
    passedCount,
    totalCount,
    checks,
    errors
  };
}

function validateStepLedgerRules(table, metadata, addCheck) {
  const isBackend = !metadata || metadata.category === 'Backend';
  let previousAction = null;
  let previousOutputHandle = null;
  let hasPat06Violation = false;
  let hasCreateObject = false;
  let hasInvalidCreateInputHandle = false;

  for (let idx = 0; idx < table.rows.length; idx++) {
    const row = table.rows[idx];
    const rowText = Object.values(row).join(' ');

    // Rule: PAT-06 Direct Attribute Init on CreateObject
    // Consecutive ChangeObject immediately following CreateObject on same handle is prohibited (ANTI-01)
    const isCreate = /CreateObject/i.test(rowText);
    const isChange = /ChangeObject/i.test(rowText);

    if (isCreate) {
      hasCreateObject = true;
      previousAction = 'CreateObject';
      // attempt to identify handle
      const outHandleCol = Object.keys(row).find(k => k.toLowerCase().includes('output'));
      previousOutputHandle = outHandleCol ? row[outHandleCol].replace(/[`\s]/g, '') : null;

      // Rule: CreateObject has no Input Handle (Input Handle must be '-')
      const inHandleCol = Object.keys(row).find(k => (k.toLowerCase().includes('input') || k.toLowerCase() === 'in') && !k.toLowerCase().includes('binding') && !k.toLowerCase().includes('initial'));
      const inHandle = inHandleCol ? (row[inHandleCol] || '').replace(/[`\s]/g, '') : '';
      if (inHandle && inHandle !== '-' && inHandle.toLowerCase() !== 'none' && inHandle.toLowerCase() !== 'n/a') {
        addCheck(
          "PAT-06: CreateObject Input Handle Restriction",
          false,
          `Step ${idx + 1} (CreateObject) specifies invalid Input Handle '${inHandle}'. CreateObject instantiates a new entity in memory and does not accept an input handle (Input Handle must be '-'). Associations to other objects must be specified in the 'Parameters, Bindings & Initial Values' column (e.g. 'Car_CarSize = ${inHandle}').`,
          "INVALID_CREATE_OBJECT_INPUT_HANDLE"
        );
        hasInvalidCreateInputHandle = true;
      }
    } else if (isChange) {
      const inHandleCol = Object.keys(row).find(k => k.toLowerCase().includes('input'));
      const inHandle = inHandleCol ? row[inHandleCol].replace(/[`\s]/g, '') : null;
      if (previousAction === 'CreateObject' && inHandle && previousOutputHandle && inHandle === previousOutputHandle) {
        addCheck("PAT-06: Direct Attribute Init on CreateObject", false, `Row ${idx + 1} has ChangeObject immediately following CreateObject for handle '${inHandle}'. Initial attributes must be set directly on CreateObject.`, "ANTI-01_VIOLATION");
        hasPat06Violation = true;
      }
      previousAction = 'ChangeObject';
    } else {
      previousAction = 'Other';
    }

    // Settings rule for backend unit tests (None / Stop), allowing Always / _Continue on Backend Integration teardown steps
    const isBackendIntegration = isBackend && metadata && (
      String(metadata.test_type || '').toLowerCase() === 'integration' ||
      String(metadata.rollback || '').toLowerCase() === 'no'
    );
    if (isBackend) {
      const settingsCol = Object.keys(row).find(k => k.toLowerCase().includes('settings') || k.toLowerCase().includes('exec'));
      if (settingsCol && row[settingsCol]) {
        const val = row[settingsCol];
        const isTeardownStep = /(?:DeleteObject|Persist|Teardown)/i.test(rowText) || /Case\s*3/i.test(rowText);
        if (/Always/i.test(val) && !/None/i.test(val) && !(isBackendIntegration && isTeardownStep)) {
          addCheck(`Step ${idx + 1} Backend Execution Settings`, false, `Backend unit tests must use 'None / Stop', found: '${val}'`, "INVALID_EXEC_SETTINGS");
        }
      }
    }
  }

  // Record PAT-06 check if no violation was recorded
  if (!hasPat06Violation) {
    addCheck("PAT-06: Direct Attribute Init on CreateObject", true);
  }
  if (hasCreateObject && !hasInvalidCreateInputHandle) {
    addCheck("PAT-06: CreateObject Input Handle Restriction", true);
  }
}

/**
 * Rule: PAT-08 & ANTI-03: Retrieve Output Object Count Assertion
 * Any Retrieve Object step that pipes its output handle into downstream teststeps
 * (microflow parameters, change/delete actions, associations, etc.) MUST embed
 * an Assert Object Count assertion to guarantee object existence and prevent
 * silent downstream null-pointer or parameter-unbound errors.
 */
function validatePipedRetrieveObjectCount(table, addCheck) {
  let hasAnti03Violation = false;
  let totalPipedRetrieves = 0;

  const cleanAction = (str) => String(str).replace(/[`*_]/g, '').trim().split('\n')[0];

  for (let idx = 0; idx < table.rows.length; idx++) {
    const row = table.rows[idx];
    const rowText = Object.values(row).join(' ');

    const actionCol = Object.keys(row).find(k => k.toLowerCase().includes('action') || k.toLowerCase().includes('target'));
    const actionVal = actionCol ? row[actionCol] : rowText;
    const isRetrieve = /Retrieve(?:Object|Objects)?/i.test(actionVal);

    if (!isRetrieve) continue;

    // Retrieve output handle
    const outHandleCol = Object.keys(row).find(k => k.toLowerCase().includes('output'));
    const outHandle = outHandleCol ? (row[outHandleCol] || '').replace(/[`\s]/g, '') : null;

    if (!outHandle || outHandle === '-' || outHandle.toLowerCase() === 'none') {
      continue;
    }

    // Check downstream consumption
    let isPipedDownstream = false;
    let downstreamStepNumber = null;

    const escapedHandle = outHandle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const handleRegex = new RegExp(`\\b${escapedHandle}\\b`);

    for (let j = idx + 1; j < table.rows.length; j++) {
      const downRow = table.rows[j];
      const downInCol = Object.keys(downRow).find(k => k.toLowerCase().includes('input'));
      const downInVal = downInCol ? (downRow[downInCol] || '').replace(/[`\s]/g, '') : '';
      const downInList = downInVal.split(',').map(s => s.trim());

      const downParamCol = Object.keys(downRow).find(k => k.toLowerCase().includes('param') || k.toLowerCase().includes('binding') || k.toLowerCase().includes('initial'));
      const downParamVal = downParamCol ? downRow[downParamCol] || '' : '';

      if (downInList.includes(outHandle) || handleRegex.test(downInVal) || handleRegex.test(downParamVal)) {
        isPipedDownstream = true;
        downstreamStepNumber = j + 1;
        break;
      }
    }

    if (isPipedDownstream) {
      totalPipedRetrieves++;
      const assertCol = Object.keys(row).find(k => k.toLowerCase().includes('assert'));
      const assertVal = assertCol ? row[assertCol] || '' : '';
      const hasCountAssert = /(?:Assert\s+(?:Object\s+)?Count|Object\s+Count)/i.test(assertVal) ||
                             /(?:Assert\s+(?:Object\s+)?Count|Object\s+Count)/i.test(rowText);

      if (!hasCountAssert) {
        addCheck(
          "PAT-08 & ANTI-03: Retrieve Output Object Count Assertion",
          false,
          `Step ${idx + 1} (${cleanAction(actionVal)}) provides output handle '${outHandle}' to downstream step ${downstreamStepNumber}, but lacks an embedded Assert Object Count assertion (ANTI-03). Retrieve steps that pipe output must verify existence with Assert Object Count.`,
          "ANTI-03_VIOLATION"
        );
        hasAnti03Violation = true;
      }
    }
  }

  if (!hasAnti03Violation) {
    addCheck(
      "PAT-08 & ANTI-03: Retrieve Output Object Count Assertion",
      true,
      null,
      null,
      totalPipedRetrieves > 0 ? `${totalPipedRetrieves} piped retrieve step(s) verified with Assert Object Count` : "No unasserted piped retrieve outputs detected"
    );
  }
}

/**
 * Validates DateTime & DatePicker Formats (PAT-42, PAT-94, ANTI-45, ANTI-53).
 * 1. General / Backend: Verifies that no unparsed runtime date macros (e.g. '[%CurrentDateTime%]')
 *    are passed as literal strings into step parameters or variation matrices (ANTI-53).
 * 2. Frontend: When DatePicker widgets are used or ACT_Fill_DatePicker_Input is called,
 *    verifies that CustomDateFormat pattern (e.g. 'dd-MM-yyyy') is documented (PAT-94)
 *    and not defaulted/assumed (ANTI-45).
 */
function validateDateTimeAndDatePickerFormats(content, stepLedgerTable, variationMatrixTable, metadata, tables, addCheck) {
  // A. Check for unparsed Mendix date macros in step ledger and variation matrix (ANTI-53)
  const dateMacroRegex = /\[%(?:CurrentDateTime|BeginOfCurrentDay|EndOfCurrentDay|BeginOfCurrentWeek|EndOfCurrentWeek|BeginOfCurrentMonth|EndOfCurrentMonth)[\s\S]*?%\]/i;
  
  let unparsedMacroFound = false;
  let unparsedMacroLocation = null;

  if (stepLedgerTable) {
    for (const row of stepLedgerTable.rows) {
      const rowText = Object.values(row).join(' ');
      const match = rowText.match(dateMacroRegex);
      if (match) {
        unparsedMacroFound = true;
        unparsedMacroLocation = `Step Ledger: '${match[0]}'`;
        break;
      }
    }
  }

  if (!unparsedMacroFound && variationMatrixTable) {
    for (const row of variationMatrixTable.rows) {
      const rowText = Object.values(row).join(' ');
      const match = rowText.match(dateMacroRegex);
      if (match) {
        unparsedMacroFound = true;
        unparsedMacroLocation = `Variation Matrix: '${match[0]}'`;
        break;
      }
    }
  }

  if (unparsedMacroFound) {
    addCheck(
      "ANTI-53: Zero Unparsed Date Macros in Payloads",
      false,
      `Found unparsed Mendix runtime date macro in ${unparsedMacroLocation} (ANTI-53). Literal macro strings like '[%CurrentDateTime%]' cannot be evaluated at runtime; use ISO-8601 UTC timestamps or MTA offset actions (PAT-42).`,
      "ANTI-53_VIOLATION"
    );
  } else {
    addCheck(
      "ANTI-53: Zero Unparsed Date Macros in Payloads",
      true,
      null,
      null,
      "No unparsed Mendix date macros found"
    );
  }

  // B. Check Frontend DatePicker interactions (PAT-94, ANTI-45)
  const isFrontend = metadata && metadata.category === 'Frontend';
  const hasDatePickerStep = stepLedgerTable && stepLedgerTable.rows.some(r => {
    const text = Object.values(r).join(' ');
    return /ACT_Fill_DatePicker_Input|ACT_Set_DatePicker_Date|ASR_Has_Value_DatePicker_Input|Locate_MxWidget_DatePicker/i.test(text);
  });
  const hasDatePickerInInventory = tables && tables.some(t => {
    const headerStr = t.headers.join(' ').toLowerCase();
    if (headerStr.includes('widget') || headerStr.includes('locator')) {
      return t.rows.some(r => Object.values(r).join(' ').toLowerCase().includes('datepicker'));
    }
    return false;
  });

  if (isFrontend && (hasDatePickerStep || hasDatePickerInInventory)) {
    // Check if CustomDateFormat is explicitly documented in the inventory or plan
    // Standard format pattern tokens: e.g. dd-MM-yyyy, yyyy-MM-dd, MM/dd/yyyy, dd/MM/yyyy, dd.MM.yyyy
    const hasCustomDateFormatDoc = /(?:CustomDateFormat|dateformPattern|Date\s*Format)[\s\S]*?(?:dd[-/. ]MM[-/. ]yyyy|yyyy[-/. ]MM[-/. ]dd|MM[-/. ]dd[-/. ]yyyy|dd[-/. ]MM[-/. ]yy)/i.test(content) ||
      /Date\s*Format\s*(?:\/|\()\s*(?:Constraint|PAT-94)[\s\S]*?(?:dd[-/. ]MM[-/. ]yyyy|yyyy[-/. ]MM[-/. ]dd|MM[-/. ]dd[-/. ]yyyy)/i.test(content) ||
      /CustomDateFormat\s*via\s*mxcli\s*bson\s*dump/i.test(content) ||
      /formattingInfo\.customDateFormat/i.test(content);

    // Check for explicit BSON model path documentation (PAT-94)
    const hasBsonModelPath = /(?:bson\s*dump|bson\s*model\s*path|formattingInfo|widgets\[.*?\]\.formattingInfo)/i.test(content);

    // Explicitly check for defaulted or assumed date format indicators (ANTI-45)
    const hasAssumedFormatIndicator = /(?:default\s*date\s*format|assumed\s*date\s*format|default\s*US\s*format|\bDefault\b\s*\|\s*`?Locate_MxWidget_DatePicker)/i.test(content) ||
      /\|\s*`?[a-zA-Z0-9_]*DatePicker[a-zA-Z0-9_]*`?\s*\|\s*`?DatePicker`?\s*\|\s*(?:Default|-|N\/A|\s*)\s*\|/i.test(content);

    if (!hasCustomDateFormatDoc || hasAssumedFormatIndicator) {
      addCheck(
        "PAT-94 & ANTI-45: Mandatory DatePicker Format Model Extraction",
        false,
        "Frontend test interacts with DatePicker widget, but no verified CustomDateFormat pattern (e.g. 'dd-MM-yyyy', 'yyyy-MM-dd') is documented in Section 2 Component Under Test (Input Widget Inventory table) (PAT-94 / ANTI-45). Date formats must be extracted via 'mxcli bson dump' and never guessed or defaulted.",
        "ANTI-45_VIOLATION"
      );
    } else {
      addCheck(
        "PAT-94 & ANTI-45: Mandatory DatePicker Format Model Extraction",
        true,
        null,
        null,
        "DatePicker CustomDateFormat verified and documented"
      );
    }
  }
}

/**
 * Validates Frontend Event-Driven Validation Feedback Assertions (PAT-119, ANTI-20, PAT-12, ANTI-74).
 * 1. Validates that every Locate_MxWidget_*_ValidationMessage step maps to the correct widget type.
 * 2. Enforces that output handles from validation locators are immediately consumed by assertion steps
 *    (ASR_Is_Hidden_MxLocator for happy path, or ASR_Is_Visible_MxLocator / ASR_Has_Text for negative tests).
 * 3. Enforces that each validation locator and assertion step contains a non-empty Description
 *    documenting the triggering event (onChange, onLeave, onEnterPress, while typing, Save/Submit button)
 *    and the flow origin (microflow or nanoflow).
 * 4. Catches ANTI-20 domain violations: prohibits backend validation assertion actions in Frontend UI plans.
 * 5. Enforces ANTI-74: Premature Validation Assertion sequencing (assertions must follow the submit Action Button click or inline field trigger).
 */
function validateFrontendValidationFeedback(content, stepLedgerTable, metadata, addCheck) {
  const isFrontend = metadata && metadata.category === 'Frontend';
  if (!stepLedgerTable || !isFrontend) return;

  const VALIDATION_LOCATOR_MAP = {
    'Locate_MxWidget_TextBox_ValidationMessage': {
      paramName: 'TextBoxLocator',
      expectedWidget: 'TextBox',
      locatorPattern: /Locate_MxWidget_TextBox(?!_ValidationMessage)/i
    },
    'Locate_MxWidget_DropDown_ValidationMessage': {
      paramName: 'DropDownLocator',
      expectedWidget: 'DropDown',
      locatorPattern: /Locate_MxWidget_DropDown(?!_ValidationMessage)/i
    },
    'Locate_MxWidget_DatePicker_ValidationMessage': {
      paramName: 'DatePickerLocator',
      expectedWidget: 'DatePicker',
      locatorPattern: /Locate_MxWidget_DatePicker(?!_ValidationMessage)/i
    },
    'Locate_MxWidget_ReferenceSelector_ValidationMessage': {
      paramName: 'ReferenceSelectorLocator',
      expectedWidget: 'ReferenceSelector',
      locatorPattern: /Locate_MxWidget_ReferenceSelector(?!_ValidationMessage)/i
    },
    'Locate_MxWidget_ComboBox_ValidationMessage': {
      paramName: 'ComboBoxLocator',
      expectedWidget: 'ComboBox',
      locatorPattern: /Locate_MxWidget_ComboBox(?!_ValidationMessage)/i
    },
    'Locate_MxWidget_CheckBox_ValidationMessage': {
      paramName: 'CheckBoxLocator',
      expectedWidget: 'CheckBox',
      locatorPattern: /Locate_MxWidget_CheckBox(?!_ValidationMessage)/i
    },
    'Locate_MxWidget_RadioButtons_ValidationMessage': {
      paramName: 'RadioButtonsLocator',
      expectedWidget: 'RadioButtons',
      locatorPattern: /Locate_MxWidget_RadioButtons(?!_ValidationMessage)/i
    }
  };

  const rows = stepLedgerTable.rows;
  let validationLocatorCount = 0;
  let hasChainingViolation = false;
  let hasTypeViolation = false;
  let hasDescViolation = false;
  let hasBackendAssertViolation = false;

  // Track widget locator outputs: map handle -> { stepNum, widgetType, actionText }
  const widgetHandles = {};
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const rowText = Object.values(row).join(' ');
    const outCol = Object.keys(row).find(k => k.toLowerCase().includes('output'));
    const outHandle = outCol ? (row[outCol] || '').replace(/[`\s]/g, '') : null;

    if (outHandle && outHandle !== '-' && outHandle.toLowerCase() !== 'none') {
      for (const [, info] of Object.entries(VALIDATION_LOCATOR_MAP)) {
        if (info.locatorPattern.test(rowText)) {
          widgetHandles[outHandle] = {
            stepNum: idx + 1,
            widgetType: info.expectedWidget,
            actionText: rowText
          };
          break;
        }
      }
    }
  }

  // Scan rows for validation message steps and backend assertion violations
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const rowText = Object.values(row).join(' ');

    // 1. Check for prohibited backend validation assertions in Frontend (ANTI-20)
    if (/(?:CreateAssertValidationFeedbackMessage|Assert\s+Validation\s+Feedback\s+(?:Count|Compare)|TCEX_RS_ValidationFeedback)/i.test(rowText)) {
      hasBackendAssertViolation = true;
      addCheck(
        "ANTI-20: Zero Backend Validation Assertions in Frontend Tests",
        false,
        `Step ${idx + 1} contains backend validation assertion in a Frontend execution plan (ANTI-20). Frontend UI tests must assert validation messages via FrontendTestKit locators (Locate_MxWidget_*_ValidationMessage -> ASR_Is_Hidden_MxLocator / ASR_Is_Visible_MxLocator).`,
        "ANTI-20_VIOLATION"
      );
    }

    // 2. Check for Locate_MxWidget_*_ValidationMessage calls
    let matchedLocatorKey = null;
    let matchedLocatorInfo = null;

    for (const [locKey, info] of Object.entries(VALIDATION_LOCATOR_MAP)) {
      if (rowText.includes(locKey)) {
        matchedLocatorKey = locKey;
        matchedLocatorInfo = info;
        break;
      }
    }

    if (matchedLocatorKey) {
      validationLocatorCount++;

      // A. Check Output Handle
      const outCol = Object.keys(row).find(k => k.toLowerCase().includes('output'));
      const outHandle = outCol ? (row[outCol] || '').replace(/[`\s]/g, '') : null;

      if (!outHandle || outHandle === '-' || outHandle.toLowerCase() === 'none') {
        hasChainingViolation = true;
        addCheck(
          `PAT-119: Step ${idx + 1} Validation Locator Output Handle`,
          false,
          `Step ${idx + 1} calls '${matchedLocatorKey}' but does not define an output handle to pipe into downstream assertions`,
          "MISSING_OUTPUT_HANDLE"
        );
      }

      // B. Check Input Handle & Widget Type Parity
      const inCol = Object.keys(row).find(k => k.toLowerCase().includes('input'));
      const inHandle = inCol ? (row[inCol] || '').replace(/[`\s]/g, '') : null;

      if (inHandle && widgetHandles[inHandle]) {
        const upstream = widgetHandles[inHandle];
        if (upstream.widgetType !== matchedLocatorInfo.expectedWidget) {
          hasTypeViolation = true;
          addCheck(
            `PAT-119: Step ${idx + 1} Locator Type Parity`,
            false,
            `Step ${idx + 1} calls '${matchedLocatorKey}' with input handle '${inHandle}' from Step ${upstream.stepNum} (${upstream.widgetType}), but expected a ${matchedLocatorInfo.expectedWidget} locator.`,
            "LOCATOR_TYPE_MISMATCH"
          );
        }
      }

      // C. Check Downstream Assertion Consumption (No Orphaned Locators)
      if (outHandle && outHandle !== '-' && outHandle.toLowerCase() !== 'none') {
        let isAssertedDownstream = false;
        const escapedOut = outHandle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const handleRegex = new RegExp(`\\b${escapedOut}\\b`);

        for (let j = idx + 1; j < rows.length; j++) {
          const downRow = rows[j];
          const downText = Object.values(downRow).join(' ');
          const downInCol = Object.keys(downRow).find(k => k.toLowerCase().includes('input'));
          const downInVal = downInCol ? (downRow[downInCol] || '').replace(/[`\s]/g, '') : '';
          const downInList = downInVal.split(',').map(s => s.trim());

          if (downInList.includes(outHandle) || handleRegex.test(downText)) {
            if (/ASR_Is_Hidden_MxLocator|ASR_Is_Visible_MxLocator|ASR_Has_Text/i.test(downText)) {
              isAssertedDownstream = true;
              break;
            }
          }
        }

        if (!isAssertedDownstream) {
          hasChainingViolation = true;
          addCheck(
            `PAT-119: Step ${idx + 1} Validation Locator Assertion Chaining`,
            false,
            `Step ${idx + 1} calls '${matchedLocatorKey}' producing output handle '${outHandle}', but no downstream step asserts its visibility using ASR_Is_Hidden_MxLocator or ASR_Is_Visible_MxLocator (PAT-119).`,
            "ORPHANED_VALIDATION_LOCATOR"
          );
        }
      }

      // D. Check Step Description Documentation (PAT-12 / PAT-119)
      const descRegex = /(?:onChange|onLeave|onEnterPress|while typing|delay|Save|Submit|ACT_|OCh_|DS_|ON_|microflow|nanoflow|validation|regress|error|hidden|visible)/i;
      if (!descRegex.test(rowText)) {
        hasDescViolation = true;
        addCheck(
          `PAT-12 & PAT-119: Step ${idx + 1} Validation Intent Documentation`,
          false,
          `Step ${idx + 1} (${matchedLocatorKey}) lacks an explicit Description documenting the triggering event (onChange/onLeave/onEnterPress/Save button) or microflow/nanoflow origin (PAT-119).`,
          "MISSING_STEP_DESCRIPTION"
        );
      }
    }
  }

  // 3. Event-Driven Validation Trigger Sequencing (PAT-119, ANTI-74)
  // Form validation feedback assertions MUST occur AFTER the submit button click (ACT_Click_MxButton / FormValidations = "All")
  // or explicitly document an inline field event (onChange / onLeave / onEnterPress / while typing).
  let lastInputStepIdx = -1;
  let lastButtonClickIdx = -1;
  let hasPrematureValidationViolation = false;
  let hiddenAssertCount = 0;

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const rowText = Object.values(row).join(' ');

    // Track input action steps (e.g. ACT_Fill_TextBox_Input, ACT_Set_DatePicker_Date, ACT_Select_DropDown_Option, etc.)
    if (/ACT_(?:Fill|Set|Select|Check|Uncheck)_/i.test(rowText)) {
      lastInputStepIdx = idx;
    }

    // Track button click steps (e.g. ACT_Click_MxButton, ACT_Click_Button, Click_MxButton)
    if (/ACT_Click_(?:MxButton|Button|LinkButton)|Click_MxButton/i.test(rowText)) {
      lastButtonClickIdx = idx;
    }

    // Check hidden assertion count (diagnostic assertions in happy path)
    if (/ASR_Is_Hidden_MxLocator/i.test(rowText)) {
      hiddenAssertCount++;
    }

    // Check validation message locator steps
    if (/Locate_MxWidget_[a-zA-Z0-9_]+_ValidationMessage/i.test(rowText)) {
      const isInlineEvent = /(?:onChange|onLeave|onEnterPress|while typing|on\s*change|on\s*leave|field\s*blur)/i.test(rowText);
      // If it's not an inline field event, it's a form-level validation that requires a preceding submit button click
      if (!isInlineEvent) {
        if (lastInputStepIdx !== -1 && (lastButtonClickIdx === -1 || lastButtonClickIdx < lastInputStepIdx)) {
          hasPrematureValidationViolation = true;
          addCheck(
            `PAT-119 & ANTI-74: Step ${idx + 1} Premature Validation Assertion`,
            false,
            `Step ${idx + 1} checks validation feedback before submit button click (ACT_Click_MxButton) without an inline field event trigger (onChange/onLeave) (ANTI-74). Validation message assertions must occur AFTER the submit button click that triggers Mendix form validation (FormValidations = 'All').`,
            "ANTI-74_VIOLATION"
          );
        }
      }
    }
  }

  // Summary checks if validation steps were evaluated
  if (validationLocatorCount > 0) {
    if (!hasChainingViolation) {
      addCheck(
        "PAT-119: Validation Message Locator & Assertion Chaining",
        true,
        null,
        null,
        `${validationLocatorCount} validation locator(s) correctly chained to assertions`
      );
    }
    if (!hasTypeViolation) {
      addCheck(
        "PAT-119: Validation Locator Type Parity",
        true,
        null,
        null,
        `All ${validationLocatorCount} validation locator(s) match parent widget locator types`
      );
    }
    if (!hasDescViolation) {
      addCheck(
        "PAT-12 & PAT-119: Validation Step Rationale Documented",
        true,
        null,
        null,
        "Validation locator and assertion steps document triggering event/flow origin"
      );
    }
    if (!hasPrematureValidationViolation) {
      addCheck(
        "PAT-119 & ANTI-74: Event-Driven Validation Trigger Sequencing",
        true,
        null,
        null,
        "Validation feedback assertion sequence conforms to trigger lifecycle (post-submit or event-driven)"
      );
    }
  }

  if (hiddenAssertCount > 0) {
    addCheck(
      "PAT-119: Diagnostic Validation Assertion Coverage",
      true,
      null,
      null,
      `${hiddenAssertCount} diagnostic hidden-validation assertion(s) protecting form inputs in happy-path flows`
    );
  }

  if (!hasBackendAssertViolation) {
    addCheck(
      "ANTI-20: Frontend Validation Feedback Isolation",
      true,
      null,
      null,
      "No prohibited backend validation assertions detected in Frontend plan"
    );
  }
}

/**
 * Validates test intent classification, specification source traceability, risk coverage,
 * and exact return value assertion presence (PAT-121, ANTI-68..ANTI-72).
 */
/**
 * Rule: PAT-64 & ANTI-79: Mandatory Frontend High-Level Locator Generator Tools
 *
 * In Frontend execution plans:
 * 1. Locating a page (Locate_MxPage) MUST NEVER use generic CreateMicroflowCallTestStep or CallMicroflow/CreateMicroflowCall.
 *    It MUST use GenerateMicroflowCallTestStepLocatePage.
 * 2. GenerateMicroflowCallTestStepLocatePage MUST specify a valid PageQualifiedName ('<Module>.<Page>')
 *    and clean PageClassName (clean Mendix identifier, NEVER raw browser DOM/CSS classes like page-content or mx-name-).
 * 3. Standard widget locators (Locate_TextBox, Locate_Button, Locate_DropDown, Locate_DatePicker, Locate_MxWidget_*, etc.)
 *    MUST NEVER specify generic CreateMicroflowCallTestStep. They MUST specify GenerateMicroflowCallTestStepLocateWidget.
 */
function validateFrontendLocatorTools(content, stepLedgerTable, metadata, addCheck) {
  const isFrontend = metadata && metadata.category === 'Frontend';
  if (!stepLedgerTable || !isFrontend) return;

  const rows = stepLedgerTable.rows;
  let hasGenericPageLocator = false;
  let hasGenericWidgetLocator = false;
  let hasInvalidPageLocatorParams = false;
  let genericPageLocatorStep = null;
  let genericWidgetLocatorStep = null;
  const invalidPageLocatorReasons = [];

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const rowText = Object.values(row).join(' ');

    // Check for page locator steps
    const isPageLocator = /Locate_MxPage\b/i.test(rowText) || /GenerateMicroflowCallTestStepLocatePage\b/i.test(rowText);
    if (isPageLocator) {
      const isGeneratorTool = /GenerateMicroflowCallTestStepLocatePage|GenerateLocatePage/i.test(rowText);
      const isGenericMicroflowCall = /CreateMicroflowCallTestStep|CallMicroflow|CreateMicroflowCall/i.test(rowText);
      if (!isGeneratorTool || (isGenericMicroflowCall && /CreateMicroflowCallTestStep/i.test(rowText))) {
        hasGenericPageLocator = true;
        genericPageLocatorStep = idx + 1;
      }

      // Check parameter constraints for page locator steps (ANTI-79)
      if (isGeneratorTool && !hasGenericPageLocator) {
        let stepHasParamError = false;
        // Raw CSS selector check on PageClassName
        const pageClassMatch = rowText.match(/PageClassName\s*=\s*['"]([^'"]+)['"]/i);
        if (pageClassMatch) {
          const pageClassName = pageClassMatch[1].trim();
          if (/page-content|mx-name-|\.|\#|\s/i.test(pageClassName)) {
            hasInvalidPageLocatorParams = true;
            stepHasParamError = true;
            invalidPageLocatorReasons.push(`Step ${idx + 1} specifies raw CSS/DOM selector ('${pageClassName}') for PageClassName (ANTI-79). GenerateMicroflowCallTestStepLocatePage requires clean Mendix page class name (e.g. 'Home_Renter'), not browser DOM classes.`);
          }
        }

        // Mandatory PageQualifiedName check
        const hasPageQualifiedName = /PageQualifiedName\s*=\s*['"][A-Za-z0-9_]+\.[A-Za-z0-9_]+['"]/i.test(rowText) ||
                                     /\b[A-Za-z0-9_]+\.[A-Za-z0-9_]+\b/.test(row['Step Action & Target'] || '') ||
                                     /\b[A-Za-z0-9_]+\.[A-Za-z0-9_]+\b/.test(row['Action & Target'] || '');
        if (!hasPageQualifiedName && !stepHasParamError) {
          hasInvalidPageLocatorParams = true;
          invalidPageLocatorReasons.push(`Step ${idx + 1} uses GenerateMicroflowCallTestStepLocatePage without specifying PageQualifiedName ('<ModuleName>.<PageName>') (ANTI-79). A qualified page name is mandatory for MTA page registration.`);
        }
      }
    }

    // Check for widget locator anti-pattern specifying generic CreateMicroflowCallTestStep
    const isWidgetLocator = /Locate_MxWidget_(?![A-Za-z0-9_]*ValidationMessage\b)|Locate_TextBox|Locate_Button|Locate_DropDown|Locate_DatePicker|Locate_CheckBox|Locate_RadioButtons|Locate_ReferenceSelector/i.test(rowText);
    if (isWidgetLocator) {
      if (/CreateMicroflowCallTestStep/i.test(rowText)) {
        hasGenericWidgetLocator = true;
        genericWidgetLocatorStep = idx + 1;
      }
    }
  }

  // Also check if content explicitly mentions calling CreateMicroflowCallTestStep for Locate_MxPage
  const explicitCreateCallForPage = /CreateMicroflowCallTestStep[\s\S]*?Locate_MxPage/i.test(content) ||
    /Locate_MxPage[\s\S]*?CreateMicroflowCallTestStep/i.test(content);
  if (explicitCreateCallForPage && !hasGenericPageLocator) {
    hasGenericPageLocator = true;
    genericPageLocatorStep = "plan text";
  }

  if (hasGenericPageLocator) {
    addCheck(
      "PAT-64 & ANTI-79: High-Level Page Locator Generator Mandate",
      false,
      `Step ${genericPageLocatorStep} specifies locating a page via generic CreateMicroflowCall / CallMicroflow (Locate_MxPage) instead of GenerateMicroflowCallTestStepLocatePage (ANTI-79). Calling generic microflow creation bypasses MTA locator wiring and leaves 'Page' / 'BrowserContext' parameters empty, causing fatal runtime exceptions.`,
      "ANTI-79_VIOLATION"
    );
  } else if (hasInvalidPageLocatorParams) {
    addCheck(
      "PAT-64 & ANTI-79: High-Level Page Locator Generator Mandate",
      false,
      invalidPageLocatorReasons.join('; '),
      "ANTI-79_VIOLATION"
    );
  } else {
    addCheck(
      "PAT-64 & ANTI-79: High-Level Page Locator Generator Mandate",
      true,
      null,
      null,
      "Compliant with GenerateMicroflowCallTestStepLocatePage mandate"
    );
  }

  if (hasGenericWidgetLocator) {
    addCheck(
      "PAT-64 & ANTI-79: High-Level Widget Locator Generator Mandate",
      false,
      `Step ${genericWidgetLocatorStep} specifies widget locator via generic CreateMicroflowCallTestStep instead of GenerateMicroflowCallTestStepLocateWidget (ANTI-79). High-level generator tools must be used for widget locators.`,
      "ANTI-79_VIOLATION"
    );
  } else {
    addCheck(
      "PAT-64 & ANTI-79: High-Level Widget Locator Generator Mandate",
      true,
      null,
      null,
      "Compliant with GenerateMicroflowCallTestStepLocateWidget mandate"
    );
  }
}

/**
 * Rule: PAT-125 & ANTI-81: Frontend Session Startup & Authentication Mandate
 *
 * In Frontend execution plans:
 * 1. Startup step in Case 2 should use Start_MxFrontend_Test_Without_Login or Start_MxFrontend_Test_With_Login.
 * 2. If Start_MxFrontend_Test_With_Login is used, it MUST NOT specify dummy/hallucinated credentials
 *    (e.g. Password = '1', '123', 'password') without verification against project demo users or explicit request.
 */
function validateFrontendAuthenticationStartup(content, stepLedgerTable, metadata, addCheck) {
  const isFrontend = metadata && metadata.category === 'Frontend';
  if (!stepLedgerTable || !isFrontend) return;

  const rows = stepLedgerTable.rows;
  let hasStartupStep = false;
  let startupStepType = null;
  let suspiciousAuthReason = null;

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const rowText = Object.values(row).join(' ');

    if (/Start_MxFrontend_Test_Without_Login\b/i.test(rowText)) {
      hasStartupStep = true;
      startupStepType = 'Without_Login';
    } else if (/Start_MxFrontend_Test_With_Login\b/i.test(rowText)) {
      hasStartupStep = true;
      startupStepType = 'With_Login';

      // Check for trivial/hallucinated password anti-pattern
      const passMatch = rowText.match(/Password\s*=\s*['"]([^'"]+)['"]/i);
      if (passMatch) {
        const pass = passMatch[1].trim();
        if (/^(?:1|123|1234|12345|password|test|admin)$/i.test(pass)) {
          suspiciousAuthReason = `Step ${idx + 1} specifies dummy password ('${pass}') in Start_MxFrontend_Test_With_Login (ANTI-81). Ensure credentials correspond to a verified demo user or execution user, or use Start_MxFrontend_Test_Without_Login if the entry page allows guest access.`;
        }
      }
    }
  }

  // Only validate if a startup step was detected or if suspicious credentials were found
  if (suspiciousAuthReason) {
    addCheck(
      "PAT-125 & ANTI-81: Frontend Session Startup Mandate",
      false,
      suspiciousAuthReason,
      "ANTI-81_VIOLATION"
    );
  } else if (hasStartupStep) {
    addCheck(
      "PAT-125 & ANTI-81: Frontend Session Startup Mandate",
      true,
      null,
      null,
      `Session startup verified (${startupStepType})`
    );
  }
}

function validateIntentAndGroundTruth(metadata, content, stepLedgerTable, variationMatrixTable, addCheck) {
  if (!metadata) return;

  const validIntents = ['regression', 'exploratory_robustness', 'exploratory_feature', 'tdd', 'data_seeding', 'bug_reproduction'];
  const intent = metadata.test_intent;
  const schemaVersion = metadata.schema_version || '2.0.0';
  const isSchema21Plus = typeof schemaVersion === 'string' && (schemaVersion.startsWith('2.1') || schemaVersion.localeCompare('2.1.0', undefined, { numeric: true }) >= 0);

  // 1. Intent Validity Check (CHECK_INTENT_VALIDITY)
  if (intent) {
    if (validIntents.includes(intent)) {
      addCheck("PAT-121: Test Intent Validity", true, null, null, { intent });
    } else {
      addCheck("PAT-121: Test Intent Validity", false, `Invalid 'test_intent': '${intent}'. Must be one of: ${validIntents.join(', ')}`, "INVALID_TEST_INTENT");
      return;
    }
  } else if (isSchema21Plus) {
    addCheck("PAT-121: Test Intent Validity", false, "Missing 'test_intent' in metadata for schema 2.1.0+", "MISSING_TEST_INTENT");
    return;
  } else {
    // Legacy schema (< 2.1.0) without test_intent - valid by backward compatibility
    return;
  }

  // 2. Specification Substance & Anti-Circular Specs (CHECK_SPEC_SUBSTANCE, ANTI-69, ANTI-71)
  const isPromptSpec = metadata.spec_source && typeof metadata.spec_source.type === 'string' && metadata.spec_source.type.startsWith('prompt');
  const requiresSubstance = (
    intent === 'exploratory_feature' ||
    intent === 'tdd' ||
    intent === 'bug_reproduction' ||
    (intent === 'regression' && isPromptSpec)
  );

  if (requiresSubstance) {
    const specSource = metadata.spec_source;
    if (!specSource) {
      addCheck("ANTI-69: Specification Source Substance", false, `Intent '${intent}' requires 'spec_source' to prevent tautological testing against unverified code (PAT-121)`, "MISSING_SPEC_SOURCE");
    } else {
      const specType = specSource.type;
      const specSummary = specSource.summary;

      if (specType === 'model_baseline' && intent !== 'regression') {
        addCheck("ANTI-69: Non-Circular Ground Truth Source", false, `Intent '${intent}' cannot use 'model_baseline' as ground truth. An external specification or prompt criteria is required (ANTI-69)`, "ANTI-69_CIRCULAR_SPEC");
      } else {
        addCheck("ANTI-69: Non-Circular Ground Truth Source", true);
      }

      if (typeof specSummary !== 'string' || specSummary.trim().length < 30) {
        addCheck("ANTI-71: Specification Substance Length", false, `spec_source.summary must be at least 30 characters describing concrete expected behavior, found: '${specSummary || ''}' (${(specSummary || '').trim().length} chars) (ANTI-71)`, "ANTI-71_TRIVIAL_SPEC_ECHO");
      } else {
        // Anti-Loophole: Check for circular tautology blacklist
        const circularRegex = /\b(as\s+implemented|derived\s+from\s+code|same\s+as\s+model|what\s+the\s+code\s+does|current\s+implementation)\b/i;
        if (circularRegex.test(specSummary)) {
          addCheck("ANTI-69: Circular Specification Blacklist", false, `spec_source.summary contains circular reference ('${specSummary}'). Must specify independent business criteria (ANTI-69)`, "ANTI-69_CIRCULAR_SPEC");
        } else {
          addCheck("ANTI-69: Circular Specification Blacklist", true);
        }

        // Anti-Loophole: Check for conditional or expected outcome keywords
        const outcomeKeywordRegex = /\b(if|when|must|should|equal|equals|returns|validates|rejects|ensures|throws|calculates|prevents)\b/i;
        if (!outcomeKeywordRegex.test(specSummary)) {
          addCheck("ANTI-71: Specification Outcome Keywords", false, `spec_source.summary must specify concrete outcomes or conditionals (if, when, must, should, equal, returns, validates, etc.) (ANTI-71)`, "ANTI-71_TRIVIAL_SPEC_ECHO");
        } else {
          addCheck("ANTI-71: Specification Outcome Keywords", true);
        }
      }
    }
  }

  // 3. Risk Diversity & Matrix Coverage (CHECK_RISK_DIVERSITY, ANTI-70)
  if (metadata.risks_covered) {
    if (!Array.isArray(metadata.risks_covered) || metadata.risks_covered.length === 0) {
      addCheck("ANTI-70: Risk Coverage Presence", false, "risks_covered must be a non-empty array of risk items (ANTI-70)", "ANTI-70_EMPTY_RISK_MATRIX");
    } else {
      const riskKeywordRegex = /\b(null|empty|exceed|unauthorized|negative|boundary|invalid|fail|failure|timeout|zero|overflow|exceeds|forbidden|exception|crash)\b/i;
      let hasTrivialRisk = false;
      let unresolvedScenario = null;

      for (const item of metadata.risks_covered) {
        const riskText = (item && item.risk) ? String(item.risk) : '';
        if (!riskKeywordRegex.test(riskText)) {
          hasTrivialRisk = true;
          addCheck("ANTI-70: Non-Trivial Risk Mitigation", false, `Risk '${riskText}' does not address a non-trivial boundary or failure mode (ANTI-70)`, "ANTI-70_RUBBER_STAMP_RISK");
          break;
        }

        if (variationMatrixTable && item.mitigating_scenario) {
          const scenRef = String(item.mitigating_scenario).trim();
          const inHeaders = variationMatrixTable.headers.some(h => h.toLowerCase().includes(scenRef.toLowerCase()));
          const inRows = variationMatrixTable.rows.some(r => Object.values(r).some(c => String(c).toLowerCase().includes(scenRef.toLowerCase())));
          const numMatch = scenRef.match(/\d+/);
          const numInHeaders = numMatch && variationMatrixTable.headers.some(h => h.includes(numMatch[0]));

          if (!inHeaders && !inRows && !numInHeaders) {
            unresolvedScenario = scenRef;
          }
        }
      }

      if (!hasTrivialRisk) {
        addCheck("ANTI-70: Non-Trivial Risk Mitigation", true);
      }

      if (unresolvedScenario) {
        addCheck("PAT-121: Mitigating Scenario Resolution", false, `Mitigating scenario '${unresolvedScenario}' in risks_covered not found in Data Variation Matrix headers or rows`, "UNRESOLVED_RISK_SCENARIO");
      } else if (variationMatrixTable) {
        addCheck("PAT-121: Mitigating Scenario Resolution", true);
      }
    }
  } else if ((intent === 'exploratory_feature' || intent === 'tdd' || intent === 'exploratory_robustness' || intent === 'bug_reproduction') && isSchema21Plus) {
    addCheck("ANTI-70: Risk Coverage Presence", false, `Schema 2.1.0+ plans with intent '${intent}' must specify 'risks_covered' array (ANTI-70)`, "ANTI-70_EMPTY_RISK_MATRIX");
  }

  // 4. Exact Assertion Presence Guardrail (CHECK_EXACT_ASSERTION_PRESENCE, ANTI-72)
  if ((intent === 'exploratory_feature' || intent === 'tdd') && metadata.category === 'Backend' && stepLedgerTable) {
    const microflowRow = stepLedgerTable.rows.find(r => Object.values(r).some(v => /CallMicroflow/i.test(String(v))));
    if (microflowRow) {
      const assertionsCol = Object.keys(microflowRow).find(k => k.toLowerCase().includes('assertion'));
      const assertionText = assertionsCol ? String(microflowRow[assertionsCol]) : '';

      const hasReturnAssertInStep = /Assert\s+Return\s+Value/i.test(assertionText) || /Assert\s+result/i.test(assertionText);
      const hasReturnAssertInMatrix = variationMatrixTable && variationMatrixTable.rows.some(r => Object.values(r).some(v => /Assert\s+Return/i.test(String(v))));

      if (hasReturnAssertInStep || hasReturnAssertInMatrix) {
        const isSoftenedOnly = /!=\s*empty/i.test(assertionText) && !/==/i.test(assertionText) && !/equals/i.test(assertionText) && !hasReturnAssertInMatrix;
        if (isSoftenedOnly) {
          addCheck("ANTI-72: Exact Return Value Assertion", false, `Exploratory feature test return assertion is softened to non-empty ('${assertionText}'). Must verify exact expected scalar values (ANTI-72)`, "ANTI-72_ASSERTION_SOFTENING");
        } else {
          addCheck("ANTI-72: Exact Return Value Assertion", true);
        }
      }
    }
  }

  // 5. Bug Reproduction Pre-Fix Failure Specification & Anchor (PAT-124)
  if (intent === 'bug_reproduction') {
    const hasExpectedOutcome = metadata.expected_pre_fix_outcome === 'FAIL' || /expected.*pre.*fix.*fail/i.test(content);
    addCheck(
      "PAT-124: Bug Reproduction Pre-Fix Failure Specification",
      hasExpectedOutcome,
      hasExpectedOutcome ? null : "Plans with intent 'bug_reproduction' must specify 'expected_pre_fix_outcome: FAIL' in metadata or Section 1 (PAT-124)",
      "MISSING_PRE_FIX_OUTCOME"
    );

    const hasAnchor = /(?:###\s*🔒?\s*IMMUTABLE_ASSERTION_ANCHOR|IMMUTABLE_ASSERTION_ANCHOR:)/i.test(content);
    addCheck(
      "PAT-124: Bug Reproduction Immutable Assertion Anchor",
      hasAnchor,
      hasAnchor ? null : "Plans with intent 'bug_reproduction' must provision an IMMUTABLE_ASSERTION_ANCHOR (TARGET=... | ASSERT_EQUAL=...) in Section 1 (PAT-124)",
      "MISSING_ASSERTION_ANCHOR"
    );
  }

}

/**
 * Cross-table semantic audit for PAT-07 & ANTI-48:
 * Scans Section 4 (Variation Matrix) for empty/null object and unassigned association variations.
 * If detected, enforces that Section 3 (Step Ledger) provisions the PAT-07 Retrieve-from-Teststep
 * sentinel pattern with a scalar sentinel filter and embedded Assert Object Count (PAT-08).
 */
function validatePat07EmptyBoundaries(stepLedgerTable, variationMatrixTable, metadata, addCheck) {
  // PAT-07 sentinel retrieves apply strictly to Backend tests with object parameters/associations
  if (metadata && metadata.category === 'Frontend') return;

  // 1. Identify scenario columns in variation matrix
  const scenarioCols = variationMatrixTable.headers.filter(h => {
    const trimmed = h.trim();
    if (trimmed === '#' || trimmed.toLowerCase() === 'case') return false;
    return /(?:scenario\s*#?\d+|^#\d+)/i.test(trimmed);
  });

  if (scenarioCols.length === 0) return;

  // 2. Identify target column in variation matrix
  const targetColKey = Object.keys(variationMatrixTable.rows[0] || {}).find(k => {
    const l = k.toLowerCase().trim();
    return (l.includes('target') || l.includes('step') || l.includes('item')) && !l.includes('exec') && l !== '#';
  }) || (variationMatrixTable.headers.length > 1 && variationMatrixTable.headers[0].trim() === '#' ? variationMatrixTable.headers[1] : variationMatrixTable.headers[0]);

  // 3. Extract Scenario Names and Descriptions maps
  const scenarioNameMap = {};
  const scenarioDescMap = {};

  for (const sCol of scenarioCols) {
    const parenMatch = sCol.match(/\(([^)]+)\)/);
    if (parenMatch && parenMatch[1].trim()) {
      scenarioNameMap[sCol] = parenMatch[1].trim();
    } else {
      scenarioNameMap[sCol] = sCol.trim();
    }
  }

  for (const row of variationMatrixTable.rows) {
    const rowLabel = targetColKey ? row[targetColKey] : Object.values(row)[0] || '';
    const cleanLabel = rowLabel.replace(/[`*_]/g, '').trim();

    if (/Scenario\s*Name/i.test(cleanLabel)) {
      for (const sCol of scenarioCols) {
        if (row[sCol] && row[sCol].trim()) {
          scenarioNameMap[sCol] = row[sCol].trim();
        }
      }
    } else if (/Scenario\s*Desc/i.test(cleanLabel)) {
      for (const sCol of scenarioCols) {
        if (row[sCol] && row[sCol].trim()) {
          scenarioDescMap[sCol] = row[sCol].trim();
        }
      }
    }
  }

  // 4. Inspect Section 3 (Step Ledger) for PAT-07 Sentinel Retrieves, CreateObject handles, and Microflow calls
  let hasRetrieveFromTeststep = false;
  let hasValidSentinelFilter = false;
  let hasSentinelCountAssertion = false;
  let hasEnumFilterViolation = false;
  let hasLongSentinelViolation = false;
  let hasMicroflowCall = false;
  const sentinelEntities = new Map();
  const createdEntities = new Map();
  const handleProducers = new Map();
  const directCreateToMicroflowErrors = [];
  const directCreateToCreateAssocErrors = [];

  for (let idx = 0; idx < stepLedgerTable.rows.length; idx++) {
    const row = stepLedgerTable.rows[idx];
    const rowText = Object.values(row).join(' ');
    const cleanRowText = rowText.replace(/[`*_]/g, '');

    const actionCol = Object.keys(row).find(k => k.toLowerCase().includes('action') || k.toLowerCase().includes('target'));
    const actionVal = actionCol ? row[actionCol] : cleanRowText;
    const cleanActionVal = String(actionVal).replace(/[`*_]/g, '');

    const isCreate = /Create(?:Object|Objects)?/i.test(actionVal);
    const isRetrieve = /Retrieve(?:Object|Objects)?/i.test(actionVal);
    const isMicroflow = /CallMicroflow|MicroflowCall/i.test(actionVal);

    const outCol = Object.keys(row).find(k => k.toLowerCase().includes('output') || k.toLowerCase() === 'out');
    const outHandle = outCol ? (row[outCol] || '').replace(/[`\s]/g, '') : '';
    const inCol = Object.keys(row).find(k => (k.toLowerCase().includes('input') || k.toLowerCase() === 'in') && !k.toLowerCase().includes('binding') && !k.toLowerCase().includes('initial'));
    const inHandle = inCol ? (row[inCol] || '').replace(/[`\s]/g, '') : '';
    const paramCol = Object.keys(row).find(k => k.toLowerCase().includes('parameter') || k.toLowerCase().includes('binding') || k.toLowerCase().includes('initial'));
    const paramText = paramCol ? (row[paramCol] || '') : '';

    if (isCreate) {
      const entMatch = cleanActionVal.match(/Create(?:Object|Objects)?\s*\(\s*(?:([A-Z][a-zA-Z0-9_]*)\.)?([A-Z][a-zA-Z0-9_]*)\s*\)/i) ||
                        cleanActionVal.match(/Create(?:Object|Objects)?\s+([A-Z][a-zA-Z0-9_]*)/i) ||
                        cleanRowText.match(/Create(?:Object|Objects)?\s*\(\s*(?:([A-Z][a-zA-Z0-9_]*)\.)?([A-Z][a-zA-Z0-9_]*)\s*\)/i) ||
                        cleanRowText.match(/Create(?:Object|Objects)?\s+([A-Z][a-zA-Z0-9_]*)/i);
      const entName = entMatch ? (entMatch[2] || entMatch[1]).replace(/(?:Handle|Obj|Object)$/i, '') : '';
      if (outHandle && outHandle !== '-' && outHandle.toLowerCase() !== 'none') {
        handleProducers.set(outHandle.toLowerCase(), {
          type: 'CreateObject',
          entity: entName,
          stepIdx: idx + 1,
          rawHandle: outHandle
        });
      }
      if (entName) {
        createdEntities.set(entName.toLowerCase(), {
          entity: entName,
          stepIdx: idx + 1,
          handle: outHandle
        });
      }

      // Check direct CreateObject association bindings without PAT-07 sentinel retrieve (for non-data-seeding tests)
      const isDataSeeding = metadata && metadata.test_intent === 'data_seeding';
      if (!isDataSeeding) {
        const createEqMatches = paramText.matchAll(/(?:[a-zA-Z0-9_]+)\s*=\s*([a-zA-Z0-9_]+)/g);
        for (const m of createEqMatches) {
          const val = m[1].trim();
          if (val !== 'true' && val !== 'false' && val !== 'empty' && val !== 'null' && isNaN(val)) {
            const producer = handleProducers.get(val.toLowerCase());
            if (producer && producer.type === 'CreateObject') {
              directCreateToCreateAssocErrors.push({
                stepIdx: idx + 1,
                handle: val,
                producerStepIdx: producer.stepIdx,
                entity: producer.entity || 'Unknown'
              });
            }
          }
        }
      }
    }

    const isTeststepOption = /(?:Teststep|from\s+Teststep|from\s+step|RetrieveOption\s*=\s*["']?Teststep["']?)/i.test(rowText);
    const hasPipedInput = inHandle && inHandle !== '-' && inHandle.toLowerCase() !== 'none';

    if (isRetrieve && (isTeststepOption || hasPipedInput)) {
      hasRetrieveFromTeststep = true;

      // Filter check on scalar attribute (String or Integer, never Enum per PAT-07)
      const isEnumFilter = /Enum_|\.Enum[A-Za-z0-9_]*/i.test(rowText);
      if (isEnumFilter) {
        hasEnumFilterViolation = true;
      }

      // Universal Short Sentinel Law (<= 4 chars: 'NONE', 'NULL', 'VALID')
      if (/(?:NON_EXISTENT|DOES_NOT_EXIST|NOT_FOUND)/i.test(rowText)) {
        hasLongSentinelViolation = true;
      }

      const hasFilterSpec = /(?:Filter|SentinelKey|Sentinel|[a-zA-Z0-9_]+)\s*(?:==|=|:)\s*(?:'[^']+'|"[^"]+"|\d+)/i.test(rowText) ||
                            /(?:filter|SentinelKey)/i.test(rowText);
      const isValidFilter = hasFilterSpec && !isEnumFilter && !hasLongSentinelViolation;
      if (isValidFilter) {
        hasValidSentinelFilter = true;
      }

      // Assert Object Count (PAT-08)
      if (/Assert\s+(?:Object\s+)?Count|Object\s+Count/i.test(rowText)) {
        hasSentinelCountAssertion = true;
      }

      // Robust entity extraction from Retrieve step
      const entMatch = cleanActionVal.match(/Retrieve(?:Object|Objects)?\s*\(\s*(?:([A-Z][a-zA-Z0-9_]*)\.)?([A-Z][a-zA-Z0-9_]*)\s*\)/i) ||
                        cleanActionVal.match(/Retrieve(?:Object|Objects)?\s+([A-Z][a-zA-Z0-9_]*)/i) ||
                        cleanRowText.match(/Retrieve(?:Object|Objects)?\s*\(\s*(?:([A-Z][a-zA-Z0-9_]*)\.)?([A-Z][a-zA-Z0-9_]*)\s*\)/i) ||
                        cleanRowText.match(/Retrieve(?:Object|Objects)?\s+([A-Z][a-zA-Z0-9_]*)/i);
      if (entMatch) {
        const entName = (entMatch[2] || entMatch[1]).replace(/(?:Handle|Sentinel|Obj|Object|_Sentinel)$/i, '');
        sentinelEntities.set(entName.toLowerCase(), {
          entity: entName,
          isValid: isValidFilter,
          stepIdx: idx + 1
        });
      }

      if (outHandle && outHandle !== '-' && outHandle.toLowerCase() !== 'none') {
        const entName = entMatch ? (entMatch[2] || entMatch[1]).replace(/(?:Handle|Sentinel|Obj|Object|_Sentinel)$/i, '') : '';
        handleProducers.set(outHandle.toLowerCase(), {
          type: 'RetrieveObject',
          entity: entName,
          stepIdx: idx + 1,
          isValidSentinel: isValidFilter,
          rawHandle: outHandle
        });
      }
    }

    if (isMicroflow) {
      hasMicroflowCall = true;
      const boundHandles = [];
      if (inHandle && inHandle !== '-' && inHandle.toLowerCase() !== 'none') {
        boundHandles.push(inHandle);
      }
      const eqMatches = paramText.matchAll(/(?:[a-zA-Z0-9_]+)\s*=\s*([a-zA-Z0-9_]+)/g);
      for (const m of eqMatches) {
        const val = m[1].trim();
        if (val !== 'true' && val !== 'false' && val !== 'empty' && val !== 'null' && isNaN(val)) {
          boundHandles.push(val);
        }
      }

      for (const h of boundHandles) {
        const producer = handleProducers.get(h.toLowerCase());
        if (producer && producer.type === 'CreateObject') {
          directCreateToMicroflowErrors.push({
            stepIdx: idx + 1,
            handle: h,
            producerStepIdx: producer.stepIdx,
            entity: producer.entity || 'Unknown'
          });
        }
      }
    }
  }

  const ledgerRawText = stepLedgerTable.rawLines.join(' ');
  if (/SentinelKey/i.test(ledgerRawText) && hasRetrieveFromTeststep && !hasEnumFilterViolation && !hasLongSentinelViolation) {
    hasValidSentinelFilter = true;
  }
  if (/Assert\s+(?:Object\s+)?Count/i.test(ledgerRawText) && hasRetrieveFromTeststep) {
    hasSentinelCountAssertion = true;
  }

  // 5. Scan Section 4 for empty/null object parameter variations and enforce parameter-level sentinel matching
  const emptyTokenRegex = /(?:empty|null|unassigned|missing|\bno\s+[a-z]+|\bno_[a-z]+|\bnone\b|\bwithout\b)/i;
  const detectedEmptyScenarios = [];
  const missingSentinelErrors = [];

  for (const sCol of scenarioCols) {
    const scenName = scenarioNameMap[sCol] || sCol;
    const scenDesc = scenarioDescMap[sCol] || '';
    const isHeaderEmpty = emptyTokenRegex.test(sCol) || emptyTokenRegex.test(scenName) || emptyTokenRegex.test(scenDesc) || /\bNo[A-Z]/.test(scenName) || /\bno[A-Z]/.test(scenName);

    let cellEmptyFound = false;

    // Check cells targeting object parameters or associations
    for (const row of variationMatrixTable.rows) {
      const rowLabel = targetColKey ? row[targetColKey] : Object.values(row)[0] || '';
      const cleanLabel = rowLabel.replace(/[`*_]/g, '').trim();

      if (/Scenario\s*(?:Name|Desc)/i.test(cleanLabel) || /Assert\s*(?:Return|Count|Feedback|Value|Attribute)/i.test(cleanLabel)) continue;

      const cellVal = (row[sCol] || '').replace(/[`*_\s]/g, '').toLowerCase();

      if (cellVal === 'empty' || cellVal === 'null' || cellVal === "''" || cellVal === '""' || cellVal === '-' || cellVal === 'none' || cellVal === 'unassigned') {
        cellEmptyFound = true;
        // Extract parameter/entity name
        let targetEntity = cleanLabel;
        const entMatch = cleanLabel.match(/(?:Step\s*\d+:?\s*)?\$?([A-Z][a-zA-Z0-9_]*)(?:\.([A-Z][a-zA-Z0-9_]*))?/);
        if (entMatch) {
          targetEntity = entMatch[1];
        }
        const normEntity = targetEntity.replace(/^Step\s*\d+:?\s*/i, '').replace(/^Parameter\s*\$?/, '').replace(/[\$:._].*$/, '').trim();

        detectedEmptyScenarios.push({ col: sCol, name: scenName, entity: normEntity, rowLabel: cleanLabel });

        const sentinelRecord = sentinelEntities.get(normEntity.toLowerCase());
        const hasEntitySentinel = sentinelRecord && sentinelRecord.isValid;

        if (!hasEntitySentinel && normEntity.length > 1) {
          missingSentinelErrors.push({
            scenName,
            entity: normEntity,
            paramName: cleanLabel
          });
        }
      }
    }

    if (!cellEmptyFound && isHeaderEmpty) {
      // Header or description mentions empty/unassigned (e.g. "CarSize is unassigned")
      const textToScan = `${scenName} ${scenDesc} ${sCol}`;
      let targetEntity = "Object Parameter";

      // Match against registered sentinel entities and created entities first
      for (const knownEntity of [...sentinelEntities.keys(), ...createdEntities.keys()]) {
        if (new RegExp(`\\b${knownEntity}\\b`, 'i').test(textToScan)) {
          const matched = sentinelEntities.get(knownEntity) || createdEntities.get(knownEntity);
          targetEntity = matched.entity;
          break;
        }
      }

      // If no registered sentinel matched, search for entity candidate excluding common stop words
      if (targetEntity === "Object Parameter") {
        const stopWords = /^(?:Unassigned|Empty|Null|Missing|Scenario|Case|No|Without|None|Step|Object|Parameter|Filter|Boundary|Expected|Default)$/i;
        const words = textToScan.match(/\b([A-Z][a-zA-Z0-9_]*)\b/g) || [];
        const candidate = words.find(w => !stopWords.test(w));
        if (candidate) targetEntity = candidate;
      }

      detectedEmptyScenarios.push({ col: sCol, name: scenName, entity: targetEntity, rowLabel: sCol });

      const sentinelRecord = sentinelEntities.get(targetEntity.toLowerCase());
      const hasEntitySentinel = sentinelRecord && sentinelRecord.isValid;

      if (!hasEntitySentinel) {
        missingSentinelErrors.push({
          scenName,
          entity: targetEntity,
          paramName: targetEntity
        });
      }
    }
  }

  // Check created entities for missing sentinels in backend microflow tests (non-data-seeding)
  const isDataSeeding = metadata && metadata.test_intent === 'data_seeding';
  if (!isDataSeeding && createdEntities.size > 0 && hasMicroflowCall) {
    for (const [entKey, entInfo] of createdEntities.entries()) {
      const sentinel = sentinelEntities.get(entKey);
      const alreadyDirectFlagged = directCreateToMicroflowErrors.some(e => e.entity.toLowerCase() === entKey);
      const alreadyMissingFlagged = missingSentinelErrors.some(e => e.entity.toLowerCase() === entKey);
      if ((!sentinel || !sentinel.isValid) && !alreadyDirectFlagged && !alreadyMissingFlagged) {
        missingSentinelErrors.push({
          scenName: 'All Scenarios',
          entity: entInfo.entity,
          paramName: entInfo.entity
        });
      }
    }
  }

  // 6. Report checks
  let pat07CheckReported = false;

  // A. Direct CreateObject to Microflow parameter binding errors
  if (directCreateToMicroflowErrors.length > 0) {
    for (const err of directCreateToMicroflowErrors) {
      addCheck(
        "PAT-07 & ANTI-48: Master Step Sentinel Retrieve for Empty Boundaries",
        false,
        `Step ${err.stepIdx} (CallMicroflow) binds parameter directly to CreateObject handle '${err.handle}' from Step ${err.producerStepIdx} (entity '${err.entity}'). Microflow object parameters cannot bind directly to CreateObject because MTA CreateObject cannot be skipped dynamically at runtime; Section 3 (Master Step Ledger) lacks a PAT-07 Retrieve-from-Teststep sentinel step specifically for entity '${err.entity}'.`,
        "ANTI-48_VIOLATION"
      );
    }
    pat07CheckReported = true;
  }

  // A2. Direct CreateObject to CreateObject association binding errors
  if (directCreateToCreateAssocErrors.length > 0) {
    for (const err of directCreateToCreateAssocErrors) {
      addCheck(
        "PAT-07 & ANTI-48: Master Step Sentinel Retrieve for Empty Boundaries",
        false,
        `Step ${err.stepIdx} (CreateObject) binds association directly to CreateObject handle '${err.handle}' from Step ${err.producerStepIdx} (entity '${err.entity}'). Associations to created objects must pass through a PAT-07 Retrieve-from-Teststep sentinel step to allow testing unassigned/empty associations dynamically.`,
        "ANTI-48_VIOLATION"
      );
    }
    pat07CheckReported = true;
  }

  // B. Missing sentinel errors for empty scenarios or created entities
  if (missingSentinelErrors.length > 0) {
    for (const err of missingSentinelErrors) {
      addCheck(
        "PAT-07 & ANTI-48: Master Step Sentinel Retrieve for Empty Boundaries",
        false,
        `Scenario '${err.scenName}' tests an empty/null object for parameter '${err.paramName}', but Section 3 (Master Step Ledger) lacks a PAT-07 Retrieve-from-Teststep sentinel step specifically for entity '${err.entity}'. Persistent MTA test cases cannot dynamically omit steps; empty object boundaries must be driven via PAT-07 sentinel filtering.`,
        "ANTI-48_VIOLATION"
      );
    }
    pat07CheckReported = true;
  }

  // C. Empty scenario mandate for backend unit tests with microflows (non-data-seeding)
  if (!isDataSeeding && createdEntities.size > 0 && hasMicroflowCall && detectedEmptyScenarios.length === 0) {
    addCheck(
      "PAT-07 & ANTI-48: Master Step Sentinel Retrieve for Empty Boundaries",
      false,
      `Backend unit test creates objects (${Array.from(createdEntities.values()).map(e => `'${e.entity}'`).join(', ')}) for microflow execution, but Section 4 (Test Scenarios & Test Data) lacks a PAT-07 empty/null parameter variation scenario. Testing empty parameters is mandatory for all backend unit tests: add at least one scenario testing an empty/null boundary (e.g. setting Sentinel to 'NONE' or testing unassigned/empty parameter).`,
      "ANTI-48_VIOLATION"
    );
    pat07CheckReported = true;
  }

  // C2. Verify that sentinel filter rows in Section 4 contain at least one 'NONE', 'NULL', or 'EMPTY' cell
  if (variationMatrixTable && sentinelEntities.size > 0) {
    for (const row of variationMatrixTable.rows) {
      const rowLabel = targetColKey ? row[targetColKey] : Object.values(row)[0] || '';
      const cleanLabel = rowLabel.replace(/[`*_]/g, '').trim();
      if (/SentinelKey/i.test(cleanLabel) || (/Filter/i.test(cleanLabel) && /Sentinel/i.test(cleanLabel))) {
        let hasEmptyCell = false;
        for (const sCol of scenarioCols) {
          const val = (row[sCol] || '').replace(/[`*_\s]/g, '').toLowerCase();
          if (val === 'none' || val === 'null' || val === 'empty' || val === "''" || val === '""' || val === '-') {
            hasEmptyCell = true;
            break;
          }
        }
        if (!hasEmptyCell) {
          addCheck(
            "PAT-07 & ANTI-48: Master Step Sentinel Retrieve for Empty Boundaries",
            false,
            `Section 4 row '${cleanLabel}' does not contain any 'NONE', 'NULL', or 'EMPTY' boundary cells across scenarios. All sentinel filter rows in Section 4 MUST unconditionally include at least one scenario column testing the empty/null boundary.`,
            "ANTI-48_VIOLATION"
          );
          pat07CheckReported = true;
        }
      }
    }
  }

  // D. If not already reported, verify general PAT-07 compliance
  const meetsPat07 = hasRetrieveFromTeststep && hasValidSentinelFilter && !hasEnumFilterViolation && !hasLongSentinelViolation;

  if (!pat07CheckReported) {
    if (detectedEmptyScenarios.length > 0) {
      const primaryScen = detectedEmptyScenarios[0];
      const scenarioName = primaryScen.name;

      if (!meetsPat07) {
        addCheck(
          "PAT-07 & ANTI-48: Master Step Sentinel Retrieve for Empty Boundaries",
          false,
          `Scenario '${scenarioName}' tests an empty/null object or unassigned association, but Section 3 (Master Step Ledger) lacks a PAT-07 Retrieve-from-Teststep sentinel step. Persistent MTA test cases cannot dynamically omit steps; empty object boundaries must be driven via PAT-07 sentinel filtering.`,
          "ANTI-48_VIOLATION"
        );
      } else {
        addCheck(
          "PAT-07 & ANTI-48: Master Step Sentinel Retrieve for Empty Boundaries",
          true,
          null,
          null,
          `Scenario '${scenarioName}' tests empty/null boundary using PAT-07 Retrieve-from-Teststep sentinel filter`
        );
      }
    } else if (isDataSeeding) {
      addCheck(
        "PAT-07: Sentinel Filter for Null Parameter Boundaries",
        true,
        null,
        null,
        "Data seeding plan with pure valid records is exempt from mandatory PAT-07 sentinel retrieve"
      );
    } else if (/SentinelKey/i.test(ledgerRawText)) {
      addCheck(
        "PAT-07: Sentinel Filter for Null Parameter Boundaries",
        hasRetrieveFromTeststep && hasValidSentinelFilter,
        "SentinelKey referenced but no RetrieveObject step filters by SentinelKey",
        "MISSING_SENTINEL_RETRIEVE"
      );
    }
  }

  // E. PAT-08 Count assertion on sentinel retrieve
  if (detectedEmptyScenarios.length > 0 || sentinelEntities.size > 0 || hasRetrieveFromTeststep) {
    if (!hasSentinelCountAssertion) {
      addCheck(
        "PAT-08: Object Count Assertion on Sentinel Retrieve",
        false,
        `Section 3 lacks an embedded Assert Object Count assertion (PAT-08) on the sentinel retrieve step. Sentinel retrieve steps must verify existence with Assert Object Count.`,
        "MISSING_COUNT_ASSERTION"
      );
    } else {
      addCheck("PAT-08: Object Count Assertion on Sentinel Retrieve", true);
    }
  }
}

function checksHas(addCheckFn, name) {
  // helper to check if rule already registered
  return false;
}

function validateVariationMatrix(table, addCheck) {
  // Row headers / labels: prefer 'step target', 'target', 'step', or 2nd column if 1st is '#'
  const targetColKey = Object.keys(table.rows[0] || {}).find(k => {
    const l = k.toLowerCase().trim();
    return (l.includes('target') || l.includes('step')) && !l.includes('exec') && l !== '#';
  }) || (table.headers.length > 1 && table.headers[0].trim() === '#' ? table.headers[1] : table.headers[0]);
  const scenarioCols = table.headers.filter(h => {
    const trimmed = h.trim();
    if (trimmed === '#' || trimmed.toLowerCase() === 'case') return false;
    return /(?:scenario\s*#?\d+|^#\d+)/i.test(trimmed);
  });

  if (scenarioCols.length === 0) {
    addCheck("Variation Matrix Scenario Columns Found", false, "Matrix must have columns formatted as 'Scenario #1', 'Scenario #2', etc.", "INVALID_MATRIX_COLUMNS");
    return;
  }
  addCheck("Variation Matrix Scenario Columns Found", true, null, null, `Found ${scenarioCols.length} scenario column(s): ${scenarioCols.join(', ')}`);

  // PAT-110 & ANTI-59: Target-Bound Schema
  // Check that rows specify concrete step targets (e.g. Step X: Entity.Attribute)
  let hasScenarioNameRow = false;
  let hasScenarioDescRow = false;
  let hasAssociationRow = false;
  let conceptualFlagRows = [];

  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i];
    const rowLabel = targetColKey ? row[targetColKey] : Object.values(row)[0] || '';
    const cleanLabel = rowLabel.replace(/[`*_]/g, '').trim();

    if (/Scenario\s*Name/i.test(cleanLabel)) {
      hasScenarioNameRow = true;
      // Check all scenarios have names (PAT-77)
      for (const sCol of scenarioCols) {
        if (!row[sCol] || row[sCol].trim() === '') {
          addCheck(`PAT-77: Scenario Name for ${sCol}`, false, `Scenario name in column '${sCol}' cannot be empty`, "EMPTY_SCENARIO_NAME");
        }
      }
    } else if (/Scenario\s*Desc/i.test(cleanLabel)) {
      hasScenarioDescRow = true;
      for (const sCol of scenarioCols) {
        if (!row[sCol] || row[sCol].trim() === '') {
          addCheck(`PAT-77: Scenario Description for ${sCol}`, false, `Scenario description in column '${sCol}' cannot be empty`, "EMPTY_SCENARIO_DESC");
        }
      }
    } else {
      // Validate concrete target (PAT-110)
      const isTargetBound = /(?:Step\s*\d+|Assert|Filter)/i.test(cleanLabel);
      if (!isTargetBound && cleanLabel.length > 0) {
        conceptualFlagRows.push(cleanLabel);
      }

      // Check ANTI-48: Association bindings or object handles in variation matrix
      if (/(?:association|handle|object)\s*assigned/i.test(cleanLabel) || /assoc/i.test(cleanLabel)) {
        hasAssociationRow = true;
      }
    }
  }

  addCheck("PAT-77: Explicit Scenario Names Row", hasScenarioNameRow, "Matrix must include a 'Scenario Name' row", "MISSING_SCENARIO_NAMES");
  addCheck("PAT-77: Explicit Scenario Descriptions Row", hasScenarioDescRow, "Matrix must include a 'Scenario Description' row", "MISSING_SCENARIO_DESCS");

  if (conceptualFlagRows.length > 0) {
    addCheck("PAT-110: Target-Bound Matrix Schema", false, `Rows must target concrete test steps (e.g. 'Step 1: Entity.Attribute'). Found conceptual rows: ${conceptualFlagRows.join(', ')}`, "ANTI-59_VIOLATION");
  } else {
    addCheck("PAT-110: Target-Bound Matrix Schema", true);
  }

  if (hasAssociationRow) {
    addCheck("ANTI-48: Zero Association Rows in Matrix", false, "Object handles or association assignments cannot appear as variation rows. Use PAT-07 sentinel retrieves instead.", "ANTI-48_VIOLATION");
  } else {
    addCheck("ANTI-48: Zero Association Rows in Matrix", true);
  }
}

function scanAntiPatterns(content, stepTable, matrixTable, addCheck) {
  // ANTI-44: Sequence Reordering Serialization (No parallel reorderings)
  const parallelReorder = /parallel.*(?:SetSequenceOfTestStep|SetSequenceOfTestCase)/i.test(content);
  addCheck("ANTI-44: Serialized Step Sequencing", !parallelReorder, "Parallel batching of sequence reordering is prohibited", "ANTI-44_VIOLATION");

  // ANTI-20: Frontend UI vs Microflow Substitution
  if (content.includes("MenditectMxFrontendTestKit")) {
    const lines = content.split(/\r?\n/);
    const hasSubstitutedMicroflow = lines.some(line => {
      return /CallMicroflow/i.test(line) &&
        !line.includes("MenditectMxFrontendTestKit") &&
        !line.includes("MenditectPlaywrightConnector") &&
        /(?:ACT_|SUB_).*(?:button|click|page)/i.test(line);
    });
    addCheck(
      "ANTI-20: Frontend Isolation (No Microflow Substitution)",
      !hasSubstitutedMicroflow,
      "UI actions must drive the browser via FrontendTestKit, not backend microflows",
      "ANTI-20_VIOLATION"
    );
  }

  // ANTI-60: Unified Promotable Blueprint (No unrolled steps)
  const unrolledMatch = content.match(/###\s*Scenario\s*#?\d+[\s\S]*?CreateObject[\s\S]*?###\s*Scenario\s*#?\d+[\s\S]*?CreateObject/gi);
  if (unrolledMatch && unrolledMatch.length > 1) {
    addCheck("PAT-111 & ANTI-60: Unified Promotable Blueprint", false, "Execution plan contains unrolled duplicate step sequences per scenario. Must use a single master ledger parameterized by the Variation Matrix.", "ANTI-60_VIOLATION");
  } else {
    addCheck("PAT-111 & ANTI-60: Unified Promotable Blueprint", true);
  }
}

// ==========================================
// Smoke Audit Engine (mta-lint audit)
// ==========================================
export function runSmokeAudit(planPath, serverJsonPaths) {
  if (!fs.existsSync(planPath)) {
    throw new Error(`Execution plan not found: ${planPath}`);
  }
  const pathsList = Array.isArray(serverJsonPaths) ? serverJsonPaths : [serverJsonPaths];
  if (pathsList.length === 0 || !pathsList[0]) {
    throw new Error(`Server JSON data file path not provided`);
  }
  for (const p of pathsList) {
    if (!fs.existsSync(p)) {
      throw new Error(`Server JSON data file not found: ${p}`);
    }
  }

  const planContent = fs.readFileSync(planPath, 'utf-8');
  let serverData;
  if (pathsList.length === 1) {
    serverData = JSON.parse(fs.readFileSync(pathsList[0], 'utf-8'));
  } else {
    const casePayloads = pathsList.map((p, idx) => {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
      const tcObj = parsed.testCase || parsed;
      return {
        ...tcObj,
        SequenceNumber: tcObj.SequenceNumber !== undefined ? tcObj.SequenceNumber : (tcObj.sequenceNumber !== undefined ? tcObj.sequenceNumber : (idx + 1)),
        testSteps: parsed.testSteps || parsed.steps || tcObj.testSteps || tcObj.steps || [],
        dataVariationItems: parsed.dataVariationItems || parsed.variationItems || tcObj.dataVariationItems || tcObj.variationItems || [],
        dataVariations: parsed.scenarios || parsed.dataVariations || tcObj.scenarios || tcObj.dataVariations || [],
        constructionErrors: parsed.constructionErrors !== undefined ? parsed.constructionErrors : (parsed.TCER_TestConstructionErrors || tcObj.TCER_TestConstructionErrors || 0)
      };
    });
    const totalVariationItemsCount = casePayloads.reduce((sum, c) => sum + (c.dataVariationItems || []).length, 0);
    const casesWithVariations = casePayloads.filter(c => (c.dataVariationItems && c.dataVariationItems.length > 0) || (c.dataVariations && c.dataVariations.length > 0));
    const maxScenarios = casesWithVariations.reduce((max, c) => Math.max(max, (c.dataVariations || []).length), 0);
    const mergedDataVariations = [];
    for (let sIdx = 0; sIdx < maxScenarios; sIdx++) {
      const baseVar = casesWithVariations.find(c => c.dataVariations && c.dataVariations[sIdx])?.dataVariations[sIdx] || {};
      const anyCaseHasExplicitCellValues = casePayloads.some(c => {
        const cv = (c.dataVariations || [])[sIdx];
        return cv && Array.isArray(cv.TCVA_TestCaseVariationValues || cv.values || cv.cells);
      });
      if (!anyCaseHasExplicitCellValues) {
        mergedDataVariations.push({ ...baseVar });
        continue;
      }
      const baseVals = baseVar.TCVA_TestCaseVariationValues || baseVar.values || baseVar.cells || [];
      const singlePopulatedCaseHasAllItems =
        casesWithVariations.filter(c => c.dataVariations && c.dataVariations[sIdx]).length === 1 &&
        baseVals.length === totalVariationItemsCount;
      const mergedValues = [];
      if (singlePopulatedCaseHasAllItems) {
        mergedValues.push(...baseVals);
      } else {
        for (const c of casePayloads) {
          if (!c.dataVariationItems || c.dataVariationItems.length === 0) continue;
          const caseVar = (c.dataVariations || [])[sIdx];
          const caseVals = caseVar
            ? (caseVar.TCVA_TestCaseVariationValues || caseVar.values || caseVar.cells || [])
            : c.dataVariationItems.map(() => ({ value: '' }));
          mergedValues.push(...caseVals);
        }
      }
      mergedDataVariations.push({
        ...baseVar,
        TCVA_TestCaseVariationValues: mergedValues
      });
    }
    serverData = {
      name: casePayloads[0]?.name || 'Multi-Case Suite Audit',
      description: casePayloads.map(c => c.description || c.Description || '').find(d => d.trim().length > 0) || '',
      testCases: casePayloads,
      testSteps: casePayloads.flatMap(c => c.testSteps),
      dataVariationItems: casePayloads.flatMap(c => c.dataVariationItems),
      dataVariations: mergedDataVariations,
      TCER_TestConstructionErrors: casePayloads.reduce((sum, c) => sum + Number(c.constructionErrors || 0), 0)
    };
  }
  const tables = parseMarkdownTables(planContent);

  let stepLedgerTable = null;
  let variationMatrixTable = null;

  for (const t of tables) {
    const headerStr = t.headers.join(' ').toLowerCase();
    if (!stepLedgerTable && (headerStr.includes('step action') || headerStr.includes('output handle') || headerStr.includes('action & target'))) {
      stepLedgerTable = t;
    } else if (!variationMatrixTable && (headerStr.includes('step target') || headerStr.includes('scenario #1') || (headerStr.includes('scenario name') && headerStr.includes('scenario')))) {
      variationMatrixTable = t;
    }
  }

  const checks = [];
  const errors = [];
  const addCheck = (name, pass, reason = null, code = null, details = null) => {
    checks.push({ name, pass, reason, details });
    if (!pass) errors.push({ code: code || 'AUDIT_FAILED', message: reason });
  };

    // Phase Pre-0: Cryptographic Test Plan Immutability (PAT-124, ANTI-78)
  const metadata = extractMetadata(planContent);
  if (metadata && (metadata.protection_level === 'locked' || metadata.locked_sha256)) {
    const lockRes = verifyLockedExecutionPlan(planPath);
    addCheck(
      "Phase Pre-0: Cryptographic Test Plan Immutability (PAT-124, ANTI-78)",
      lockRes.valid,
      lockRes.valid ? null : (lockRes.errors[0]?.message || "Locked test plan tampered"),
      "LOCKED_TEST_TAMPERED",
      lockRes.valid ? `Hash verified: ${lockRes.hash}` : "Tamper detected"
    );
  }

  // Phase 0: Test Case Count & Sequence Parity (for Suite Audit)
  const plannedCases = new Set();
  if (stepLedgerTable) {
    const caseColKey = Object.keys(stepLedgerTable.rows[0] || {}).find(k => /case|container/i.test(k));
    if (caseColKey) {
      for (const r of stepLedgerTable.rows) {
        const val = (r[caseColKey] || '').trim();
        if (val && val !== '-') plannedCases.add(val);
      }
    }
  }
  const plannedCaseCount = plannedCases.size > 0 ? plannedCases.size : 1;
  const serverCases = serverData.testCases || serverData.testCaseList || [];

  if (serverCases.length > 0) {
    const caseCountPass = serverCases.length === plannedCaseCount;
    addCheck(
      "Phase 0: Suite Test Case Count Parity (PAT-03)",
      caseCountPass,
      caseCountPass ? null : `Planned test cases: ${plannedCaseCount}, Server test cases in suite: ${serverCases.length}`,
      "CASE_COUNT_MISMATCH",
      `Planned: ${plannedCaseCount} | Server: ${serverCases.length}`
    );

    let sequenceErrors = [];
    for (let i = 0; i < serverCases.length; i++) {
      const tc = serverCases[i];
      const seq = tc.SequenceNumber !== undefined ? tc.SequenceNumber : (tc.sequenceNumber !== undefined ? tc.sequenceNumber : (i + 1));
      const expectedSeq = i + 1;
      if (seq !== expectedSeq) {
        sequenceErrors.push(`Case '${tc.name || tc.key || i + 1}' has SequenceNumber ${seq}, expected ${expectedSeq}`);
      }
    }
    const sequencePass = sequenceErrors.length === 0;
    addCheck(
      "Phase 0: Suite Test Case Sequence Parity (PAT-11)",
      sequencePass,
      sequencePass ? null : sequenceErrors.join('; '),
      "CASE_SEQUENCE_MISMATCH",
      sequencePass ? "All test cases ordered sequentially (1..N)" : sequenceErrors.join('; ')
    );
  }

  // Phase 1: Step Count & Action Type Parity (excluding PAT-115 decommissioned [TO DELETE] steps)
  const plannedSteps = stepLedgerTable ? stepLedgerTable.rows : [];
  let rawServerSteps = serverData.testSteps || serverData.steps || [];
  if (rawServerSteps.length === 0 && serverCases.length > 0) {
    rawServerSteps = serverCases.flatMap(tc => tc.testSteps || tc.steps || []);
  }

  const decommissionedServerSteps = [];
  const invalidDecommissionedSteps = [];
  const serverSteps = [];

  for (const s of rawServerSteps) {
    const stepName = (s.TestStepName || s.name || s.Name || '').trim();
    const execCond = (s.ExecutionCondition || s.executionCondition || '').trim();
    if (/^\[TO DELETE\]/i.test(stepName)) {
      if (!execCond || /^skip$/i.test(execCond)) {
        decommissionedServerSteps.push(s);
      } else {
        invalidDecommissionedSteps.push(`Decommissioned step '${stepName}' has ExecutionCondition '${execCond}', expected 'Skip' (PAT-115)`);
        decommissionedServerSteps.push(s);
      }
    } else {
      serverSteps.push(s);
    }
  }

  if (invalidDecommissionedSteps.length > 0) {
    addCheck(
      "Phase 1: PAT-115 Decommissioned Step Skip Condition",
      false,
      invalidDecommissionedSteps.join('; '),
      "PAT-115_VIOLATION"
    );
  }

  const pCount = plannedSteps.length;
  const sCount = serverSteps.length;
  const decommissionedNote = decommissionedServerSteps.length > 0 ? ` (${decommissionedServerSteps.length} decommissioned [TO DELETE] step(s) excluded per PAT-115)` : '';

  const phase1Pass = pCount === sCount;
  addCheck("Phase 1: Step Count Parity", phase1Pass, phase1Pass ? null : `Planned steps: ${pCount}, Active server steps: ${sCount}${decommissionedNote}`, "STEP_COUNT_MISMATCH", `Planned: ${pCount} | Active Server: ${sCount}${decommissionedNote}`);

  // PAT-07 Server OactRetrieveOption Check (when field is present on server step)
  let pat07ServerErrors = [];
  for (let idx = 0; idx < serverSteps.length; idx++) {
    const sStep = serverSteps[idx];
    const pRow = plannedSteps[idx];
    const pText = pRow ? Object.values(pRow).join(' ') : '';
    const isPat07Step = /PAT-07/i.test(pText) && /Retrieve/i.test(pText);
    const retrieveOpt = sStep.OactRetrieveOption !== undefined ? sStep.OactRetrieveOption : sStep.retrieveOption;
    if (isPat07Step && retrieveOpt !== undefined && String(retrieveOpt).toLowerCase() !== 'teststep') {
      pat07ServerErrors.push(`Step ${idx + 1} (${sStep.name || sStep.TestStepName || 'RetrieveObject'}) is tagged PAT-07 in plan but server OactRetrieveOption is '${retrieveOpt}' (expected 'Teststep')`);
    }
  }
  if (pat07ServerErrors.length > 0) {
    addCheck(
      "Phase 1: PAT-07 Sentinel Retrieve Option Verification",
      false,
      pat07ServerErrors.join('; '),
      "PAT-07_SERVER_MISMATCH"
    );
  }

  // Phase 1b: Frontend High-Level Locator Generator Verification (PAT-64, ANTI-79)
  const isFrontendAudit = metadata && metadata.category === 'Frontend';
  if (isFrontendAudit && serverSteps.length > 0) {
    let unparameterizedLocators = [];
    for (let i = 0; i < serverSteps.length; i++) {
      const step = serverSteps[i];
      const stepName = step.name || step.actionType || '';
      const stepDesc = step.description || '';
      const isPageLoc = /Locate_MxPage/i.test(stepName) || /Locate_MxPage/i.test(stepDesc);
      if (isPageLoc) {
        const params = step.parameters || step.parameterValues || [];
        const pageParam = Array.isArray(params) ? params.find(p => p.name === 'Page' || p.parameterName === 'Page') : null;
        if (pageParam && (pageParam.value === null || pageParam.value === '' || pageParam.value === 'Empty')) {
          unparameterizedLocators.push(`Step ${i + 1} (${stepName}) has unbound 'Page' parameter (ANTI-79)`);
        }
      }
    }
    const locatorsPass = unparameterizedLocators.length === 0;
    addCheck(
      "Phase 1: High-Level Locator Generator Verification (PAT-64, ANTI-79)",
      locatorsPass,
      locatorsPass ? null : unparameterizedLocators.join('; '),
      "ANTI-79_VIOLATION",
      locatorsPass ? "All frontend page and widget locators verified" : unparameterizedLocators.join('; ')
    );
  }

  // Phase 2: Variation Item Registration
  const plannedVarRows = variationMatrixTable ? variationMatrixTable.rows.filter(r => {
    const rowText = Object.values(r).join(' ');
    return !/Scenario\s*(?:Name|Desc)/i.test(rowText);
  }) : [];
  const serverVarItems = serverData.dataVariationItems || serverData.variationItems || [];
  const phase2Pass = plannedVarRows.length === serverVarItems.length;
  addCheck("Phase 2: Variation Item Registration Parity", phase2Pass, phase2Pass ? null : `Planned variation rows: ${plannedVarRows.length}, Server registered items: ${serverVarItems.length}`, "VARIATION_ITEM_MISMATCH", `Planned: ${plannedVarRows.length} | Registered: ${serverVarItems.length}`);

  // Helper to normalize cell strings for comparison
  const cleanCell = (str) => {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/^[`'"]+|[`'"]+$/g, '')
      .replace(/^\*\*|\*\*$/g, '')
      .trim();
  };

  // Phase 3: Scenario Metadata (Columns, Names, Descriptions Value Parity)
  const scenarioCols = variationMatrixTable ? variationMatrixTable.headers.filter(h => /scenario\s*#?\d+/i.test(h)) : [];
  const serverScenarios = serverData.scenarios || serverData.dataVariations || [];
  const phase3CountPass = scenarioCols.length === serverScenarios.length;
  addCheck("Phase 3: Scenario Count Registration", phase3CountPass, phase3CountPass ? null : `Planned scenarios: ${scenarioCols.length}, Server scenarios: ${serverScenarios.length}`, "SCENARIO_COUNT_MISMATCH", `Planned: ${scenarioCols.length} | Server: ${serverScenarios.length}`);

  // Find Scenario Name row and Scenario Description row in variationMatrixTable
  let scenarioNameRow = null;
  let scenarioDescRow = null;
  if (variationMatrixTable) {
    for (const r of variationMatrixTable.rows) {
      const rowStr = Object.values(r).join(' ').toLowerCase();
      if (rowStr.includes('scenario name')) {
        scenarioNameRow = r;
      } else if (rowStr.includes('scenario desc')) {
        scenarioDescRow = r;
      }
    }
  }

  let scenarioNamesMatched = 0;
  let scenarioDescsMatched = 0;

  if (scenarioCols.length > 0 && serverScenarios.length > 0) {
    for (let idx = 0; idx < scenarioCols.length; idx++) {
      const colHeader = scenarioCols[idx];
      const serverVar = serverScenarios[idx];
      if (!serverVar) {
        addCheck(
          `Phase 3: Scenario #${idx + 1} Presence on Server`,
          false,
          `Planned Scenario #${idx + 1} (${colHeader}) is missing on the MTA server`,
          "MISSING_SERVER_SCENARIO",
          `Missing: ${colHeader}`
        );
        continue;
      }

      const serverName = cleanCell(serverVar.name || serverVar.Name || '');
      const serverDesc = cleanCell(serverVar.description || serverVar.Description || '');

      if (scenarioNameRow) {
        const plannedName = cleanCell(scenarioNameRow[colHeader]);
        if (plannedName) {
          const match = serverName === plannedName;
          addCheck(
            `Phase 3: Scenario #${idx + 1} Name Parity (PAT-77)`,
            match,
            match ? null : `Scenario #${idx + 1} name mismatch: expected '${plannedName}', found '${serverName}'`,
            "SCENARIO_NAME_MISMATCH",
            `Planned: '${plannedName}' | Server: '${serverName}'`
          );
          if (match) scenarioNamesMatched++;
        }
      }

      if (scenarioDescRow) {
        const plannedDesc = cleanCell(scenarioDescRow[colHeader]);
        if (plannedDesc) {
          const match = serverDesc === plannedDesc;
          addCheck(
            `Phase 3: Scenario #${idx + 1} Description Parity (PAT-77)`,
            match,
            match ? null : `Scenario #${idx + 1} description mismatch: expected '${plannedDesc}', found '${serverDesc}'`,
            "SCENARIO_DESCRIPTION_MISMATCH",
            `Planned: '${plannedDesc}' | Server: '${serverDesc}'`
          );
          if (match) scenarioDescsMatched++;
        }
      }

      // Phase 4a: M x N Cell-by-Cell Variation Matrix Value Parity (when cell values are provided in server JSON)
      const rawCellValues = serverVar.TCVA_TestCaseVariationValues || serverVar.variationValues || serverVar.values;
      if (Array.isArray(rawCellValues) && plannedVarRows.length > 0) {
        let cellErrors = [];
        for (let rIdx = 0; rIdx < plannedVarRows.length; rIdx++) {
          const pRow = plannedVarRows[rIdx];
          const plannedCellVal = cleanCell(pRow[colHeader]);
          const serverCellObj = rawCellValues[rIdx];
          if (serverCellObj === undefined) continue;
          const serverCellRaw = (typeof serverCellObj === 'object' && serverCellObj !== null)
            ? (serverCellObj.value !== undefined ? serverCellObj.value : (serverCellObj.Value !== undefined ? serverCellObj.Value : ''))
            : serverCellObj;
          const serverCellVal = cleanCell(serverCellRaw);
          if (plannedCellVal !== serverCellVal) {
            cellErrors.push(`Row ${rIdx + 1} in Scenario #${idx + 1}: expected '${plannedCellVal}', found '${serverCellVal}'`);
          }
        }
        const cellsPass = cellErrors.length === 0;
        addCheck(
          `Phase 4: Scenario #${idx + 1} Cell Value Parity`,
          cellsPass,
          cellsPass ? null : cellErrors.join('; '),
          "CELL_VALUE_MISMATCH",
          cellsPass ? `All ${plannedVarRows.length} cell(s) reconciled` : cellErrors.join('; ')
        );
      }
    }
  }

  // Phase 4: MTA Construction Errors Check
  const constructionErrors = serverData.constructionErrors !== undefined ? serverData.constructionErrors : (serverData.TCER_TestConstructionErrors || 0);
  const phase4Pass = constructionErrors === 0;
  addCheck("Phase 4: Server Model Construction Errors", phase4Pass, phase4Pass ? null : `Server reported ${constructionErrors} construction error(s)`, "CONSTRUCTION_ERRORS", `TCER_TestConstructionErrors: ${constructionErrors}`);

  // Phase 5: Documentation & Pattern Annotations Verification (PAT-12)
  let stepDocCount = 0;
  let stepPatternTagMatches = 0;
  let totalPatternTagsExpected = 0;

  for (let idx = 0; idx < serverSteps.length; idx++) {
    const serverStep = serverSteps[idx];
    const stepDesc = cleanCell(serverStep.description || serverStep.Description || '');
    const plannedStepRow = plannedSteps[idx];

    if (!stepDesc) {
      addCheck(
        `Phase 5: Step ${idx + 1} Description Populated (PAT-12)`,
        false,
        `Step ${idx + 1} (${serverStep.name || serverStep.actionType || 'Step'}) has no description on server`,
        "STEP_DESCRIPTION_EMPTY"
      );
    } else {
      addCheck(
        `Phase 5: Step ${idx + 1} Description Populated (PAT-12)`,
        true,
        null,
        null,
        stepDesc
      );
      stepDocCount++;

      // If planned step references PAT-xx, verify it is annotated in server step description
      if (plannedStepRow) {
        const plannedRowText = Object.values(plannedStepRow).join(' ');
        const patTags = plannedRowText.match(/PAT-\d+/gi);
        if (patTags) {
          for (const tag of patTags) {
            totalPatternTagsExpected++;
            const hasTag = stepDesc.toUpperCase().includes(tag.toUpperCase());
            addCheck(
              `Phase 5: Step ${idx + 1} Pattern Annotation (${tag})`,
              hasTag,
              hasTag ? null : `Step ${idx + 1} description missing expected pattern tag '${tag}'`,
              "STEP_PATTERN_TAG_MISMATCH",
              `Expected: '${tag}' in '${stepDesc}'`
            );
            if (hasTag) stepPatternTagMatches++;
          }
        }
      }
    }
  }

  // Test Case Description Check
  const tcDesc = cleanCell(serverData.description || serverData.Description || (serverData.testCase && serverData.testCase.description) || '');
  const tcDescPass = tcDesc.length > 0;
  addCheck(
    "Phase 5: Test Case Description Populated",
    tcDescPass,
    tcDescPass ? null : "Test Case description is empty on server",
    "TESTCASE_DESCRIPTION_EMPTY",
    tcDescPass ? tcDesc : "Empty"
  );

  // Phase 6: DateTime & DatePicker Configuration Parity (PAT-94, PAT-42, ANTI-45, ANTI-53)
  let dateStepErrors = [];
  let datePickerStepChecked = false;

  for (let idx = 0; idx < serverSteps.length; idx++) {
    const sStep = serverSteps[idx];
    const sText = JSON.stringify(sStep);

    // Check for unparsed macros on server
    const macroMatch = sText.match(/\[%(?:CurrentDateTime|BeginOfCurrentDay|EndOfCurrentDay)[\s\S]*?%\]/i);
    if (macroMatch) {
      dateStepErrors.push(`Step ${idx + 1} contains unparsed date macro '${macroMatch[0]}' on server (ANTI-53)`);
    }

    // Check DatePicker steps on server
    if (/ACT_Fill_DatePicker_Input/i.test(sText) || (sStep.name && /DatePicker/i.test(sStep.name))) {
      datePickerStepChecked = true;
      // If the execution plan documented a custom date format, verify step description or parameter contains date formatting info
      if (/(?:CustomDateFormat|dd-MM-yyyy|yyyy-MM-dd|MM\/dd\/yyyy)/i.test(planContent)) {
        const hasDateDesc = sStep.description && /(?:CustomDateFormat|date|format|dd|yyyy|MM)/i.test(sStep.description);
        const hasDateParam = sStep.parameters && JSON.stringify(sStep.parameters).length > 2;
        if (!hasDateDesc && !hasDateParam && !sStep.description) {
          dateStepErrors.push(`Step ${idx + 1} (${sStep.name || 'DatePicker'}) missing date format documentation or parameters on server (PAT-94)`);
        }
      }
    }
  }

  const phase6Pass = dateStepErrors.length === 0;
  addCheck(
    "Phase 6: DateTime & DatePicker Configuration Parity",
    phase6Pass,
    phase6Pass ? null : dateStepErrors.join('; '),
    "DATETIME_CONFIG_MISMATCH",
    datePickerStepChecked ? "DatePicker step verified on server" : "No DatePicker steps or macro violations detected"
  );

  // Phase 6b: Frontend Validation Feedback Configuration Parity (PAT-119)
  let valStepErrors = [];
  let plannedValLocators = 0;
  let serverValSteps = 0;

  if (stepLedgerTable) {
    for (const r of stepLedgerTable.rows) {
      const text = Object.values(r).join(' ');
      if (/Locate_MxWidget_[A-Za-z0-9]+_ValidationMessage/i.test(text)) {
        plannedValLocators++;
      }
    }
  }

  for (let idx = 0; idx < serverSteps.length; idx++) {
    const sStep = serverSteps[idx];
    const sText = JSON.stringify(sStep);

    if (/Locate_MxWidget_[A-Za-z0-9]+_ValidationMessage/i.test(sText) || (sStep.name && /ValidationMessage/i.test(sStep.name))) {
      serverValSteps++;
      const hasDesc = sStep.description && sStep.description.length > 5;
      if (!hasDesc) {
        valStepErrors.push(`Step ${idx + 1} (${sStep.name || 'ValidationMessage'}) missing description documenting triggering event or flow on server (PAT-12)`);
      }
    }
  }

  const phase6bPass = valStepErrors.length === 0;
  addCheck(
    "Phase 6b: Frontend Validation Feedback Assertions (PAT-119)",
    phase6bPass,
    phase6bPass ? null : valStepErrors.join('; '),
    "FRONTEND_VALIDATION_CONFIG_MISMATCH",
    plannedValLocators > 0 ? `Planned: ${plannedValLocators} | Server Verified: ${serverValSteps}` : "No frontend validation message steps planned"
  );

  const valid = errors.length === 0;

  // Generate Receipt
  const phase0Line = serverCases.length > 0
    ? `* **Phase 0 (Suite Cases & Sequence):** Planned Cases: ${plannedCaseCount} | Server Cases: ${serverCases.length} | Status: ${serverCases.length === plannedCaseCount && errors.every(e => !e.code.startsWith('CASE_')) ? 'PASS' : 'FAIL'}\n`
    : '';

  const receipt = `
${phase0Line}* **Phase 1 (Step Count Parity):** Planned: ${pCount} | Server: ${sCount} | Status: ${phase1Pass ? 'PASS' : 'FAIL'}
* **Phase 2 (Variation Item Registration):** Planned: ${plannedVarRows.length} | Registered: ${serverVarItems.length} | Status: ${phase2Pass ? 'PASS' : 'FAIL'}
* **Phase 3 (Scenario Metadata & Doc Parity):** Planned Columns: ${scenarioCols.length} | Names Verified: ${scenarioNamesMatched}/${scenarioCols.length} | Descriptions Verified: ${scenarioDescsMatched}/${scenarioCols.length} | Status: ${errors.some(e => e.code.startsWith('SCENARIO_')) ? 'FAIL' : 'PASS'}
* **Phase 4 (Construction Errors):** TCER_TestConstructionErrors == ${constructionErrors} | Status: ${phase4Pass ? 'PASS' : 'FAIL'}
* **Phase 5 (Documentation & Pattern Annotations):** Steps Documented: ${stepDocCount}/${serverSteps.length} | Pattern Tags: ${stepPatternTagMatches}/${totalPatternTagsExpected} | TC Description: ${tcDescPass ? 'PASS' : 'EMPTY'} | Status: ${errors.some(e => e.code.startsWith('STEP_') || e.code.startsWith('TESTCASE_')) ? 'FAIL' : 'PASS'}
* **Phase 6 (DateTime & DatePicker Formats):** Macro Violations: ${dateStepErrors.length} | DatePicker Verified: ${datePickerStepChecked ? 'YES' : 'N/A'} | Status: ${phase6Pass ? 'PASS' : 'FAIL'}
* **Phase 6b (Frontend Validation Assertions):** Planned: ${plannedValLocators} | Server: ${serverValSteps} | Status: ${phase6bPass ? 'PASS' : 'FAIL'}
* **Overall Smoke Audit Verdict:** ${valid ? 'PASS (0 Discrepancies)' : 'FAIL'}
`.trim();

  return {
    valid,
    target: path.basename(planPath),
    passedCount: checks.filter(c => c.pass).length,
    totalCount: checks.length,
    checks,
    errors,
    receipt
  };
}

// ==========================================
// Config Validator (mta-lint config)
// ==========================================
export function lintConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return {
      valid: false,
      target: configPath,
      passedCount: 0,
      totalCount: 1,
      checks: [{ name: "Config File Existence", pass: false, reason: `File not found: ${configPath}` }],
      errors: [{ code: "CONFIG_NOT_FOUND", message: `Config file not found at ${configPath}` }]
    };
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
    return {
      valid: false,
      target: configPath,
      passedCount: 0,
      totalCount: 1,
      checks: [{ name: "JSON Syntax", pass: false, reason: `Invalid JSON: ${err.message}` }],
      errors: [{ code: "INVALID_JSON", message: err.message }]
    };
  }

  const checks = [];
  const errors = [];
  const addCheck = (name, pass, reason = null, code = null) => {
    checks.push({ name, pass, reason });
    if (!pass) errors.push({ code: code || 'CONFIG_ERROR', message: reason });
  };

  const requiredFields = [
    "mta_base_url",
    "mcp_endpoint",
    "application_name",
    "execution_plans_dir",
    "mendix_project_dir"
  ];

  for (const field of requiredFields) {
    addCheck(`Property '${field}' Present`, !!config[field], `Missing required property '${field}' in mta_config.json`, `MISSING_${field.toUpperCase()}`);
  }

  if (config.mta_license_tier) {
    const validTiers = ["free_exploratory", "paid_enterprise", "auto"];
    addCheck("License Tier Valid", validTiers.includes(config.mta_license_tier), `Invalid mta_license_tier: '${config.mta_license_tier}'. Expected one of: ${validTiers.join(', ')}`, "INVALID_LICENSE_TIER");
  }

  return {
    valid: errors.length === 0,
    target: path.basename(configPath),
    passedCount: checks.filter(c => c.pass).length,
    totalCount: checks.length,
    checks,
    errors
  };
}

// ==========================================
// Artifact Traceability Linter (MTA-LINT-E010, PAT-43, ANTI-46)
// ==========================================
export function lintArtifacts(outputDir = 'menditect-output', options = {}) {
  const checks = [];
  const errors = [];

  const addCheck = (name, pass, reason = null, code = null, details = null) => {
    checks.push({ name, pass, reason, code, details });
    if (!pass) {
      errors.push({ code: code || 'MTA-LINT-E010', message: reason });
    }
  };

  const resolvedDir = path.resolve(process.cwd(), outputDir);

  if (!fs.existsSync(resolvedDir)) {
    addCheck(
      "Output Directory Check",
      true,
      null,
      null,
      `Directory '${outputDir}' does not exist (no execution outputs to audit)`
    );
    return {
      valid: true,
      target: outputDir,
      passedCount: 1,
      totalCount: 1,
      checks,
      errors
    };
  }

  // 1. Resolve execution plans directory
  let plansDir = path.join(resolvedDir, 'execution-plans');
  if (!fs.existsSync(plansDir)) {
    plansDir = resolvedDir;
  }

  // 2. Discover and index all Execution Plan markdown files
  const discoveredPlans = new Map();
  const planFiles = [];

  function scanPlans(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory() && ent.name !== 'archive' && ent.name !== 'node_modules') {
        scanPlans(full);
      } else if (ent.isFile() && (ent.name.startsWith('EP_') || ent.name.endsWith('.md'))) {
        planFiles.push({ name: ent.name, path: full });
      }
    }
  }

  scanPlans(plansDir);

  for (const pf of planFiles) {
    const content = fs.readFileSync(pf.path, 'utf8');
    const metadata = extractMetadata(content);

    let tcName = pf.name.replace(/^EP_/i, '').replace(/\.md$/i, '');
    if (metadata && metadata.plan_id) {
      const planIdName = String(metadata.plan_id).replace(/-v\d+.*$/i, '');
      if (planIdName) tcName = planIdName;
    }

    const hasStatus = metadata && (metadata.status || metadata.execution_status);
    const hasTarget = metadata && (metadata.target || metadata.application || metadata.component_under_test || metadata.plan_id || metadata.category);
    const isValidHeader = hasStatus && hasTarget;

    if (!isValidHeader) {
      addCheck(
        `Execution Plan Header: ${pf.name}`,
        false,
        `[MTA-LINT-E010] [missing-execution-plan-artifact] Execution Plan '${pf.name}' has malformed or missing metadata header (missing status or target specification).`,
        "MTA-LINT-E010",
        `Header inspection failed in ${pf.path}`
      );
    } else {
      addCheck(
        `Execution Plan Header: ${pf.name}`,
        true,
        null,
        null,
        `Valid frontmatter header (status: ${metadata.status || 'PRESENT'})`
      );
    }

    const planEntry = {
      file: pf.name,
      path: pf.path,
      metadata,
      content,
      testName: tcName
    };

    discoveredPlans.set(tcName.toLowerCase(), planEntry);
    discoveredPlans.set(pf.name.toLowerCase(), planEntry);
    discoveredPlans.set(pf.name.replace(/\.md$/i, '').toLowerCase(), planEntry);
    discoveredPlans.set(pf.name.replace(/^EP_/i, '').replace(/\.md$/i, '').toLowerCase(), planEntry);
    if (metadata && metadata.plan_id) {
      discoveredPlans.set(String(metadata.plan_id).toLowerCase(), planEntry);
    }
  }

  // 3. Discover test execution outputs / JSON payloads
  const executionFiles = [];

  function scanExecutions(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== 'execution-plans' && ent.name !== 'archive' && ent.name !== 'node_modules' && ent.name !== '.git') {
          scanExecutions(full);
        }
      } else if (ent.isFile() && ent.name.endsWith('.json')) {
        const lower = ent.name.toLowerCase();
        if (lower === 'mta_config.json' || lower === 'mta_state.json' || lower === 'package.json' || lower === 'tsconfig.json') {
          continue;
        }
        executionFiles.push({ name: ent.name, path: full });
      }
    }
  }

  scanExecutions(resolvedDir);

  if (executionFiles.length === 0 && planFiles.length === 0) {
    addCheck(
      "MTA Artifact Traceability",
      true,
      null,
      null,
      `No execution records or plans found in '${outputDir}'`
    );
  }

  // 4. Verify each execution file has a corresponding Execution Plan and matching target microflows
  const extractDomainMicroflows = (rawText) => {
    const flows = new Set();
    const mfRegex = /"(?:Microflow|MicroflowName|MicroflowQualifiedName)"\s*:\s*"([^"]+)"/gi;
    let m;
    while ((m = mfRegex.exec(rawText)) !== null) {
      const mf = m[1].trim();
      if (
        mf &&
        !mf.startsWith('MenditectMxFrontendTestKit.') &&
        !mf.startsWith('MenditectPlaywrightConnector.') &&
        !mf.startsWith('MtaPluginModule.')
      ) {
        flows.add(mf);
      }
    }
    return [...flows];
  };

  const allPlanContents = planFiles.map(pf => ({
    file: pf.name,
    content: fs.readFileSync(pf.path, 'utf8')
  }));

  for (const ef of executionFiles) {
    let isTestExecution = false;
    let explicitTcName = null;
    let rawExecText = '';

    try {
      rawExecText = fs.readFileSync(ef.path, 'utf8');
      const jsonContent = JSON.parse(rawExecText);
      if (jsonContent && typeof jsonContent === 'object') {
        if (
          jsonContent.RollbackTcseAfterExecution !== undefined ||
          jsonContent.TCEX_RQ_TestStepRun !== undefined ||
          jsonContent.TestStepRun !== undefined ||
          jsonContent.test_cases !== undefined ||
          jsonContent.testCase !== undefined ||
          jsonContent.test_case_name !== undefined ||
          jsonContent.TestCaseName !== undefined ||
          ef.name.startsWith('TC_') ||
          ef.name.startsWith('test_') ||
          ef.name.startsWith('TEST_')
        ) {
          isTestExecution = true;
          explicitTcName = jsonContent.test_case_name || jsonContent.TestCaseName || jsonContent.name || null;
        }
      }
    } catch (e) {
      if (ef.name.startsWith('TC_') || ef.name.startsWith('test_') || ef.name.endsWith('.jsonl')) {
        isTestExecution = true;
      }
    }

    const executedDomainFlows = extractDomainMicroflows(rawExecText);
    if (!isTestExecution && executedDomainFlows.length === 0) continue;

    const baseName = ef.name.replace(/\.json$/i, '');
    const cleanBaseName = baseName.replace(/_(?:Persisted|Result|Payload|Output)$/i, '');

    const candidates = [
      explicitTcName,
      baseName,
      cleanBaseName,
      baseName.replace(/^TC_/i, ''),
      cleanBaseName.replace(/^TC_/i, ''),
      `TC_${baseName}`,
      `TC_${cleanBaseName}`
    ].filter(Boolean).map(c => String(c).toLowerCase());

    let matchedPlan = null;
    for (const cand of candidates) {
      if (discoveredPlans.has(cand)) {
        matchedPlan = discoveredPlans.get(cand);
        break;
      }
    }

    if (matchedPlan) {
      // Also verify that any domain microflows invoked in the execution payload match the plan (or another valid EP_*.md in plansDir)
      const unmatchedFlows = executedDomainFlows.filter(mf => {
        const shortName = mf.includes('.') ? mf.split('.').pop() : mf;
        return !matchedPlan.content.includes(mf) && !matchedPlan.content.includes(shortName) &&
          !allPlanContents.some(p => p.content.includes(mf) || p.content.includes(shortName));
      });
      if (unmatchedFlows.length > 0) {
        addCheck(
          `Artifact Traceability: ${ef.name}`,
          false,
          `[MTA-LINT-E010] [unplanned-microflow-execution] Execution payload '${ef.name}' invokes domain microflow(s) [${unmatchedFlows.join(', ')}] not documented in '${matchedPlan.file}' or any Execution Plan in '${plansDir}' (PAT-43, ANTI-46).`,
          "MTA-LINT-E010",
          `Unplanned microflow(s) executed: ${unmatchedFlows.join(', ')}`
        );
      } else {
        addCheck(
          `Artifact Traceability: ${ef.name}`,
          true,
          null,
          null,
          `Matched Execution Plan '${matchedPlan.file}'`
        );
      }
    } else {
      addCheck(
        `Artifact Traceability: ${ef.name}`,
        false,
        `[MTA-LINT-E010] [missing-execution-plan-artifact] Orphaned test execution detected: '${ef.name}'. No corresponding Execution Plan 'EP_${cleanBaseName}.md' found in '${plansDir}'. Persisting an Execution Plan prior to execution is mandatory under PAT-43 and ANTI-46.`,
        "MTA-LINT-E010",
        `Execution payload at ${ef.path} lacks matching EP_*.md blueprint`
      );
    }
  }

  return {
    valid: errors.length === 0,
    target: outputDir,
    passedCount: checks.filter(c => c.pass).length,
    totalCount: checks.length,
    checks,
    errors
  };
}

// ==========================================
// Self-Test Suite (mta-lint self-test)
// ==========================================

export function runSelfTest() {
  const checks = [];
  const errors = [];

  const addCheck = (name, pass, reason = null) => {
    checks.push({ name, pass, reason });
    if (!pass) errors.push({ code: 'SELF_TEST_FAILED', message: `${name}: ${reason}` });
  };

  // Test 1: Parser unit test
  const sampleMarkdown = `
# Plan
<details><summary><b>Metadata</b></summary>
\`\`\`yaml
plan_id: "TC_Test-v1"
category: "Backend"
\`\`\`
</details>

## 1. Purpose & Scope
## 2. Component Under Test
## 3. Test Steps & Action Sequence

| # | Case | Step Action & Target | Input Handle | Output Handle | Parameters, Bindings & Initial Values | Embedded Assertions | Exec Settings |
| :-: | :--: | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | Case 1 | CreateObject (Order) | - | o1 | Total = 100 | - | None / Stop |

## 4. Test Scenarios & Test Data

| # | Step Target | Scenario #1 | Scenario #2 |
| :-: | :--- | :--- | :--- |
| 0 | Scenario Name | Scen 1 | Scen 2 |
| 0 | Scenario Description | Desc 1 | Desc 2 |
| 1 | Step 1: Order.Total | 100 | 200 |

## 5. Quality & Compliance Checks
`;

  const meta = extractMetadata(sampleMarkdown);
  addCheck("Self-Test: Metadata Extraction", meta && meta.plan_id === "TC_Test-v1", "Failed to extract plan_id");

  const tables = parseMarkdownTables(sampleMarkdown);
  addCheck("Self-Test: Table Parser Count", tables.length === 2, `Expected 2 tables, found ${tables.length}`);

  if (tables.length === 2) {
    addCheck("Self-Test: Step Table Headers", tables[0].headers.includes('Step Action & Target'), "Missing Step Action header");
    addCheck("Self-Test: Scenario Table Headers", tables[1].headers.includes('Scenario #1'), "Missing Scenario #1 header");
  }

  // Test 3: Fixture Files Integration Test (if fixtures exist)
  const __dirname = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1'));
  const fixturesDir = path.join(__dirname, 'fixtures');

  if (fs.existsSync(fixturesDir)) {
    const validPlan = path.join(fixturesDir, 'valid_plan.md');
    const invalidAssoc = path.join(fixturesDir, 'invalid_matrix_assoc.md');
    const invalidAnti01 = path.join(fixturesDir, 'invalid_step_anti01.md');
    const passServer = path.join(fixturesDir, 'server_response_pass.json');
    const failServer = path.join(fixturesDir, 'server_response_fail.json');

    if (fs.existsSync(validPlan)) {
      const res = lintExecutionPlan(validPlan);
      addCheck("Fixture: valid_plan.md passes", res.valid, `Expected valid, got invalid with ${res.errors.length} errors`);
    }

    if (fs.existsSync(invalidAssoc)) {
      const res = lintExecutionPlan(invalidAssoc);
      const caughtAnti48 = res.errors.some(e => e.code === 'ANTI-48_VIOLATION');
      addCheck("Fixture: invalid_matrix_assoc.md caught ANTI-48", !res.valid && caughtAnti48, "Expected invalid with ANTI-48");
    }

    if (fs.existsSync(invalidAnti01)) {
      const res = lintExecutionPlan(invalidAnti01);
      const caughtAnti01 = res.errors.some(e => e.code === 'ANTI-01_VIOLATION');
      addCheck("Fixture: invalid_step_anti01.md caught ANTI-01", !res.valid && caughtAnti01, "Expected invalid with ANTI-01");
    }

    const invalidAnti03 = path.join(fixturesDir, 'invalid_piped_retrieve_no_count.md');
    if (fs.existsSync(invalidAnti03)) {
      const res = lintExecutionPlan(invalidAnti03);
      const caughtAnti03 = res.errors.some(e => e.code === 'ANTI-03_VIOLATION');
      addCheck("Fixture: invalid_piped_retrieve_no_count.md caught ANTI-03", !res.valid && caughtAnti03, "Expected invalid with ANTI-03");
    }

    const validPipedRetrieveAssoc = path.join(fixturesDir, 'valid_pat07_piped_retrieve_to_assoc.md');
    if (fs.existsSync(validPipedRetrieveAssoc)) {
      const res = lintExecutionPlan(validPipedRetrieveAssoc);
      addCheck("Fixture: valid_pat07_piped_retrieve_to_assoc.md passes without ANTI-03 false positive", res.valid, `Expected valid, got invalid with ${res.errors.length} errors: ${res.errors.map(e => e.message).join('; ')}`);
    }

    const validFrontendPlan = path.join(fixturesDir, 'valid_frontend_plan.md');
    if (fs.existsSync(validFrontendPlan)) {
      const res = lintExecutionPlan(validFrontendPlan);
      addCheck("Fixture: valid_frontend_plan.md passes ANTI-20", res.valid, `Expected valid, got invalid with ${res.errors.length} errors: ${res.errors.map(e => e.message).join('; ')}`);
    }

    const invalidFrontendAnti20 = path.join(fixturesDir, 'invalid_frontend_anti20.md');
    if (fs.existsSync(invalidFrontendAnti20)) {
      const res = lintExecutionPlan(invalidFrontendAnti20);
      const caughtAnti20 = res.errors.some(e => e.code === 'ANTI-20_VIOLATION');
      addCheck("Fixture: invalid_frontend_anti20.md caught ANTI-20", !res.valid && caughtAnti20, "Expected invalid with ANTI-20");
    }

    const invalidDatePicker = path.join(fixturesDir, 'invalid_datepicker_no_format.md');
    if (fs.existsSync(invalidDatePicker)) {
      const res = lintExecutionPlan(invalidDatePicker);
      const caughtAnti45 = res.errors.some(e => e.code === 'ANTI-45_VIOLATION');
      addCheck("Fixture: invalid_datepicker_no_format.md caught ANTI-45", !res.valid && caughtAnti45, "Expected invalid with ANTI-45");
    }

    const invalidDateMacro = path.join(fixturesDir, 'invalid_date_macro.md');
    if (fs.existsSync(invalidDateMacro)) {
      const res = lintExecutionPlan(invalidDateMacro);
      const caughtAnti53 = res.errors.some(e => e.code === 'ANTI-53_VIOLATION');
      addCheck("Fixture: invalid_date_macro.md caught ANTI-53", !res.valid && caughtAnti53, "Expected invalid with ANTI-53");
    }

    const invalidEmptyPlan = path.join(fixturesDir, 'invalid_empty_object_no_sentinel.md');
    if (fs.existsSync(invalidEmptyPlan)) {
      const res = lintExecutionPlan(invalidEmptyPlan);
      const caughtPat07 = res.errors.some(e => e.code === 'ANTI-48_VIOLATION' && e.message.includes('lacks a PAT-07 Retrieve-from-Teststep sentinel step'));
      addCheck("Fixture: invalid_empty_object_no_sentinel.md caught PAT-07 & ANTI-48", !res.valid && caughtPat07, "Expected invalid with PAT-07 & ANTI-48 violation");
    }

    const invalidBackendNoSentinel = path.join(fixturesDir, 'invalid_backend_no_sentinel_empty.md');
    if (fs.existsSync(invalidBackendNoSentinel)) {
      const res = lintExecutionPlan(invalidBackendNoSentinel);
      const caughtPat07 = res.errors.some(e => e.code === 'ANTI-48_VIOLATION');
      addCheck("Fixture: invalid_backend_no_sentinel_empty.md caught mandatory PAT-07 violation", !res.valid && caughtPat07, "Expected invalid with mandatory PAT-07 ANTI-48 violation");
    }

    const invalidCreateInputHandle = path.join(fixturesDir, 'invalid_create_object_with_input_handle.md');
    if (fs.existsSync(invalidCreateInputHandle)) {
      const res = lintExecutionPlan(invalidCreateInputHandle);
      const caughtInputHandle = res.errors.some(e => e.code === 'INVALID_CREATE_OBJECT_INPUT_HANDLE');
      addCheck("Fixture: invalid_create_object_with_input_handle.md caught INVALID_CREATE_OBJECT_INPUT_HANDLE", !res.valid && caughtInputHandle, "Expected invalid with INVALID_CREATE_OBJECT_INPUT_HANDLE");
    }

    const invalidMultiParamPlan = path.join(fixturesDir, 'invalid_multi_param_pat07.md');
    if (fs.existsSync(invalidMultiParamPlan)) {
      const res = lintExecutionPlan(invalidMultiParamPlan);
      const caughtMultiPat07 = res.errors.some(e => e.code === 'ANTI-48_VIOLATION' && e.message.includes("entity 'Car'"));
      addCheck("Fixture: invalid_multi_param_pat07.md caught parameter-level PAT-07 violation for Car", !res.valid && caughtMultiPat07, "Expected invalid with parameter-level PAT-07 violation for Car");
    }

    const validMultiParamPlan = path.join(fixturesDir, 'valid_multi_param_pat07.md');
    if (fs.existsSync(validMultiParamPlan)) {
      const res = lintExecutionPlan(validMultiParamPlan);
      addCheck("Fixture: valid_multi_param_pat07.md passes multi-parameter PAT-07 check", res.valid, `Expected valid with multi-parameter PAT-07, got invalid with ${res.errors.length} errors: ${res.errors.map(e => e.message).join('; ')}`);
    }

    const validNullAssertPlan = path.join(fixturesDir, 'valid_plan_null_assert_compact_ledger.md');
    if (fs.existsSync(validNullAssertPlan)) {
      const res = lintExecutionPlan(validNullAssertPlan);
      addCheck("Fixture: valid_plan_null_assert_compact_ledger.md passes null assertion & compact ledger check", res.valid, `Expected valid with null assert and compact ledger, got invalid with ${res.errors.length} errors: ${res.errors.map(e => e.message).join('; ')}`);
    }

    const validSentinelPlan = path.join(fixturesDir, 'valid_plan_with_sentinel.md');
    if (fs.existsSync(validSentinelPlan)) {
      const res = lintExecutionPlan(validSentinelPlan);
      addCheck("Fixture: valid_plan_with_sentinel.md passes", res.valid, `Expected valid with PAT-07 sentinel filter, got invalid with ${res.errors.length} errors: ${res.errors.map(e => e.message).join('; ')}`);
    }

    const validDataSeedingPlan = path.join(fixturesDir, 'valid_data_seeding_plan.md');
    if (fs.existsSync(validDataSeedingPlan)) {
      const res = lintExecutionPlan(validDataSeedingPlan);
      addCheck("Fixture: valid_data_seeding_plan.md passes", res.valid, `Expected valid data seeding plan without mandatory PAT-07, got invalid with ${res.errors.length} errors: ${res.errors.map(e => e.message).join('; ')}`);
    }

    const validApprovedPlan = path.join(fixturesDir, 'valid_approved_plan.md');
    if (fs.existsSync(validApprovedPlan)) {
      const resPlan = lintExecutionPlan(validApprovedPlan);
      addCheck("Fixture: valid_approved_plan.md passes plan lint", resPlan.valid, `Expected valid, got errors: ${resPlan.errors.map(e => e.message).join('; ')}`);
      const resGate = verifyPreBuildGate(validApprovedPlan);
      addCheck("Fixture: valid_approved_plan.md passes pre-build gate", resGate.valid, `Expected valid pre-build, got errors: ${resGate.errors.map(e => e.message).join('; ')}`);
    }

    const invalidApprovedNoProv = path.join(fixturesDir, 'invalid_approved_no_provenance.md');
    if (fs.existsSync(invalidApprovedNoProv)) {
      const res = lintExecutionPlan(invalidApprovedNoProv);
      const caughtProv = res.errors.some(e => e.code === 'PLAN-STATUS-DRAFT-ON-CREATION');
      addCheck("Fixture: invalid_approved_no_provenance.md caught PLAN-STATUS-DRAFT-ON-CREATION", !res.valid && caughtProv, "Expected invalid with PLAN-STATUS-DRAFT-ON-CREATION");
    }

    const validDraftPlan = path.join(fixturesDir, 'valid_draft_plan.md');
    if (fs.existsSync(validDraftPlan)) {
      const resPlan = lintExecutionPlan(validDraftPlan);
      addCheck("Fixture: valid_draft_plan.md passes plan lint in draft status", resPlan.valid, `Expected valid in draft, got errors: ${resPlan.errors.map(e => e.message).join('; ')}`);
      const resGate = verifyPreBuildGate(validDraftPlan);
      const caughtDraft = resGate.errors.some(e => e.code === 'PLAN_NOT_APPROVED');
      addCheck("Fixture: valid_draft_plan.md halts pre-build gate on DRAFT status", !resGate.valid && caughtDraft, "Expected pre-build gate refusal on DRAFT");
    }

    const validValPlan = path.join(fixturesDir, 'valid_frontend_validation_feedback_plan.md');
    if (fs.existsSync(validValPlan)) {
      const res = lintExecutionPlan(validValPlan);
      addCheck("Fixture: valid_frontend_validation_feedback_plan.md passes", res.valid, `Expected valid, got invalid with ${res.errors.length} errors: ${res.errors.map(e => e.message).join('; ')}`);
    }

    const invalidOrphanedVal = path.join(fixturesDir, 'invalid_frontend_orphaned_validation_locator.md');
    if (fs.existsSync(invalidOrphanedVal)) {
      const res = lintExecutionPlan(invalidOrphanedVal);
      const caughtOrphan = res.errors.some(e => e.code === 'ORPHANED_VALIDATION_LOCATOR');
      addCheck("Fixture: invalid_frontend_orphaned_validation_locator.md caught ORPHANED_VALIDATION_LOCATOR", !res.valid && caughtOrphan, "Expected invalid with ORPHANED_VALIDATION_LOCATOR");
    }

    const invalidWrongTypeVal = path.join(fixturesDir, 'invalid_frontend_wrong_locator_type.md');
    if (fs.existsSync(invalidWrongTypeVal)) {
      const res = lintExecutionPlan(invalidWrongTypeVal);
      const caughtMismatch = res.errors.some(e => e.code === 'LOCATOR_TYPE_MISMATCH');
      addCheck("Fixture: invalid_frontend_wrong_locator_type.md caught LOCATOR_TYPE_MISMATCH", !res.valid && caughtMismatch, "Expected invalid with LOCATOR_TYPE_MISMATCH");
    }

    const invalidBackendAssertVal = path.join(fixturesDir, 'invalid_frontend_backend_assert_in_ui.md');
    if (fs.existsSync(invalidBackendAssertVal)) {
      const res = lintExecutionPlan(invalidBackendAssertVal);
      const caughtAnti20 = res.errors.some(e => e.code === 'ANTI-20_VIOLATION');
      addCheck("Fixture: invalid_frontend_backend_assert_in_ui.md caught ANTI-20", !res.valid && caughtAnti20, "Expected invalid with ANTI-20");
    }

    const invalidPrematureVal = path.join(fixturesDir, 'invalid_frontend_premature_validation.md');
    if (fs.existsSync(invalidPrematureVal)) {
      const res = lintExecutionPlan(invalidPrematureVal);
      const caughtAnti74 = res.errors.some(e => e.code === 'ANTI-74_VIOLATION');
      addCheck("Fixture: invalid_frontend_premature_validation.md caught ANTI-74", !res.valid && caughtAnti74, "Expected invalid with ANTI-74");
    }

    const invalidAnti79 = path.join(fixturesDir, 'invalid_frontend_anti79_generic_page_locator.md');
    if (fs.existsSync(invalidAnti79)) {
      const res = lintExecutionPlan(invalidAnti79);
      const caughtAnti79 = res.errors.some(e => e.code === 'ANTI-79_VIOLATION');
      addCheck("Fixture: invalid_frontend_anti79_generic_page_locator.md caught ANTI-79", !res.valid && caughtAnti79, "Expected invalid with ANTI-79");
    }

    const invalidAnti79RawCss = path.join(fixturesDir, 'invalid_frontend_anti79_raw_css_class.md');
    if (fs.existsSync(invalidAnti79RawCss)) {
      const res = lintExecutionPlan(invalidAnti79RawCss);
      const caughtAnti79 = res.errors.some(e => e.code === 'ANTI-79_VIOLATION');
      addCheck("Fixture: invalid_frontend_anti79_raw_css_class.md caught ANTI-79", !res.valid && caughtAnti79, "Expected invalid with ANTI-79");
    }

    const invalidAnti79MissingPage = path.join(fixturesDir, 'invalid_frontend_anti79_missing_page_qualified_name.md');
    if (fs.existsSync(invalidAnti79MissingPage)) {
      const res = lintExecutionPlan(invalidAnti79MissingPage);
      const caughtAnti79 = res.errors.some(e => e.code === 'ANTI-79_VIOLATION');
      addCheck("Fixture: invalid_frontend_anti79_missing_page_qualified_name.md caught ANTI-79", !res.valid && caughtAnti79, "Expected invalid with ANTI-79");
    }

    const invalidAnti81DummyAuth = path.join(fixturesDir, 'invalid_frontend_anti81_dummy_password.md');
    if (fs.existsSync(invalidAnti81DummyAuth)) {
      const res = lintExecutionPlan(invalidAnti81DummyAuth);
      const caughtAnti81 = res.errors.some(e => e.code === 'ANTI-81_VIOLATION');
      addCheck("Fixture: invalid_frontend_anti81_dummy_password.md caught ANTI-81", !res.valid && caughtAnti81, "Expected invalid with ANTI-81");
    }

    const validGeneratorsPlan = path.join(fixturesDir, 'valid_frontend_locator_generators.md');
    if (fs.existsSync(validGeneratorsPlan)) {
      const res = lintExecutionPlan(validGeneratorsPlan);
      addCheck("Fixture: valid_frontend_locator_generators.md passes", res.valid, `Expected valid, got invalid with ${res.errors.length} errors: ${res.errors.map(e => e.message).join('; ')}`);
    }

    const validOrderedVal = path.join(fixturesDir, 'valid_frontend_ordered_validation.md');
    if (fs.existsSync(validOrderedVal)) {
      const res = lintExecutionPlan(validOrderedVal);
      addCheck("Fixture: valid_frontend_ordered_validation.md passes", res.valid, `Expected valid, got invalid with ${res.errors.length} errors: ${res.errors.map(e => e.message).join('; ')}`);
    }

    const validIntentPlan = path.join(fixturesDir, 'valid_intent_feature_plan.md');
    if (fs.existsSync(validIntentPlan)) {
      const res = lintExecutionPlan(validIntentPlan);
      addCheck("Fixture: valid_intent_feature_plan.md passes", res.valid, `Expected valid, got invalid with ${res.errors.length} errors: ${res.errors.map(e => e.message).join('; ')}`);
    }

    const invalidCircularSpec = path.join(fixturesDir, 'invalid_intent_circular_spec.md');
    if (fs.existsSync(invalidCircularSpec)) {
      const res = lintExecutionPlan(invalidCircularSpec);
      const caughtAnti69 = res.errors.some(e => e.code === 'ANTI-69_CIRCULAR_SPEC');
      addCheck("Fixture: invalid_intent_circular_spec.md caught ANTI-69", !res.valid && caughtAnti69, "Expected invalid with ANTI-69");
    }

    const invalidTrivialRisk = path.join(fixturesDir, 'invalid_intent_trivial_risk.md');
    if (fs.existsSync(invalidTrivialRisk)) {
      const res = lintExecutionPlan(invalidTrivialRisk);
      const caughtAnti70 = res.errors.some(e => e.code === 'ANTI-70_RUBBER_STAMP_RISK');
      addCheck("Fixture: invalid_intent_trivial_risk.md caught ANTI-70", !res.valid && caughtAnti70, "Expected invalid with ANTI-70");
    }

    const invalidMissingSpec = path.join(fixturesDir, 'invalid_intent_missing_spec.md');
    if (fs.existsSync(invalidMissingSpec)) {
      const res = lintExecutionPlan(invalidMissingSpec);
      const caughtMissingSpec = res.errors.some(e => e.code === 'MISSING_SPEC_SOURCE');
      addCheck("Fixture: invalid_intent_missing_spec.md caught MISSING_SPEC_SOURCE", !res.valid && caughtMissingSpec, "Expected invalid with MISSING_SPEC_SOURCE");
    }

    if (fs.existsSync(validPlan) && fs.existsSync(passServer)) {
      const res = runSmokeAudit(validPlan, passServer);
      addCheck("Fixture: Smoke audit passes on matching data", res.valid, "Expected valid smoke audit");
    }

    if (fs.existsSync(validPlan) && fs.existsSync(failServer)) {
      const res = runSmokeAudit(validPlan, failServer);
      addCheck("Fixture: Smoke audit fails on mismatching data", !res.valid, "Expected failed smoke audit");
    }

    const docMismatchServer = path.join(fixturesDir, 'server_response_doc_mismatch.json');
    if (fs.existsSync(validPlan) && fs.existsSync(docMismatchServer)) {
      const res = runSmokeAudit(validPlan, docMismatchServer);
      const caughtDocMismatch = res.errors.some(e => e.code.startsWith('SCENARIO_') || e.code.startsWith('STEP_') || e.code.startsWith('TESTCASE_'));
      addCheck("Fixture: Smoke audit catches documentation & metadata mismatches", !res.valid && caughtDocMismatch, "Expected failed smoke audit on doc mismatches");
    }

    const suitePassServer = path.join(fixturesDir, 'suite_response_pass.json');
    const suiteFailServer = path.join(fixturesDir, 'suite_response_fail.json');

    // Test PAT-124 & ANTI-78 Lock / Tamper Engine
    const tempLockPlan = path.join(fixturesDir, 'temp_tdbf_test_plan.md');
    try {
      const samplePlanContent = [
        '# Execution Plan: TC_SampleLock',
        '<details>',
        '<summary>Metadata</summary>',
        '\x60\x60\x60yaml',
        'plan_id: "TC_SampleLock-v1"',
        'schema_version: "2.1.0"',
        'target: "Sales.SampleMicroflow"',
        'category: "Backend"',
        'test_type: "Unit"',
        'execution_target: "MTA_plugin"',
        'rollback: "Yes"',
        'status: "DRAFT"',
        'test_intent: "bug_reproduction"',
        'expected_pre_fix_outcome: "FAIL"',
        'spec_source:',
        '  type: "bug_report"',
        '  reference: "ISSUE-999"',
        '  summary: "Expected discount 25.00 instead of 20.00"',
        'risks_covered:',
        '  - risk: "Calculation boundary under gold tier"',
        '    mitigating_scenario: "#1"',
        '\x60\x60\x60',
        '</details>',
        '',
        '## 1. Purpose & Scope',
        '### 🔒 IMMUTABLE_ASSERTION_ANCHOR: TARGET=Sales.SampleMicroflow | ASSERT_EQUAL=25.00',
        '',
        '## 2. Component Under Test',
        'Microflow Sales.SampleMicroflow',
        '',
        '## 3. Test Steps & Action Sequence',
        '| # | Case | Step Action & Target | Input Handle | Output Handle | Parameters, Bindings & Initial Values | Embedded Assertions | Exec Settings | Pattern Tag |',
        '| :-: | :--: | :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
        '| **1** | Case 1 | \x60CreateObject\x60 (\x60Sales.Order\x60) | - | \x60orderHandle\x60 | \x60Amount = 100.00\x60 | - | \x60None\x60 / \x60Stop\x60 | \x60PAT-06\x60 |',
        '| **2** | Case 1 | \x60CallMicroflow\x60 (\x60SampleMicroflow\x60) | \x60orderHandle\x60 | \x60res\x60 | \x60Order = orderHandle\x60 | \x60Assert res == 25.00\x60 | \x60None\x60 / \x60Stop\x60 | \x60PAT-14\x60 |',
        '',
        '## 4. Test Scenarios & Test Data',
        '| # | Step Target | Scenario #1 (Baseline) |',
        '| :-: | :--- | :--- |',
        '| **0** | **Scenario Name** | Baseline Failure |',
        '| **0** | **Scenario Description** | Reproduces issue #999 |',
        '| 1 | Step 1: \x60Order.Amount\x60 | \x60100.00\x60 |',
        '| 2 | Step 2: Assert Return Value | \x6025.00\x60 |',
        '',
        '## 5. Quality & Compliance Checks',
        'Quality verified.',
        ''
      ].join('\n');
      fs.writeFileSync(tempLockPlan, samplePlanContent, 'utf8');

      // Test locking
      const lockRes1 = lockExecutionPlan(tempLockPlan);
      addCheck("PAT-124: Plan locking produces valid hash and seals", lockRes1.valid && typeof lockRes1.hash === 'string' && lockRes1.hash.length === 64, "Expected valid 64-char hash");

      // Test verify-lock on untouched plan
      const verifyRes1 = verifyLockedExecutionPlan(tempLockPlan);
      addCheck("PAT-124: verify-lock passes on untouched locked plan", verifyRes1.valid, "Expected valid lock verification");

      // Test one-way latch (refuses overwrite without force)
      const lockRes2 = lockExecutionPlan(tempLockPlan, { force: false });
      addCheck("PAT-124: One-way latch refuses overwrite without --force", !lockRes2.valid && lockRes2.errors.some(e => e.code === 'ALREADY_LOCKED'), "Expected ALREADY_LOCKED error");

      // Test tamper detection (tamper with assertion value)
      let tamperedContent = fs.readFileSync(tempLockPlan, 'utf8');
      tamperedContent = tamperedContent.replace('Assert res == 25.00', 'Assert res == 20.00');
      fs.writeFileSync(tempLockPlan, tamperedContent, 'utf8');

      const verifyRes2 = verifyLockedExecutionPlan(tempLockPlan);
      const caughtTamper = !verifyRes2.valid && verifyRes2.errors.some(e => e.code === 'LOCKED_TEST_TAMPERED');
      addCheck("ANTI-78: Tampered assertion caught by verify-lock", caughtTamper, "Expected LOCKED_TEST_TAMPERED violation");

      // Test anchor heading tamper detection
      let anchorTamperedContent = samplePlanContent.replace('ASSERT_EQUAL=25.00', 'ASSERT_EQUAL=30.00');
      anchorTamperedContent = anchorTamperedContent.replace('status: "DRAFT"', `status: "APPROVED"\nlocked_sha256: "${lockRes1.hash}"\nprotection_level: "locked"`);
      fs.writeFileSync(tempLockPlan, anchorTamperedContent, 'utf8');

      const verifyResAnchorTamper = verifyLockedExecutionPlan(tempLockPlan);
      const caughtAnchorTamper = !verifyResAnchorTamper.valid && verifyResAnchorTamper.errors.some(e => e.code === 'LOCKED_TEST_TAMPERED');
      addCheck("ANTI-78: Tampered anchor heading caught by verify-lock", caughtAnchorTamper, "Expected LOCKED_TEST_TAMPERED violation when changing anchor heading");

      // Test Section 6 Step Reconciliation table isolation (must NOT trigger false LOCKED_TEST_TAMPERED)
      let planWithSec6 = samplePlanContent.replace('status: "DRAFT"', `status: "BUILT_AND_VERIFIED"\nlocked_sha256: "${lockRes1.hash}"\nprotection_level: "locked"`);
      planWithSec6 += [
        '',
        '## 6. Verification & Build Receipt',
        '| Case # | Step Action & Target | Output Handle | Status |',
        '| :--- | :--- | :--- | :--- |',
        '| Case 1 | CreateObject | Step 6501 | MATCH |',
        ''
      ].join('\n');
      fs.writeFileSync(tempLockPlan, planWithSec6, 'utf8');
      const verifySec6Res = verifyLockedExecutionPlan(tempLockPlan);
      addCheck("PAT-124: Appending Section 6 receipt table preserves lock hash integrity", verifySec6Res.valid, "Expected verify-lock to ignore Section 6 tables");

      // Test verifyPreExecGate (PAT-43, ANTI-46)
      const validDraftPlan = path.join(fixturesDir, 'valid_draft_plan.md');
      if (fs.existsSync(validDraftPlan)) {
        const draftPlanPath = path.join(fixturesDir, 'EP_TempDraftCheck.md');
        try {
          const baseDraftMd = fs.readFileSync(validDraftPlan, 'utf8');
          fs.writeFileSync(draftPlanPath, baseDraftMd, 'utf8');
          const preExecDraft = verifyPreExecGate(draftPlanPath);
          addCheck("ANTI-46: pre-exec blocks DRAFT execution plan", !preExecDraft.valid && preExecDraft.errors.some(e => e.code === 'PLAN_NOT_EXECUTABLE'), "Expected PLAN_NOT_EXECUTABLE on DRAFT plan");

          const autoApprovedMd = baseDraftMd.replace(/status:\s*"?[A-Z_]+"?/i, 'status: "AUTO_APPROVED"');
          fs.writeFileSync(draftPlanPath, autoApprovedMd, 'utf8');
          const preExecAuto = verifyPreExecGate(draftPlanPath);
          addCheck("PAT-43: pre-exec passes valid AUTO_APPROVED execution plan", preExecAuto.valid, `Expected valid pre-exec on AUTO_APPROVED plan, got: ${preExecAuto.errors.map(e => e.message).join('; ')}`);

          const autoApprovedRollbackNoMd = autoApprovedMd.replace('status: "AUTO_APPROVED"', 'status: "AUTO_APPROVED"\nrollback: "No"');
          fs.writeFileSync(draftPlanPath, autoApprovedRollbackNoMd, 'utf8');
          const preExecRollbackNo = verifyPreExecGate(draftPlanPath);
          addCheck("ANTI-56: pre-exec blocks AUTO_APPROVED when rollback is No", !preExecRollbackNo.valid && preExecRollbackNo.errors.some(e => e.code === 'AUTO_APPROVE_FORBIDDEN'), "Expected AUTO_APPROVE_FORBIDDEN when rollback is No");

          // Test rollback: "false" & Conservative Gate prompt_spec rejection in AUTO_APPROVED
          const autoApprovedRollbackFalseMd = autoApprovedMd.replace('status: "AUTO_APPROVED"', 'status: "AUTO_APPROVED"\nrollback: "false"');
          fs.writeFileSync(draftPlanPath, autoApprovedRollbackFalseMd, 'utf8');
          const preExecRollbackFalse = verifyPreExecGate(draftPlanPath);
          addCheck("ANTI-56: pre-exec blocks AUTO_APPROVED when rollback is 'false'", !preExecRollbackFalse.valid && preExecRollbackFalse.errors.some(e => e.code === 'AUTO_APPROVE_FORBIDDEN'), "Expected AUTO_APPROVE_FORBIDDEN when rollback is 'false'");

          // Test Gate 2 verifyPreBuildGate null target_suite_key rejection
          const nullSuitePreBuildMd = baseDraftMd
            .replace(/status:\s*"?[A-Z_]+"?/i, 'status: "APPROVED"')
            .replace('approved_by: null', 'approved_by: "user"')
            .replace('approved_at: null', 'approved_at: "2026-10-24T12:00:00Z"')
            .replace('target_configuration_key: null', 'target_configuration_key: 131');
          fs.writeFileSync(draftPlanPath, nullSuitePreBuildMd, 'utf8');
          const preBuildNullSuite = verifyPreBuildGate(draftPlanPath);
          addCheck("ANTI-56: pre-build blocks null target_suite_key (prevents Number(null)===0 coercion)", !preBuildNullSuite.valid && preBuildNullSuite.errors.some(e => e.code === 'INVALID_SUITE_KEY'), "Expected INVALID_SUITE_KEY on target_suite_key: null");

          // Test 68: Gate 2 verifyPreBuildGate rejects target_suite_key: 0 and NEW_SUITE with null target_suite
          const zeroSuitePreBuildMd = nullSuitePreBuildMd.replace('target_suite_key: null', 'target_suite_key: 0');
          fs.writeFileSync(draftPlanPath, zeroSuitePreBuildMd, 'utf8');
          const preBuildZeroSuite = verifyPreBuildGate(draftPlanPath);
          const newSuiteNullNameMd = nullSuitePreBuildMd.replace('target_suite_key: null', 'target_suite_key: "NEW_SUITE"\ntarget_suite: null');
          fs.writeFileSync(draftPlanPath, newSuiteNullNameMd, 'utf8');
          const preBuildNewSuiteNull = verifyPreBuildGate(draftPlanPath);
          addCheck("F-02: pre-build blocks target_suite_key: 0 and NEW_SUITE without valid target_suite name", !preBuildZeroSuite.valid && preBuildZeroSuite.errors.some(e => e.code === 'INVALID_SUITE_KEY') && !preBuildNewSuiteNull.valid && preBuildNewSuiteNull.errors.some(e => e.code === 'INVALID_SUITE_KEY'), "Expected INVALID_SUITE_KEY on target_suite_key: 0 and NEW_SUITE with null target_suite");

          const builtVerifiedMd = baseDraftMd
            .replace(/status:\s*"?[A-Z_]+"?/i, 'status: "BUILT_AND_VERIFIED"')
            .replace('approved_by: null', 'approved_by: "user"')
            .replace('approved_at: null', 'approved_at: "2026-10-23T15:00:00Z"');
          fs.writeFileSync(draftPlanPath, builtVerifiedMd, 'utf8');
          const preExecBuilt = verifyPreExecGate(draftPlanPath);
          addCheck("PAT-43: pre-exec and plan lint pass valid BUILT_AND_VERIFIED execution plan", preExecBuilt.valid, `Expected valid pre-exec on BUILT_AND_VERIFIED plan, got: ${preExecBuilt.errors.map(e => e.message).join('; ')}`);
        } finally {
          if (fs.existsSync(draftPlanPath)) {
            try { fs.unlinkSync(draftPlanPath); } catch (e) {}
          }
        }
      }

      // Test --reseal-wiring on locked plan (allows non-assertion wiring update while blocking assertion tampering)
      const resealPlanContent = samplePlanContent
        .replace('status: "DRAFT"', `status: "APPROVED"\nlocked_sha256: "${lockRes1.hash}"\nprotection_level: "locked"`)
        .replace('Amount = 100.00', 'Amount = 100.00, Description = "Seeded"');
      fs.writeFileSync(tempLockPlan, resealPlanContent, 'utf8');
      const resealResOk = lockExecutionPlan(tempLockPlan, { resealWiring: true });
      addCheck("PAT-124: lock --reseal-wiring updates hash when IMMUTABLE_ASSERTION_ANCHOR and assertion match", resealResOk.valid && resealResOk.hash !== lockRes1.hash, "Expected valid --reseal-wiring hash update");

      const tamperedResealContent = resealPlanContent.replace(/25\.00/g, '99.99').replace('ASSERT_EQUAL=99.99', 'ASSERT_EQUAL=25.00');
      fs.writeFileSync(tempLockPlan, tamperedResealContent, 'utf8');
      const resealResFail = lockExecutionPlan(tempLockPlan, { resealWiring: true });
      addCheck("ANTI-78: lock --reseal-wiring blocks tampered assertion value", !resealResFail.valid && resealResFail.errors.some(e => e.code === 'LOCKED_TEST_TAMPERED'), "Expected LOCKED_TEST_TAMPERED on --reseal-wiring with altered assertion");

      // Test 69: lock --reseal-wiring rejects assertion softening when expected value is moved to a non-assertion cell
      const decoyResealContent = resealPlanContent
        .replace('Amount = 100.00', 'Amount = 25.00')
        .replace('Assert res == 25.00', 'Assert res == 20.00')
        .replace('| 2 | Step 2: Assert Return Value | `25.00` |', '| 2 | Step 2: Assert Return Value | `20.00` |');
      fs.writeFileSync(tempLockPlan, decoyResealContent, 'utf8');
      const decoyResealRes = lockExecutionPlan(tempLockPlan, { resealWiring: true });
      addCheck("F-06: lock --reseal-wiring blocks assertion tampering even when anchor value exists in non-assertion cell", !decoyResealRes.valid && decoyResealRes.errors.some(e => e.code === 'LOCKED_TEST_TAMPERED'), "Expected LOCKED_TEST_TAMPERED when assertion cell is altered but decoy value remains in non-assertion cell");
    } finally {
      if (fs.existsSync(tempLockPlan)) {
        try { fs.unlinkSync(tempLockPlan); } catch (e) {}
      }
    }

    // Test PAT-115 Decommissioned Step Filtering & Phase 4 Cell Parity in runSmokeAudit
    if (fs.existsSync(validPlan) && fs.existsSync(passServer)) {
      const tempServerDecomm = path.join(fixturesDir, 'temp_server_decomm.json');
      try {
        const baseServerObj = JSON.parse(fs.readFileSync(passServer, 'utf8'));
        baseServerObj.testSteps.push({
          key: "999",
          name: "[TO DELETE] Step 2 - Old RetrieveObject",
          ExecutionCondition: "Skip",
          description: "Decommissioned step per PAT-115"
        });
        fs.writeFileSync(tempServerDecomm, JSON.stringify(baseServerObj), 'utf8');
        const decommRes = runSmokeAudit(validPlan, tempServerDecomm);
        addCheck("PAT-115: Smoke audit excludes [TO DELETE] Skip steps from active step count", decommRes.valid, `Expected valid audit with decommissioned step, got: ${decommRes.errors.map(e => e.message).join('; ')}`);

        // Test Phase 4 Cell Value Mismatch detection
        baseServerObj.dataVariations[0].TCVA_TestCaseVariationValues = [
          { value: "WRONG_CELL_VALUE_99999" },
          { value: "VALID" },
          { value: "true" }
        ];
        fs.writeFileSync(tempServerDecomm, JSON.stringify(baseServerObj), 'utf8');
        const cellMismatchRes = runSmokeAudit(validPlan, tempServerDecomm);
        const caughtCellMismatch = !cellMismatchRes.valid && cellMismatchRes.errors.some(e => e.code === 'CELL_VALUE_MISMATCH');
        addCheck("Phase 4: Smoke audit catches M x N cell value mismatch", caughtCellMismatch, "Expected CELL_VALUE_MISMATCH error");

        // Test Phase 3 Partial Scenario Count Detection (1 of 3 scenarios built)
        const truncatedServerObj = JSON.parse(fs.readFileSync(passServer, 'utf8'));
        truncatedServerObj.dataVariations = [truncatedServerObj.dataVariations[0]];
        fs.writeFileSync(tempServerDecomm, JSON.stringify(truncatedServerObj), 'utf8');
        const truncatedScenRes = runSmokeAudit(validPlan, tempServerDecomm);
        const caughtScenarioCount = !truncatedScenRes.valid && truncatedScenRes.errors.some(e => e.code === 'SCENARIO_COUNT_MISMATCH');
        addCheck("Phase 3: Smoke audit catches missing scenarios when only 1 of N is built", caughtScenarioCount, "Expected SCENARIO_COUNT_MISMATCH error");
      } finally {
        if (fs.existsSync(tempServerDecomm)) {
          try { fs.unlinkSync(tempServerDecomm); } catch (e) {}
        }
      }
    }


    if (fs.existsSync(validOrderedVal) && fs.existsSync(suitePassServer)) {
      const res = runSmokeAudit(validOrderedVal, suitePassServer);
      addCheck("Fixture: Suite smoke audit passes on matching 3-case suite", res.valid, `Expected valid suite audit, got errors: ${res.errors.map(e => e.message).join('; ')}`);

      // Test Multi-File Variadic 3-Case Smoke Audit (simulating 3 separate GetTestCaseDetails JSON files)
      const tempCase1 = path.join(fixturesDir, 'temp_case_101.json');
      const tempCase2 = path.join(fixturesDir, 'temp_case_102.json');
      const tempCase3 = path.join(fixturesDir, 'temp_case_103.json');
      try {
        const suiteObj = JSON.parse(fs.readFileSync(suitePassServer, 'utf8'));
        fs.writeFileSync(tempCase1, JSON.stringify({
          key: "101",
          name: suiteObj.testCases[0].name,
          SequenceNumber: 1,
          description: suiteObj.testCases[0].description,
          testSteps: [suiteObj.testSteps[0]],
          dataVariationItems: [suiteObj.dataVariationItems[0]],
          dataVariations: suiteObj.dataVariations,
          TCER_TestConstructionErrors: 0
        }), 'utf8');
        fs.writeFileSync(tempCase2, JSON.stringify({
          key: "102",
          name: suiteObj.testCases[1].name,
          SequenceNumber: 2,
          description: suiteObj.testCases[1].description,
          testSteps: suiteObj.testSteps.slice(1, 6),
          dataVariationItems: suiteObj.dataVariationItems.slice(1),
          dataVariations: [],
          TCER_TestConstructionErrors: 0
        }), 'utf8');
        fs.writeFileSync(tempCase3, JSON.stringify({
          key: "103",
          name: suiteObj.testCases[2].name,
          SequenceNumber: 3,
          description: suiteObj.testCases[2].description,
          testSteps: [suiteObj.testSteps[6]],
          dataVariationItems: [],
          dataVariations: [],
          TCER_TestConstructionErrors: 0
        }), 'utf8');
        const multiRes = runSmokeAudit(validOrderedVal, [tempCase1, tempCase2, tempCase3]);
        addCheck("PAT-03: Variadic multi-file smoke audit passes across 3 separate case JSON files", multiRes.valid, `Expected valid variadic 3-case audit, got errors: ${multiRes.errors.map(e => e.message).join('; ')}`);

        // Test 70: Variadic multi-file smoke audit merges dataVariations across Case 1 and Case 2
        const case1SplitVars = [
          { key: "301", name: "Valid Submission", description: "Submits form nominal", TCVA_TestCaseVariationValues: [{ value: "test@example.com" }] },
          { key: "302", name: "Alternate Submission", description: "Submits form alternate", TCVA_TestCaseVariationValues: [{ value: "test2@example.com" }] }
        ];
        const case2SplitVars = [
          { key: "301", name: "Valid Submission", description: "Submits form nominal", TCVA_TestCaseVariationValues: [{ value: "john@example.com" }, { value: "btnSubmit" }] },
          { key: "302", name: "Alternate Submission", description: "Submits form alternate", TCVA_TestCaseVariationValues: [{ value: "jane@example.com" }, { value: "btnSubmit" }] }
        ];
        fs.writeFileSync(tempCase1, JSON.stringify({
          key: "101",
          name: suiteObj.testCases[0].name,
          SequenceNumber: 1,
          description: suiteObj.testCases[0].description,
          testSteps: [suiteObj.testSteps[0]],
          dataVariationItems: [suiteObj.dataVariationItems[0]],
          dataVariations: case1SplitVars,
          TCER_TestConstructionErrors: 0
        }), 'utf8');
        fs.writeFileSync(tempCase2, JSON.stringify({
          key: "102",
          name: suiteObj.testCases[1].name,
          SequenceNumber: 2,
          description: suiteObj.testCases[1].description,
          testSteps: suiteObj.testSteps.slice(1, 6),
          dataVariationItems: suiteObj.dataVariationItems.slice(1),
          dataVariations: case2SplitVars,
          TCER_TestConstructionErrors: 0
        }), 'utf8');
        const splitMultiRes = runSmokeAudit(validOrderedVal, [tempCase1, tempCase2, tempCase3]);
        const case2TamperedVars = [
          { key: "301", name: "Valid Submission", description: "Submits form nominal", TCVA_TestCaseVariationValues: [{ value: "WRONG_CASE2_VALUE" }, { value: "SubmitButton" }] },
          { key: "302", name: "Alternate Submission", description: "Submits form alternate", TCVA_TestCaseVariationValues: [{ value: "jane@example.com" }, { value: "SaveButton" }] }
        ];
        fs.writeFileSync(tempCase2, JSON.stringify({
          key: "102",
          name: suiteObj.testCases[1].name,
          SequenceNumber: 2,
          description: suiteObj.testCases[1].description,
          testSteps: suiteObj.testSteps.slice(1, 6),
          dataVariationItems: suiteObj.dataVariationItems.slice(1),
          dataVariations: case2TamperedVars,
          TCER_TestConstructionErrors: 0
        }), 'utf8');
        const splitTamperedRes = runSmokeAudit(validOrderedVal, [tempCase1, tempCase2, tempCase3]);
        addCheck("F-05: Variadic smoke audit merges per-case dataVariations across multiple cases", splitMultiRes.valid && !splitTamperedRes.valid && splitTamperedRes.errors.some(e => e.code === 'CELL_VALUE_MISMATCH'), `Expected valid merged multi-case variation audit and caught Case 2 cell mismatch, got: ${splitMultiRes.errors.map(e => e.message).join('; ')}`);
      } finally {
        for (const f of [tempCase1, tempCase2, tempCase3]) {
          if (fs.existsSync(f)) {
            try { fs.unlinkSync(f); } catch (e) {}
          }
        }
      }
    }

    // Test MTA-LINT-E010 Artifact Traceability
    const tempArtifactsDir = path.join(fixturesDir, 'temp_artifacts_audit');
    try {
      if (!fs.existsSync(tempArtifactsDir)) fs.mkdirSync(tempArtifactsDir, { recursive: true });
      const tempPlansDir = path.join(tempArtifactsDir, 'execution-plans');
      if (!fs.existsSync(tempPlansDir)) fs.mkdirSync(tempPlansDir, { recursive: true });

      // Valid plan & execution pair
      const validPlanMd = [
        '# Execution Plan: TC_ValidFeature',
        '<details><summary>Metadata</summary>',
        '```yaml',
        'plan_id: "TC_ValidFeature-v1"',
        'status: "APPROVED"',
        'target: "Module.ACT_Valid"',
        'category: "Backend"',
        '```',
        '</details>',
        '## 1. Scope',
        '## 2. Component'
      ].join('\n');
      fs.writeFileSync(path.join(tempPlansDir, 'EP_TC_ValidFeature.md'), validPlanMd, 'utf8');
      fs.writeFileSync(path.join(tempArtifactsDir, 'TC_ValidFeature.json'), JSON.stringify({ RollbackTcseAfterExecution: "Yes" }), 'utf8');

      // Orphaned execution without plan
      fs.writeFileSync(path.join(tempArtifactsDir, 'TC_OrphanedRun.json'), JSON.stringify({ RollbackTcseAfterExecution: "Yes" }), 'utf8');

      const auditRes = lintArtifacts(tempArtifactsDir);
      const caughtOrphaned = !auditRes.valid && auditRes.errors.some(e => e.code === 'MTA-LINT-E010' && e.message.includes('TC_OrphanedRun.json'));
      addCheck("MTA-LINT-E010: Orphaned test execution detected without EP_*.md", caughtOrphaned, "Expected MTA-LINT-E010 on TC_OrphanedRun.json");

      // Malformed plan header
      fs.writeFileSync(path.join(tempPlansDir, 'EP_TC_MalformedHeader.md'), '# No frontmatter\nJust text', 'utf8');
      const malformedRes = lintArtifacts(tempArtifactsDir);
      const caughtMalformed = !malformedRes.valid && malformedRes.errors.some(e => e.code === 'MTA-LINT-E010' && e.message.includes('EP_TC_MalformedHeader.md'));
      addCheck("MTA-LINT-E010: Malformed execution plan header detected", caughtMalformed, "Expected MTA-LINT-E010 on EP_TC_MalformedHeader.md");

      // Clean up orphaned and malformed files, leaving only valid pair
      fs.unlinkSync(path.join(tempArtifactsDir, 'TC_OrphanedRun.json'));
      fs.unlinkSync(path.join(tempPlansDir, 'EP_TC_MalformedHeader.md'));

      const cleanRes = lintArtifacts(tempArtifactsDir);
      addCheck("MTA-LINT-E010: Valid plan and execution pair passes traceability audit", cleanRes.valid, `Expected valid, got errors: ${cleanRes.errors.map(e => e.message).join('; ')}`);

      // Test 71: Unplanned domain microflow execution caught even when filename matches existing EP_*.md
      fs.writeFileSync(path.join(tempArtifactsDir, 'TC_ValidFeature.json'), JSON.stringify({
        RollbackTcseAfterExecution: "Yes",
        TCEX_RQ_TestStepRun: [{ MicroflowName: "Module.ACT_UnplannedSneakyFlow" }]
      }), 'utf8');
      const unplannedFlowRes = lintArtifacts(tempArtifactsDir);
      const caughtUnplannedFlow = !unplannedFlowRes.valid && unplannedFlowRes.errors.some(e => e.code === 'MTA-LINT-E010' && e.message.includes('ACT_UnplannedSneakyFlow'));
      addCheck("F-07: Artifact traceability catches execution of unplanned domain microflow", caughtUnplannedFlow, "Expected MTA-LINT-E010 when execution payload invokes unplanned microflow");
    } finally {
      if (fs.existsSync(tempArtifactsDir)) {
        try { fs.rmSync(tempArtifactsDir, { recursive: true, force: true }); } catch (e) {}
      }
    }

    if (fs.existsSync(validOrderedVal) && fs.existsSync(suiteFailServer)) {
      const res = runSmokeAudit(validOrderedVal, suiteFailServer);
      const caughtCaseMismatch = res.errors.some(e => e.code === 'CASE_COUNT_MISMATCH');
      addCheck("Fixture: Suite smoke audit catches monolithic single-case drift", !res.valid && caughtCaseMismatch, "Expected failed suite audit on case count mismatch");
    }
  }

  return {
    valid: errors.length === 0,
    target: "Internal Linter Engine",
    passedCount: checks.filter(c => c.pass).length,
    totalCount: checks.length,
    checks,
    errors
  };
}

// Run main if called directly
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1'))) {
  main();
}
