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

export const LINTER_VERSION = "1.4.0";
const VERSION = LINTER_VERSION;

// ==========================================
// CLI Argument Dispatcher
// ==========================================
async function main() {
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
        const serverJsonPath = args[2];
        if (!planPath || !serverJsonPath || planPath.startsWith('--') || serverJsonPath.startsWith('--')) {
          console.error("Error: Missing arguments. Usage: mta-lint audit <path/to/EP_*.md> <path/to/server-data.json>");
          process.exit(1);
        }
        const result = runSmokeAudit(planPath, serverJsonPath);
        outputResult(result, isJson, "MTA Post-Construction 4-Phase Smoke Audit");
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
  plan <file> [--json]                 Validate Execution Plan syntax, schema, and pattern rules
  audit <plan-file> <server-json>      Verify constructed MTA server state against plan (4-phase diff)
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

function parseSimpleYaml(yamlStr) {
  const meta = {};
  const lines = yamlStr.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let val = trimmed.slice(colonIdx + 1).trim();
    // Strip quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    } else if (val === 'true') {
      val = true;
    } else if (val === 'false') {
      val = false;
    } else if (val === 'null') {
      val = null;
    } else if (!isNaN(Number(val)) && val !== '') {
      val = Number(val);
    }
    meta[key] = val;
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
    if (headerStr.includes('step action') || headerStr.includes('output handle') || headerStr.includes('action & target')) {
      stepLedgerTable = t;
    } else if (headerStr.includes('step target') || headerStr.includes('scenario #1') || (headerStr.includes('scenario name') && headerStr.includes('scenario'))) {
      variationMatrixTable = t;
    }
  }

  // Validate Master Step Ledger
  if (!stepLedgerTable) {
    addCheck("Master Step Specification Ledger Table Found", false, "Could not find Master Step Specification table in document", "MISSING_STEP_LEDGER");
  } else {
    addCheck("Master Step Specification Ledger Table Found", true);

    // Check required columns (PAT-111, Unified Promotable Blueprint)
    const requiredHeaderKeywords = ['case', 'input', 'output', 'parameters', 'settings'];
    const hStr = stepLedgerTable.headers.join(' ').toLowerCase();
    const missingCols = requiredHeaderKeywords.filter(k => !hStr.includes(k));

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
    validatePat07EmptyBoundaries(stepLedgerTable, variationMatrixTable, addCheck);
  }

  // 3c. DateTime & DatePicker Format Audit (PAT-94, PAT-42, ANTI-45, ANTI-53)
  validateDateTimeAndDatePickerFormats(content, stepLedgerTable, variationMatrixTable, metadata, tables, addCheck);

  // 3d. Frontend Validation Feedback Assertions (PAT-119, ANTI-20, PAT-12)
  validateFrontendValidationFeedback(content, stepLedgerTable, metadata, addCheck);

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

  for (let idx = 0; idx < table.rows.length; idx++) {
    const row = table.rows[idx];
    const rowText = Object.values(row).join(' ');

    // Rule: PAT-06 Direct Attribute Init on CreateObject
    // Consecutive ChangeObject immediately following CreateObject on same handle is prohibited (ANTI-01)
    const isCreate = /CreateObject/i.test(rowText);
    const isChange = /ChangeObject/i.test(rowText);

    if (isCreate) {
      previousAction = 'CreateObject';
      // attempt to identify handle
      const outHandleCol = Object.keys(row).find(k => k.toLowerCase().includes('output'));
      previousOutputHandle = outHandleCol ? row[outHandleCol].replace(/[`\s]/g, '') : null;
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

    // Settings rule for backend unit tests (None / Stop)
    if (isBackend) {
      const settingsCol = Object.keys(row).find(k => k.toLowerCase().includes('settings') || k.toLowerCase().includes('exec'));
      if (settingsCol && row[settingsCol]) {
        const val = row[settingsCol];
        if (/Always/i.test(val) && !/None/i.test(val)) {
          addCheck(`Step ${idx + 1} Backend Execution Settings`, false, `Backend unit tests must use 'None / Stop', found: '${val}'`, "INVALID_EXEC_SETTINGS");
        }
      }
    }
  }

  // Record PAT-06 check if no violation was recorded
  if (!hasPat06Violation) {
    addCheck("PAT-06: Direct Attribute Init on CreateObject", true);
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
    const isRetrieve = /Retrieve(?:Object|Objects)?/i.test(actionVal) || /Retrieve(?:Object|Objects)?/i.test(rowText);

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
    return /ACT_Fill_DatePicker_Input|ASR_Has_Value_DatePicker_Input|Locate_MxWidget_DatePicker/i.test(text);
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
      /Date\s*Format\s*\/\s*Constraint\s*\(PAT-94\)[\s\S]*?(?:dd[-/. ]MM[-/. ]yyyy|yyyy[-/. ]MM[-/. ]dd|MM[-/. ]dd[-/. ]yyyy)/i.test(content) ||
      /CustomDateFormat\s*via\s*mxcli\s*bson\s*dump/i.test(content);

    // Explicitly check for defaulted or assumed date format indicators (ANTI-45)
    const hasAssumedFormatIndicator = /(?:default\s*date\s*format|assumed\s*date\s*format|default\s*US\s*format|\bDefault\b\s*\|\s*`?Locate_MxWidget_DatePicker)/i.test(content) ||
      /\|\s*`?[a-zA-Z0-9_]*DatePicker[a-zA-Z0-9_]*`?\s*\|\s*`?DatePicker`?\s*\|\s*(?:Default|-|N\/A|\s*)\s*\|/i.test(content);

    if (!hasCustomDateFormatDoc || hasAssumedFormatIndicator) {
      addCheck(
        "PAT-94 & ANTI-45: Mandatory DatePicker Format Model Extraction",
        false,
        "Frontend test interacts with DatePicker widget, but no verified CustomDateFormat pattern (e.g. 'dd-MM-yyyy', 'yyyy-MM-dd') is documented in Section 4 Input Widget Inventory (PAT-94 / ANTI-45). Date formats must be extracted via 'mxcli bson dump' and never guessed or defaulted.",
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
 * Validates Frontend Event-Driven Validation Feedback Assertions (PAT-119, ANTI-20, PAT-12).
 * 1. Validates that every Locate_MxWidget_*_ValidationMessage step maps to the correct widget type.
 * 2. Enforces that output handles from validation locators are immediately consumed by assertion steps
 *    (ASR_Is_Hidden_MxLocator for happy path, or ASR_Is_Visible_MxLocator / ASR_Has_Text for negative tests).
 * 3. Enforces that each validation locator and assertion step contains a non-empty Description
 *    documenting the triggering event (onChange, onLeave, onEnterPress, while typing, Save/Submit button)
 *    and the flow origin (microflow or nanoflow).
 * 4. Catches ANTI-20 domain violations: prohibits backend validation assertion actions in Frontend UI plans.
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
 * Cross-table semantic audit for PAT-07 & ANTI-48:
 * Scans Section 4 (Variation Matrix) for empty/null object and unassigned association variations.
 * If detected, enforces that Section 3 (Step Ledger) provisions the PAT-07 Retrieve-from-Teststep
 * sentinel pattern with a scalar sentinel filter and embedded Assert Object Count (PAT-08).
 */
function validatePat07EmptyBoundaries(stepLedgerTable, variationMatrixTable, addCheck) {
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

  // 4. Scan Section 4 for empty/null object or unassigned association indicators
  // Indicator tokens: /empty/i, /null/i, /unassigned/i, /missing/i, /no\s+[a-z]+/i, /no[A-Z][a-z]+/i, etc.
  const emptyTokenRegex = /(?:empty|null|unassigned|missing|no\s+[a-z]+|no[A-Z][a-z]+|no_[a-z]+)/i;
  const detectedEmptyScenarios = [];

  for (const sCol of scenarioCols) {
    const scenName = scenarioNameMap[sCol] || sCol;
    const scenDesc = scenarioDescMap[sCol] || '';

    // Check header string
    if (emptyTokenRegex.test(sCol)) {
      detectedEmptyScenarios.push({ col: sCol, name: scenName, reason: `Header '${sCol}' matches empty/null token` });
      continue;
    }

    // Check Scenario Name
    if (emptyTokenRegex.test(scenName)) {
      detectedEmptyScenarios.push({ col: sCol, name: scenName, reason: `Scenario name '${scenName}' matches empty/null token` });
      continue;
    }

    // Check Scenario Description
    if (emptyTokenRegex.test(scenDesc)) {
      detectedEmptyScenarios.push({ col: sCol, name: scenName, reason: `Scenario description '${scenDesc}' matches empty/null token` });
      continue;
    }

    // Check Matrix Cells: targeting an object parameter or association handle
    for (const row of variationMatrixTable.rows) {
      const rowLabel = targetColKey ? row[targetColKey] : Object.values(row)[0] || '';
      const cleanLabel = rowLabel.replace(/[`*_]/g, '').trim();

      if (/Scenario\s*(?:Name|Desc)/i.test(cleanLabel)) continue;

      const isObjectOrAssocTarget = /(?:assoc|association|handle|object|param|\b[A-Z][a-zA-Z0-9]*_[A-Z][a-zA-Z0-9]*\b)/i.test(cleanLabel);
      const cellVal = (row[sCol] || '').replace(/[`*_\s]/g, '').toLowerCase();

      if (isObjectOrAssocTarget) {
        if (cellVal === 'empty' || cellVal === 'null' || cellVal === "''" || cellVal === '""' || cellVal === '-' || cellVal === '' || cellVal === 'none') {
          detectedEmptyScenarios.push({ col: sCol, name: scenName, reason: `Cell '${cleanLabel}' is empty/null in scenario '${scenName}'` });
          break;
        }
      }
    }
  }

  // 5. Inspect Section 3 (Step Ledger) for PAT-07 & PAT-08
  let hasRetrieveFromTeststep = false;
  let hasValidSentinelFilter = false;
  let hasSentinelCountAssertion = false;
  let hasEnumFilterViolation = false;
  let hasLongSentinelViolation = false;

  for (let idx = 0; idx < stepLedgerTable.rows.length; idx++) {
    const row = stepLedgerTable.rows[idx];
    const rowText = Object.values(row).join(' ');

    const isRetrieve = /Retrieve(?:Object|Objects)?/i.test(rowText);
    const isTeststepOption = /(?:Teststep|from\s+Teststep|from\s+step|RetrieveOption\s*=\s*["']?Teststep["']?)/i.test(rowText);
    const inputCol = Object.keys(row).find(k => k.toLowerCase().includes('input'));
    const inputVal = inputCol ? (row[inputCol] || '').replace(/[`\s]/g, '') : '';
    const hasPipedInput = inputVal && inputVal !== '-' && inputVal.toLowerCase() !== 'none';

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
      if (hasFilterSpec && !isEnumFilter && !hasLongSentinelViolation) {
        hasValidSentinelFilter = true;
      }

      // Assert Object Count (PAT-08)
      if (/Assert\s+(?:Object\s+)?Count|Object\s+Count/i.test(rowText)) {
        hasSentinelCountAssertion = true;
      }
    }
  }

  // Also check if step ledger mentions SentinelKey in raw lines
  const ledgerRawText = stepLedgerTable.rawLines.join(' ');
  if (/SentinelKey/i.test(ledgerRawText) && hasRetrieveFromTeststep && !hasEnumFilterViolation && !hasLongSentinelViolation) {
    hasValidSentinelFilter = true;
  }
  if (/Assert\s+(?:Object\s+)?Count/i.test(ledgerRawText) && hasRetrieveFromTeststep) {
    hasSentinelCountAssertion = true;
  }

  // 6. Enforce checks based on whether empty-object scenarios were detected
  if (detectedEmptyScenarios.length > 0) {
    const primaryScen = detectedEmptyScenarios[0];
    const scenarioName = primaryScen.name;

    const meetsPat07 = hasRetrieveFromTeststep && hasValidSentinelFilter && !hasEnumFilterViolation && !hasLongSentinelViolation;
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

    if (!hasSentinelCountAssertion) {
      addCheck(
        "PAT-08: Object Count Assertion on Sentinel Retrieve",
        false,
        `Scenario '${scenarioName}' tests empty/null boundaries with sentinel retrieve, but Section 3 lacks an embedded Assert Object Count assertion (PAT-08)`,
        "MISSING_COUNT_ASSERTION"
      );
    } else {
      addCheck("PAT-08: Object Count Assertion on Sentinel Retrieve", true);
    }
  } else if (/SentinelKey/i.test(ledgerRawText)) {
    // If no empty scenarios explicitly named but SentinelKey is used in Section 3
    addCheck(
      "PAT-07: Sentinel Filter for Null Parameter Boundaries",
      hasRetrieveFromTeststep && hasValidSentinelFilter,
      "SentinelKey referenced but no RetrieveObject step filters by SentinelKey",
      "MISSING_SENTINEL_RETRIEVE"
    );
    addCheck(
      "PAT-08: Object Count Assertion on Sentinel Retrieve",
      hasSentinelCountAssertion,
      "Sentinel filter step must embed an Object Count assertion",
      "MISSING_COUNT_ASSERTION"
    );
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
export function runSmokeAudit(planPath, serverJsonPath) {
  if (!fs.existsSync(planPath)) {
    throw new Error(`Execution plan not found: ${planPath}`);
  }
  if (!fs.existsSync(serverJsonPath)) {
    throw new Error(`Server JSON data file not found: ${serverJsonPath}`);
  }

  const planContent = fs.readFileSync(planPath, 'utf-8');
  const serverData = JSON.parse(fs.readFileSync(serverJsonPath, 'utf-8'));
  const tables = parseMarkdownTables(planContent);

  let stepLedgerTable = null;
  let variationMatrixTable = null;

  for (const t of tables) {
    const headerStr = t.headers.join(' ').toLowerCase();
    if (headerStr.includes('step action') || headerStr.includes('output handle')) {
      stepLedgerTable = t;
    } else if (headerStr.includes('scenario #1') || (headerStr.includes('scenario name') && headerStr.includes('scenario'))) {
      variationMatrixTable = t;
    }
  }

  const checks = [];
  const errors = [];
  const addCheck = (name, pass, reason = null, code = null, details = null) => {
    checks.push({ name, pass, reason, details });
    if (!pass) errors.push({ code: code || 'AUDIT_FAILED', message: reason });
  };

  // Phase 1: Step Count & Action Type Parity
  const plannedSteps = stepLedgerTable ? stepLedgerTable.rows : [];
  const serverSteps = serverData.testSteps || serverData.steps || [];
  const pCount = plannedSteps.length;
  const sCount = serverSteps.length;

  const phase1Pass = pCount === sCount;
  addCheck("Phase 1: Step Count Parity", phase1Pass, phase1Pass ? null : `Planned steps: ${pCount}, Server steps: ${sCount}`, "STEP_COUNT_MISMATCH", `Planned: ${pCount} | Server: ${sCount}`);

  // Phase 2: Variation Item Registration
  const plannedVarRows = variationMatrixTable ? variationMatrixTable.rows.filter(r => {
    const rowText = Object.values(r).join(' ');
    return !/Scenario\s*(?:Name|Desc)/i.test(rowText);
  }) : [];
  const serverVarItems = serverData.dataVariationItems || serverData.variationItems || [];
  const phase2Pass = plannedVarRows.length === serverVarItems.length || serverVarItems.length >= plannedVarRows.length;
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
  const phase3CountPass = scenarioCols.length <= serverScenarios.length || serverScenarios.length > 0;
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
      if (!serverVar) continue;

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
  const receipt = `
* **Phase 1 (Step Count Parity):** Planned: ${pCount} | Server: ${sCount} | Status: ${phase1Pass ? 'PASS' : 'FAIL'}
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

    const validSentinelPlan = path.join(fixturesDir, 'valid_plan_with_sentinel.md');
    if (fs.existsSync(validSentinelPlan)) {
      const res = lintExecutionPlan(validSentinelPlan);
      addCheck("Fixture: valid_plan_with_sentinel.md passes", res.valid, `Expected valid with PAT-07 sentinel filter, got invalid with ${res.errors.length} errors: ${res.errors.map(e => e.message).join('; ')}`);
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
