#!/usr/bin/env node
/**
 * MTA Linter MCP Server (mta-lint-mcp)
 * 
 * Zero-dependency, dual-transport (HTTP & Stdio) Model Context Protocol (MCP) server
 * backed by the canonical tools/mta-lint.mjs engine.
 * 
 * Transports:
 *   1. Streamable HTTP (--http, default port 7790) for Mendix Studio Pro 11.16+ (MAIA)
 *   2. Stdio (--stdio) for external AI IDEs (Cursor, VS Code, Claude Code, Antigravity)
 */

const http = require('http');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

const SERVER_NAME = 'MTA_linter';
const SERVER_VERSION = '1.0.0';
const DEFAULT_PORT = 7790;

let mtaLintModulePromise = null;
async function getMtaLint() {
  if (!mtaLintModulePromise) {
    const lintPath = path.join(__dirname, '..', 'tools', 'mta-lint.mjs');
    if (!fs.existsSync(lintPath)) {
      throw new Error(`Canonical linter engine not found at ${lintPath}`);
    }
    mtaLintModulePromise = import(pathToFileURL(lintPath).href);
  }
  return mtaLintModulePromise;
}

function loadConfig(rootDir = process.cwd()) {
  const candidatePaths = [
    path.join(rootDir, 'mta_config.json'),
    path.join(__dirname, '..', 'mta_config.json')
  ];
  for (const cfgPath of candidatePaths) {
    if (fs.existsSync(cfgPath)) {
      try {
        return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      } catch (e) {}
    }
  }
  return null;
}

function resolvePlanPath(givenPath, workspaceDir = process.cwd(), mtaLint) {
  const absRoot = path.resolve(workspaceDir);
  const cfg = loadConfig(absRoot);

  let mendixProjectDir = null;
  if (cfg) {
    if (cfg.mendix_mpr_path) {
      mendixProjectDir = path.isAbsolute(cfg.mendix_mpr_path)
        ? path.dirname(cfg.mendix_mpr_path)
        : path.dirname(path.join(absRoot, cfg.mendix_mpr_path));
    } else if (cfg.mendix_project_dir) {
      mendixProjectDir = path.isAbsolute(cfg.mendix_project_dir)
        ? cfg.mendix_project_dir
        : path.join(absRoot, cfg.mendix_project_dir);
    }
  }

  // 1. Explicit path given
  if (givenPath && typeof givenPath === 'string' && givenPath.trim() !== '' && givenPath !== 'auto' && givenPath !== 'latest') {
    const trimmed = givenPath.trim();
    if (path.isAbsolute(trimmed) && fs.existsSync(trimmed)) {
      return trimmed;
    }
    const candidateLocal = path.resolve(absRoot, trimmed);
    if (fs.existsSync(candidateLocal)) {
      return candidateLocal;
    }
    if (mendixProjectDir) {
      const candidateMendix = path.resolve(mendixProjectDir, trimmed);
      if (fs.existsSync(candidateMendix)) {
        return candidateMendix;
      }
    }
    return candidateLocal; // Return normalized path even if missing for error reporting
  }

  // 2. Auto-discovery of active plan
  const activePlan = mtaLint.findActiveExecutionPlan(absRoot);
  if (activePlan) return activePlan;

  if (mendixProjectDir && path.resolve(mendixProjectDir) !== absRoot) {
    const activeMendixPlan = mtaLint.findActiveExecutionPlan(mendixProjectDir);
    if (activeMendixPlan) return activeMendixPlan;
  }

  return null;
}

function discoverAllPlans(workspaceDir = process.cwd()) {
  const absRoot = path.resolve(workspaceDir);
  const cfg = loadConfig(absRoot);
  const candidateDirs = [];

  // Traditional workspace execution plans
  let plansDir = path.join(absRoot, 'menditect-output', 'execution-plans');
  if (cfg && cfg.execution_plans_dir) {
    plansDir = path.isAbsolute(cfg.execution_plans_dir)
      ? cfg.execution_plans_dir
      : path.join(absRoot, cfg.execution_plans_dir);
  }
  if (fs.existsSync(plansDir)) {
    candidateDirs.push({ dir: plansDir, type: 'workspace' });
  }

  // MAIA plans in root
  const localMaiaPlans = path.join(absRoot, 'maia', 'plans');
  if (fs.existsSync(localMaiaPlans)) candidateDirs.push({ dir: localMaiaPlans, type: 'maia' });
  const localHiddenMaiaPlans = path.join(absRoot, '.maia', 'plans');
  if (fs.existsSync(localHiddenMaiaPlans)) candidateDirs.push({ dir: localHiddenMaiaPlans, type: 'maia' });

  // MAIA plans in Mendix project
  if (cfg) {
    let mendixProjectDir = null;
    if (cfg.mendix_mpr_path) {
      mendixProjectDir = path.isAbsolute(cfg.mendix_mpr_path)
        ? path.dirname(cfg.mendix_mpr_path)
        : path.dirname(path.join(absRoot, cfg.mendix_mpr_path));
    } else if (cfg.mendix_project_dir) {
      mendixProjectDir = path.isAbsolute(cfg.mendix_project_dir)
        ? cfg.mendix_project_dir
        : path.join(absRoot, cfg.mendix_project_dir);
    }
    if (mendixProjectDir && path.resolve(mendixProjectDir) !== absRoot) {
      const pMaia = path.join(mendixProjectDir, 'maia', 'plans');
      if (fs.existsSync(pMaia)) candidateDirs.push({ dir: pMaia, type: 'maia' });
      const pHiddenMaia = path.join(mendixProjectDir, '.maia', 'plans');
      if (fs.existsSync(pHiddenMaia)) candidateDirs.push({ dir: pHiddenMaia, type: 'maia' });
    }
  }

  const results = [];
  const seenPaths = new Set();

  for (const item of candidateDirs) {
    try {
      const entries = fs.readdirSync(item.dir, { withFileTypes: true });
      for (const ent of entries) {
        if (item.type === 'maia' && ent.isDirectory()) {
          const planFile = path.join(item.dir, ent.name, 'plan.md');
          if (fs.existsSync(planFile) && !seenPaths.has(planFile)) {
            seenPaths.add(planFile);
            const stat = fs.statSync(planFile);
            const content = fs.readFileSync(planFile, 'utf8');
            const metaMatch = content.match(/plan_id:\s*["']?([^"'\r\n]+)["']?/i);
            const statusMatch = content.match(/status:\s*["']?([^"'\r\n]+)["']?/i);
            results.push({
              plan_id: metaMatch ? metaMatch[1] : ent.name,
              status: statusMatch ? statusMatch[1] : 'UNKNOWN',
              source: 'maia',
              path: planFile,
              last_modified: stat.mtime.toISOString(),
              mtimeMs: stat.mtimeMs
            });
          }
        } else if (item.type === 'workspace' && ent.isFile() && /^EP_.*\.md$/i.test(ent.name)) {
          const planFile = path.join(item.dir, ent.name);
          if (!seenPaths.has(planFile)) {
            seenPaths.add(planFile);
            const stat = fs.statSync(planFile);
            const content = fs.readFileSync(planFile, 'utf8');
            const metaMatch = content.match(/plan_id:\s*["']?([^"'\r\n]+)["']?/i);
            const statusMatch = content.match(/status:\s*["']?([^"'\r\n]+)["']?/i);
            results.push({
              plan_id: metaMatch ? metaMatch[1] : ent.name.replace(/\.md$/i, ''),
              status: statusMatch ? statusMatch[1] : 'UNKNOWN',
              source: 'workspace',
              path: planFile,
              last_modified: stat.mtime.toISOString(),
              mtimeMs: stat.mtimeMs
            });
          }
        }
      }
    } catch (e) {}
  }

  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return results.map(({ mtimeMs, ...rest }) => rest);
}

const MCP_TOOLS = [
  {
    name: 'lint_plan',
    description: 'Validates the 6-section Execution Plan (EP_*.md or maia/plans/*/plan.md) structure, metadata, variation matrix (ANTI-48, ANTI-59), and step patterns (PAT-07, ANTI-20). Records Phase 1 draft receipt.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_path: {
          type: 'string',
          description: 'Relative or absolute path to the execution plan file. If omitted, automatically resolves the latest plan in maia/plans/*/plan.md or EP_*.md.'
        },
        plan_content: {
          type: 'string',
          description: 'Optional raw markdown string of the execution plan to validate in-memory before writing to disk.'
        }
      }
    }
  },
  {
    name: 'pre_exec_check',
    description: 'Verifies that the plan is persisted on disk, passes structural lint, and has an executable status (AUTO_APPROVED, APPROVED, or BUILT_AND_VERIFIED) prior to calling MTA_plugin.execute-testcase (PAT-43, ANTI-46).',
    inputSchema: {
      type: 'object',
      properties: {
        plan_path: {
          type: 'string',
          description: 'Path to execution plan. Defaults to latest active plan.'
        }
      }
    }
  },
  {
    name: 'stage_placement',
    description: 'Stages Gate 2 placement and Playwright options in the gate ledger (.mta-gate-ledger.json) for Option B persistent test construction (PAT-118).',
    inputSchema: {
      type: 'object',
      required: ['config_key', 'suite_key'],
      properties: {
        plan_path: {
          type: 'string',
          description: 'Path to execution plan. Defaults to latest active plan.'
        },
        config_key: {
          type: 'number',
          description: 'Target test configuration key (> 0).'
        },
        suite_key: {
          type: ['string', 'number'],
          description: 'Target test suite key (> 0 or "NEW_SUITE").'
        },
        browser: {
          type: 'string',
          description: 'Playwright browser type (Chromium, Firefox, WebKit).'
        },
        mode: {
          type: 'string',
          description: 'Playwright execution mode (Headless, Headed).'
        },
        slow_mo: {
          type: 'number',
          description: 'Playwright slowMo delay in ms.'
        },
        frontend_options_confirmed: {
          type: 'boolean',
          description: 'Whether frontend Playwright options have been confirmed by user.'
        }
      }
    }
  },
  {
    name: 'pre_build_check',
    description: 'Verifies Gate 1 human approval (status: APPROVED) & Gate 2 placement before calling mutating MTA server tools (Create*, Edit*, Set*).',
    inputSchema: {
      type: 'object',
      properties: {
        plan_path: {
          type: 'string',
          description: 'Path to execution plan. Defaults to latest active plan.'
        }
      }
    }
  },
  {
    name: 'lock_plan',
    description: 'Seals a Red bug-reproduction Execution Plan with a one-way cryptographic locked_sha256 hash (PAT-124).',
    inputSchema: {
      type: 'object',
      properties: {
        plan_path: {
          type: 'string',
          description: 'Path to execution plan. Defaults to latest active plan.'
        },
        force: {
          type: 'boolean',
          description: 'Force overwrite existing lock hash.'
        },
        reseal_wiring: {
          type: 'boolean',
          description: 'Reseal wiring step bindings without soft-modifying assertions.'
        }
      }
    }
  },
  {
    name: 'verify_lock',
    description: 'Verifies that a locked Execution Plan assertions (IMMUTABLE_ASSERTION_ANCHOR, Section 3 & 4) have not been tampered with during CODE_REPAIR_INTERMISSION (ANTI-78).',
    inputSchema: {
      type: 'object',
      properties: {
        plan_path: {
          type: 'string',
          description: 'Path to execution plan. Defaults to latest active plan.'
        }
      }
    }
  },
  {
    name: 'smoke_audit',
    description: 'Runs the 4-Phase post-construction semantic smoke audit (PAT-80, PAT-107) comparing the plan against MTA server JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_path: {
          type: 'string',
          description: 'Path to execution plan. Defaults to latest active plan.'
        },
        server_json_paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of file paths to MTA server JSON files (from GetTestCaseDetails / GetTestSuiteDetails).'
        },
        server_json_payloads: {
          type: 'array',
          items: { type: 'object' },
          description: 'Array of raw JSON objects returned by MTA MCP tools to audit directly in-memory.'
        }
      }
    }
  },
  {
    name: 'list_plans',
    description: 'Lists discovered Execution Plans in maia/plans/*/plan.md and menditect-output/execution-plans/EP_*.md with metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          enum: ['all', 'maia', 'workspace'],
          description: 'Filter plans by source origin.'
        }
      }
    }
  }
];

async function executeTool(name, args = {}, workspaceDir = process.cwd()) {
  const mtaLint = await getMtaLint();

  switch (name) {
    case 'lint_plan': {
      if (args.plan_content && typeof args.plan_content === 'string') {
        const tempFile = path.join(os.tmpdir(), `temp_plan_${Date.now()}_${Math.random().toString(36).slice(2)}.md`);
        try {
          fs.writeFileSync(tempFile, args.plan_content, 'utf8');
          const result = mtaLint.lintExecutionPlan(tempFile);
          result.target = args.plan_path || '<in-memory>';
          return result;
        } finally {
          try { fs.unlinkSync(tempFile); } catch (e) {}
        }
      }

      const planPath = resolvePlanPath(args.plan_path, workspaceDir, mtaLint);
      if (!planPath) {
        return {
          valid: false,
          error: 'No execution plan found. Provide plan_path or ensure plan.md or EP_*.md exists.'
        };
      }
      return mtaLint.lintExecutionPlan(planPath);
    }

    case 'pre_exec_check': {
      const planPath = resolvePlanPath(args.plan_path, workspaceDir, mtaLint);
      if (!planPath) {
        return {
          valid: false,
          error: 'No execution plan found to verify pre-exec gate.'
        };
      }
      return mtaLint.verifyPreExecGate(planPath);
    }

    case 'stage_placement': {
      const planPath = resolvePlanPath(args.plan_path, workspaceDir, mtaLint);
      if (!planPath) {
        return {
          valid: false,
          error: 'No execution plan found to stage placement.'
        };
      }
      return mtaLint.stagePlacementGate(planPath, {
        configKey: args.config_key,
        suiteKey: args.suite_key,
        browser: args.browser,
        mode: args.mode,
        slowMo: args.slow_mo,
        frontendOptionsConfirmed: args.frontend_options_confirmed
      });
    }

    case 'pre_build_check': {
      const planPath = resolvePlanPath(args.plan_path, workspaceDir, mtaLint);
      if (!planPath) {
        return {
          valid: false,
          error: 'No execution plan found to verify pre-build gate.'
        };
      }
      return mtaLint.verifyPreBuildGate(planPath);
    }

    case 'lock_plan': {
      const planPath = resolvePlanPath(args.plan_path, workspaceDir, mtaLint);
      if (!planPath) {
        return {
          valid: false,
          error: 'No execution plan found to lock.'
        };
      }
      return mtaLint.lockExecutionPlan(planPath, {
        force: !!args.force,
        resealWiring: !!args.reseal_wiring
      });
    }

    case 'verify_lock': {
      const planPath = resolvePlanPath(args.plan_path, workspaceDir, mtaLint);
      if (!planPath) {
        return {
          valid: false,
          error: 'No execution plan found to verify lock.'
        };
      }
      return mtaLint.verifyLockedExecutionPlan(planPath);
    }

    case 'smoke_audit': {
      const planPath = resolvePlanPath(args.plan_path, workspaceDir, mtaLint);
      if (!planPath) {
        return {
          valid: false,
          error: 'No execution plan found for smoke audit.'
        };
      }

      const tempFiles = [];
      const jsonPaths = Array.isArray(args.server_json_paths) ? [...args.server_json_paths] : [];

      if (Array.isArray(args.server_json_payloads)) {
        for (let i = 0; i < args.server_json_payloads.length; i++) {
          const tFile = path.join(os.tmpdir(), `server_payload_${Date.now()}_${i}.json`);
          fs.writeFileSync(tFile, JSON.stringify(args.server_json_payloads[i]), 'utf8');
          tempFiles.push(tFile);
          jsonPaths.push(tFile);
        }
      }

      try {
        if (jsonPaths.length === 0) {
          return {
            valid: false,
            error: 'No server JSON data provided. Pass server_json_paths or server_json_payloads.'
          };
        }
        return mtaLint.runSmokeAudit(planPath, ...jsonPaths);
      } finally {
        for (const f of tempFiles) {
          try { fs.unlinkSync(f); } catch (e) {}
        }
      }
    }

    case 'list_plans': {
      const plans = discoverAllPlans(workspaceDir);
      const filter = String(args.source || 'all').toLowerCase();
      if (filter === 'all') return { count: plans.length, plans };
      const filtered = plans.filter(p => p.source === filter);
      return { count: filtered.length, plans: filtered };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleJsonRpcMessage(message, workspaceDir = process.cwd()) {
  if (!message || typeof message !== 'object') {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' }
    };
  }

  const { id, method, params } = message;

  // Handle notifications (no id)
  if (id === undefined || id === null) {
    if (method === 'notifications/initialized') {
      return null;
    }
    return null;
  }

  try {
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: { listChanged: false }
            },
            serverInfo: {
              name: SERVER_NAME,
              version: SERVER_VERSION
            }
          }
        };

      case 'ping':
        return {
          jsonrpc: '2.0',
          id,
          result: {}
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: MCP_TOOLS
          }
        };

      case 'tools/call': {
        const toolName = params && params.name;
        const toolArgs = (params && params.arguments) || {};
        if (!toolName) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Missing tool name' }
          };
        }
        const toolResult = await executeTool(toolName, toolArgs, workspaceDir);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2)
              }
            ],
            isError: toolResult && toolResult.valid === false
          }
        };
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` }
        };
    }
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: err.message || 'Internal error' }
    };
  }
}

function startStdioServer(workspaceDir = process.cwd()) {
  console.error(`[MTA_linter] Stdio MCP server starting (v${SERVER_VERSION})...`);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const msg = JSON.parse(trimmed);
      const res = await handleJsonRpcMessage(msg, workspaceDir);
      if (res) {
        process.stdout.write(JSON.stringify(res) + '\n');
      }
    } catch (e) {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' }
      }) + '\n');
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

function startHttpServer(port = DEFAULT_PORT, workspaceDir = process.cwd()) {
  const server = http.createServer(async (req, res) => {
    // CORS headers for Studio Pro and local browser tools
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    if (req.method === 'GET' && pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        server: SERVER_NAME,
        version: SERVER_VERSION,
        port
      }));
      return;
    }

    if (req.method === 'POST' && (pathname === '/mcp' || pathname === '/')) {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const msg = JSON.parse(body);
          const rpcRes = await handleJsonRpcMessage(msg, workspaceDir);
          if (rpcRes) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(rpcRes));
          } else {
            res.writeHead(204);
            res.end();
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' }
          }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Not found: ${pathname}` }));
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`==================================================`);
    console.log(`  MTA Linter MCP Server (${SERVER_NAME}) v${SERVER_VERSION}`);
    console.log(`==================================================`);
    console.log(`Status   : RUNNING`);
    console.log(`Endpoint : http://localhost:${port}/mcp`);
    console.log(`Health   : http://localhost:${port}/health`);
    console.log(`Transport: Streamable HTTP (JSON-RPC 2.0)`);
    console.log(`MAIA Conf: Server Name 'MTA_linter', Connection 'HTTP', Auth 'None'`);
    console.log(`==================================================`);
  });

  return server;
}

// CLI Dispatcher
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
MTA Linter MCP Server (MTA_linter) v${SERVER_VERSION}

Usage:
  node scripts/mta-lint-mcp.js [options]

Options:
  --http           Start Streamable HTTP MCP server (default)
  --port <number>  Port for HTTP server (default: 7790 or MTA_LINTER_MCP_PORT)
  --stdio          Start Stdio MCP server (for AI IDEs: Cursor, VS Code, Claude, etc.)
  --help, -h       Show this help message

For Mendix Studio Pro 11.16+ (MAIA):
  1. Start server: npm run linter:mcp (or run start-linter-mcp.bat / ./start-linter-mcp)
  2. In Studio Pro: Settings -> AI Assistant -> MCP Servers -> Add
     Name: MTA_linter
     Connection: HTTP
     URL: http://localhost:7790/mcp
     Authentication: None
`);
    process.exit(0);
  }

  const isStdio = args.includes('--stdio');

  let port = DEFAULT_PORT;
  const portIdx = args.indexOf('--port');
  if (portIdx !== -1 && args[portIdx + 1]) {
    port = parseInt(args[portIdx + 1], 10) || DEFAULT_PORT;
  } else if (process.env.MTA_LINTER_MCP_PORT) {
    port = parseInt(process.env.MTA_LINTER_MCP_PORT, 10) || DEFAULT_PORT;
  } else {
    const cfg = loadConfig();
    if (cfg && (cfg.mta_linter_mcp_port || cfg.mta_linter_port)) {
      port = parseInt(cfg.mta_linter_mcp_port || cfg.mta_linter_port, 10) || DEFAULT_PORT;
    }
  }

  if (isStdio) {
    startStdioServer();
  } else {
    startHttpServer(port);
  }
}

module.exports = {
  SERVER_NAME,
  SERVER_VERSION,
  DEFAULT_PORT,
  MCP_TOOLS,
  resolvePlanPath,
  discoverAllPlans,
  executeTool,
  handleJsonRpcMessage,
  startStdioServer,
  startHttpServer
};
