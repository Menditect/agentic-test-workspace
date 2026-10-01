const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const proxyPath = path.join(__dirname, 'mta-proxy.js');
const rootDir = path.join(__dirname, '..');

let scriptVersion = '';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  if (pkg.version) scriptVersion = ` (v${pkg.version})`;
} catch (e) {}

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  orange: '\x1b[38;5;208m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

const PASS = `${colors.green}[PASS]${colors.reset}`;
const FAIL = `${colors.red}[FAIL]${colors.reset}`;
const WARN = `${colors.yellow}[WARN]${colors.reset}`;
const NOTICE = `${colors.orange}[NOTICE]${colors.reset}`;
const INFO = `${colors.cyan}[INFO]${colors.reset}`;
const TIP = `${colors.cyan}[TIP]${colors.reset}`;

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let val = match[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  } catch (e) {}
}

const candidateConfigPaths = [
  path.join(process.cwd(), 'mta_config.json'),
  path.join(rootDir, 'mta_config.json'),
  path.join(rootDir, '..', 'mta_config.json')
];

let rawConfig = {};
let activeConfigPath = null;
for (const cp of candidateConfigPaths) {
  if (fs.existsSync(cp)) {
    try {
      rawConfig = JSON.parse(fs.readFileSync(cp, 'utf8'));
      activeConfigPath = cp;
      break;
    } catch (e) {}
  }
}

const { normalizeConfigAliases } = require('./setup');
let config = normalizeConfigAliases ? normalizeConfigAliases(rawConfig) : rawConfig;

// If config points to a workspace_dir with its own mta_config.json, merge it
if (config.workspace_dir && fs.existsSync(path.join(config.workspace_dir, 'mta_config.json'))) {
  const wsConfigPath = path.join(config.workspace_dir, 'mta_config.json');
  if (path.resolve(wsConfigPath) !== path.resolve(activeConfigPath || '')) {
    try {
      const wsCfg = JSON.parse(fs.readFileSync(wsConfigPath, 'utf8'));
      const normalizedWs = normalizeConfigAliases ? normalizeConfigAliases(wsCfg) : wsCfg;
      rawConfig = { ...rawConfig, ...wsCfg };
      config = { ...config, ...normalizedWs };
      if (!activeConfigPath) activeConfigPath = wsConfigPath;
    } catch (e) {}
  }
}

// Load env files in priority order (workspace_dir, cwd, rootDir, parent, mendix_project_dir)
const candidateEnvDirs = [
  config.workspace_dir,
  process.cwd(),
  rootDir,
  path.join(rootDir, '..'),
  config.mendix_project_dir
].filter(Boolean);

const seenDirs = new Set();
for (const dir of candidateEnvDirs) {
  const resolved = path.resolve(dir);
  if (!seenDirs.has(resolved)) {
    seenDirs.add(resolved);
    loadEnvFile(path.join(resolved, '.env.local'));
    loadEnvFile(path.join(resolved, '.env'));
  }
}

function validateConfigAgainstSchema(cfg) {
  const schemaPath = path.join(__dirname, '..', 'mta_config.schema.json');
  if (!fs.existsSync(schemaPath)) {
    return { valid: true, errors: [] };
  }
  let schema = {};
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  } catch (e) {
    return { valid: false, errors: ['Failed to parse mta_config.schema.json'] };
  }

  const errors = [];
  const required = schema.required || ['mta_base_url', 'mcp_endpoint'];
  for (const req of required) {
    if (!cfg[req] || (typeof cfg[req] === 'string' && !cfg[req].trim())) {
      errors.push(`Missing required property: '${req}'`);
    }
  }

  if (cfg.workspace_type && !['clone_root', 'mendix_project', 'custom'].includes(cfg.workspace_type)) {
    errors.push(`Invalid workspace_type: '${cfg.workspace_type}' (expected: clone_root, mendix_project, or custom)`);
  }

  if (cfg.skills_style && !['standard', 'mendix_module'].includes(cfg.skills_style)) {
    errors.push(`Invalid skills_style: '${cfg.skills_style}' (expected: standard or mendix_module)`);
  }

  if (cfg.model_source && !['mxcli', 'studiopro'].includes(cfg.model_source)) {
    errors.push(`Invalid model_source: '${cfg.model_source}' (expected: mxcli or studiopro)`);
  }

  if (cfg.app_instances) {
    if (!Array.isArray(cfg.app_instances)) {
      errors.push(`'app_instances' must be an array`);
    } else {
      cfg.app_instances.forEach((inst, idx) => {
        if (!inst || typeof inst !== 'object') {
          errors.push(`app_instances[${idx}] must be an object`);
        } else {
          if (!inst.name || typeof inst.name !== 'string') {
            errors.push(`app_instances[${idx}] missing required string 'name'`);
          }
          if (!inst.token || typeof inst.token !== 'string') {
            errors.push(`app_instances[${idx}] missing required string 'token'`);
          }
        }
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

function checkSchemaContractAlignment() {
  const localSchemaPath = path.join(rootDir, 'mta_config.schema.json');
  if (!fs.existsSync(localSchemaPath)) return true;
  let localSchema;
  try {
    localSchema = JSON.parse(fs.readFileSync(localSchemaPath, 'utf8'));
  } catch (e) {
    return true;
  }
  const localVersion = localSchema.version;

  const candidateUpstreams = [
    { name: 'agentic-test-skills (local skills/mta-build)', path: path.join(rootDir, 'skills', 'mta-build', 'references', 'mta_config.schema.json') },
    { name: 'agentic-test-skills repository', path: path.join(rootDir, '..', 'agentic-test-skills', 'AgenticTestSkills', 'mta-build', 'references', 'mta_config.schema.json') }
  ];

  for (const candidate of candidateUpstreams) {
    if (fs.existsSync(candidate.path)) {
      try {
        const upstream = JSON.parse(fs.readFileSync(candidate.path, 'utf8'));
        if (upstream.version && localVersion !== upstream.version) {
          console.warn(`${WARN} Contract version mismatch: mta_config.schema.json is v${localVersion}, but ${candidate.name} is v${upstream.version}!`);
          console.warn(`       mta_config contract version must match agentic-test-skills. Run "npm run update:skills" to align.`);
          return false;
        } else if (upstream.version) {
          console.log(`${PASS} mta_config schema contract (v${localVersion}) is aligned with ${candidate.name}.`);
          return true;
        }
      } catch (e) {}
    }
  }
  console.log(`${INFO} mta_config schema contract version is v${localVersion}.`);
  return true;
}

function checkSkillsPresence() {
  const wsDir = config.workspace_dir || rootDir;
  const skillsDir = config.skills_dir || path.join(wsDir, 'skills');
  console.log('Checking MTA skills presence...');

  if (!fs.existsSync(skillsDir)) {
    console.warn(`  ${WARN} Skills directory not found at ${skillsDir}. Run "npm run update:skills" to download MTA skills.`);
    return false;
  }

  const expectedSkills = ['mta-test-design', 'mta-build', 'mta-run-analyze', 'mta-install-config'];
  const hasAgents = fs.existsSync(path.join(skillsDir, 'AGENTS.md'));
  const foundSkills = expectedSkills.filter(skill => fs.existsSync(path.join(skillsDir, skill)));

  if (hasAgents && foundSkills.length === expectedSkills.length) {
    console.log(`  ${PASS} MTA skills are active in ${skillsDir} (orchestrator + ${foundSkills.length} domain skills present).`);
    return true;
  } else if (foundSkills.length > 0) {
    console.warn(`  ${WARN} Partial MTA skills detected in ${skillsDir} (${foundSkills.length}/${expectedSkills.length}). Run "npm run update:skills" to align.`);
    return false;
  } else {
    console.warn(`  ${WARN} No MTA skills detected in ${skillsDir}. Run "npm run update:skills" to download them.`);
    return false;
  }
}

function checkMxcliBinary() {
  const toolsRootDir = path.join(__dirname, '..');
  const binName = process.platform === 'win32' ? 'mxcli.exe' : 'mxcli';
  const binPath = path.join(toolsRootDir, 'bin', binName);

  if (!fs.existsSync(binPath)) {
    console.warn(`${WARN} mxcli binary not found at ${binPath}. Run "npm run update:mxcli" to install it.`);
    return false;
  }

  try {
    const versionOut = require('child_process').execSync(`"${binPath}" --version`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 5000
    }).trim();
    console.log(`${PASS} mxcli binary is ready (${versionOut}).`);

    // Check if mxcli AI scaffolding (.ai-context) is initialized
    const targetDir = config.workspace_dir || toolsRootDir;
    const aiContextPath = path.join(targetDir, '.ai-context');
    const dotMxcliPath = path.join(targetDir, '.mxcli');
    if (fs.existsSync(aiContextPath)) {
      console.log(`${PASS} mxcli AI scaffolding is initialized (.ai-context/skills/).`);
    } else {
      console.log(`${NOTICE} mxcli AI scaffolding not initialized in ${targetDir}. Run "npm run setup" to initialize skills and context.`);
    }
    if (fs.existsSync(dotMxcliPath)) {
      console.log(`${PASS} Local mxcli working directory is present (.mxcli/).`);
    }

    // Check if Mendix project catalog (.mxcli/catalog.db) is populated
    const mendixDir = config.mendix_project_dir || (config.mendix_mpr_path ? path.dirname(config.mendix_mpr_path) : null);
    if (mendixDir) {
      const catalogDbPath = path.join(mendixDir, '.mxcli', 'catalog.db');
      if (fs.existsSync(catalogDbPath)) {
        try {
          const stats = fs.statSync(catalogDbPath);
          if (stats.size > 0) {
            const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
            const mtime = stats.mtime.toISOString().replace('T', ' ').substring(0, 19);
            console.log(`${PASS} Mendix project catalog is active (.mxcli/catalog.db, ${sizeMb} MB, modified ${mtime}).`);
          } else {
            console.warn(`${WARN} Mendix project catalog exists but is empty (0 bytes) at ${catalogDbPath}.`);
            console.warn(`       MTA test analysis and code search require the project catalog.`);
            console.warn(`       To populate: ./mxcli -c "REFRESH CATALOG SOURCE FORCE;"`);
            console.warn(`       (Note: On large projects, source extraction may take multiple minutes to 1 hour).`);
          }
        } catch (e) {
          console.warn(`${WARN} Unable to inspect catalog.db: ${e.message}`);
        }
      } else {
        console.warn(`${WARN} Mendix project catalog is not built (.mxcli/catalog.db not found in ${mendixDir}).`);
        console.warn(`       MTA test analysis and code search require the project catalog.`);
        console.warn(`       To generate: ./mxcli -c "REFRESH CATALOG SOURCE FORCE;"`);
        console.warn(`       (Note: On large projects, source extraction may take multiple minutes to 1 hour).`);
      }
    }

    return true;
  } catch (e) {
    console.warn(`${WARN} mxcli binary present at ${binPath} but failed execution check: ${e.message}`);
    return false;
  }
}

function checkLinterTooling() {
  const linterPath = path.join(rootDir, 'tools', 'mta-lint.mjs');
  if (!fs.existsSync(linterPath)) {
    console.warn(`${WARN} MTA linter tool not found at ${linterPath}. Run "npm run update" to install it.`);
    return false;
  }
  try {
    const res = require('child_process').execSync(`node "${linterPath}" self-test --json`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const data = JSON.parse(res);
    if (data.valid === true) {
      console.log(`${PASS} MTA Linter tooling is ready (${data.passedCount}/${data.totalCount} self-tests passed).`);
      return true;
    } else {
      console.warn(`${WARN} MTA Linter self-test failed.`);
      return false;
    }
  } catch (e) {
    console.warn(`${WARN} Could not execute MTA Linter self-test: ${e.message}`);
    return false;
  }
}

function checkTokenPreflight(mode) {
  if (mode === 'mta') {
    const hasToken = process.env.MTA_MCP_AUTH_HEADER || (process.env.MTA_MCP_TOKEN ? `Bearer ${process.env.MTA_MCP_TOKEN}` : null) || (config.mta_auth_header && config.mta_auth_header.trim());
    if (!hasToken) {
      console.log(`${INFO} No identification token for a service account configured in .env or MTA_MCP_AUTH_HEADER (optional for free exploratory testing).`);
    } else {
      console.log(`${INFO} Identification token for a service account is configured.`);
      const rawToken = hasToken.replace(/^Bearer\s+/i, '').trim();
      if (rawToken.length < 28) {
        console.warn(`  ${WARN} Configured MTA token is shorter than 28 characters (${rawToken.length} chars: "${rawToken}").`);
        console.warn('         MTA Cloud service account tokens are long tokens generated in MTA Service Account Manager.');
        console.warn('         If you do not have an MTA license/token, leave MTA_MCP_AUTH_HEADER empty in .env to use free exploratory testing.');
      }
    }
  } else if (mode === 'plugin') {
    const hasToken = process.env.PLUGIN_MCP_TOKEN || (config.plugin_mcp_token && config.plugin_mcp_token.trim());
    if (!hasToken) {
      console.warn(`${WARN} No Plugin token configured in .env or PLUGIN_MCP_TOKEN (recommended: Bearer <token>).`);
    } else {
      console.log(`${INFO} Plugin token is configured.`);
    }
  } else if (mode === 'studiopro') {
    console.log(`${INFO} Studio Pro MCP does not require authentication.`);
  }
}

function checkSecurityHygiene() {
  console.log('Checking secret storage and security hygiene...');
  const wsDir = config.workspace_dir || rootDir;

  // 1. Check .vscode/settings.json
  const settingsPath = path.join(wsDir, '.vscode', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const settingsContent = fs.readFileSync(settingsPath, 'utf8');
      if (settingsContent.includes('MTA_MCP_AUTH_HEADER') || settingsContent.includes('PLUGIN_MCP_TOKEN')) {
        console.warn(`  ${WARN} Sensitive tokens detected in .vscode/settings.json! Run "npm run setup" to migrate them to .env and clean settings.json.`);
      } else {
        console.log(`  ${PASS} .vscode/settings.json contains no sensitive tokens.`);
      }
    } catch (e) {}
  }

  // 2. Check IDE MCP configuration files for hardcoded tokens or obsolete paths
  const candidateMcpFiles = [
    { label: 'Cursor .cursor/mcp.json', path: path.join(wsDir, '.cursor', 'mcp.json') },
    { label: 'VS Code .vscode/mcp.json', path: path.join(wsDir, '.vscode', 'mcp.json') },
    { label: 'Claude .claude/settings.json', path: path.join(wsDir, '.claude', 'settings.json') },
    { label: 'Antigravity global mcp_config.json', path: path.join(process.env.USERPROFILE || process.env.HOME || '', '.gemini', 'antigravity', 'mcp_config.json') },
    { label: 'Claude Desktop global config', path: process.platform === 'win32'
        ? path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json')
        : path.join(process.env.HOME || '', 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json') }
  ];

  let mcpHygienePassed = true;
  for (const item of candidateMcpFiles) {
    if (fs.existsSync(item.path)) {
      try {
        const raw = fs.readFileSync(item.path, 'utf8');
        const parsed = JSON.parse(raw);
        const servers = parsed.mcpServers || {};
        for (const [srvName, srvDef] of Object.entries(servers)) {
          const argsStr = JSON.stringify(srvDef.args || []);
          if (/bearer\s+/i.test(argsStr)) {
            mcpHygienePassed = false;
            console.warn(`  ${WARN} ${item.label} (${srvName}) contains hardcoded tokens in args!`);
            console.warn(`         Tokens should be stored in .env. Run "npm run setup" to sanitize.`);
          }
          if (argsStr.includes('mta-ai-assistant')) {
            mcpHygienePassed = false;
            console.warn(`  ${WARN} ${item.label} (${srvName}) references outdated proxy path 'mta-ai-assistant'.`);
            console.warn(`         Run "npm run setup" to update proxy references.`);
          }
        }
      } catch (e) {}
    }
  }
  if (mcpHygienePassed) {
    console.log(`  ${PASS} IDE MCP configurations contain no hardcoded tokens or outdated proxy paths.`);
  }

  // 3. Check .env gitignore status
  const envPath = path.join(wsDir, '.env');
  const gitIgnorePath = path.join(wsDir, '.gitignore');
  if (fs.existsSync(envPath)) {
    if (fs.existsSync(gitIgnorePath)) {
      const gitIgnoreContent = fs.readFileSync(gitIgnorePath, 'utf8');
      const lines = gitIgnoreContent.split(/\r?\n/).map(l => l.trim());
      const hasEnv = lines.some(l => l === '.env' || l === '*.env' || l.startsWith('.env'));
      if (hasEnv) {
        console.log(`  ${PASS} .env is properly protected by .gitignore.`);
      } else {
        console.warn(`  ${WARN} .env exists in workspace but is NOT ignored in .gitignore! Add .env to .gitignore to prevent accidental commit.`);
      }
    } else {
      console.warn(`  ${WARN} .env exists in workspace but no .gitignore found! Ensure credentials are not committed.`);
    }
  }

  // 4. Check mta_config.json legacy tokens
  if (rawConfig.mta_auth_header || rawConfig.plugin_mcp_token) {
    console.log(`  ${INFO} mta_config.json contains legacy auth tokens. Run "npm run setup" to decouple secrets to .env.`);
  } else {
    console.log(`  ${PASS} mta_config.json contains no hardcoded authentication tokens.`);
  }

  // 5. Cloned Repository Immutability Rule: Verify toolsRootDir is not polluted
  if (config.workspace_dir && path.resolve(config.workspace_dir) !== path.resolve(rootDir)) {
    const dirtyFiles = [];
    if (fs.existsSync(path.join(rootDir, 'mta_config.json'))) dirtyFiles.push('mta_config.json');
    if (fs.existsSync(path.join(rootDir, '.env'))) dirtyFiles.push('.env');
    if (fs.existsSync(path.join(rootDir, '.env.local'))) dirtyFiles.push('.env.local');

    if (dirtyFiles.length > 0) {
      console.warn(`  ${WARN} Cloned repository contains local workspace files (${dirtyFiles.join(', ')}).`);
      console.warn(`         To ensure clean git pulls, workspace configuration should live exclusively in ${config.workspace_dir}.`);
    } else {
      console.log(`  ${PASS} Cloned agentic-test-workspace repository is clean (tools isolation verified).`);
    }
  }
}

function checkAgentDirectives() {
  console.log('Checking agent directives integrity...');
  const wsDir = config.workspace_dir || rootDir;
  const targetFiles = [
    { name: 'AGENTS.md', path: path.join(wsDir, 'AGENTS.md') },
    { name: 'CLAUDE.md', path: path.join(wsDir, 'CLAUDE.md') },
    { name: 'GEMINI.md', path: path.join(wsDir, 'GEMINI.md') }
  ];

  let allIntact = true;
  for (const item of targetFiles) {
    if (fs.existsSync(item.path)) {
      try {
        const content = fs.readFileSync(item.path, 'utf8');
        const hasSetup = content.includes('# Menditect Architecture Setup');
        const hasSsot = content.includes('ENVIRONMENT SSOT') || content.includes('mta_config.json');
        if (!hasSetup || !hasSsot) {
          allIntact = false;
          console.warn(`  ${WARN} ${item.name} is missing the Menditect Architecture Setup directives!`);
          console.warn(`         This can occur if "mxcli init" was executed directly.`);
          console.warn(`         Run "npm run setup:directives" to restore them immediately.`);
        } else {
          console.log(`  ${PASS} ${item.name} has Menditect directives intact.`);
        }
      } catch (e) {
        console.warn(`  ${WARN} Could not read ${item.name}: ${e.message}`);
      }
    }
  }
  return allIntact;
}

function checkPublicBoundaryHygiene() {
  console.log('Checking public boundary hygiene and upstream attribution...');
  const forbiddenPatterns = [
    { term: 'mta-ai-assistant', desc: 'Internal skills build repository reference' },
    { term: 'mta_ai_assistant', desc: 'Internal skills build repository identifier' }
  ];

  const targetScanDirs = ['releases', 'docs'];
  const targetScanFiles = ['README.md', 'mta_config.schema.json', 'package.json'];
  const violations = [];

  for (const dirName of targetScanDirs) {
    const dirPath = path.join(rootDir, dirName);
    if (!fs.existsSync(dirPath)) continue;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const filePath = path.join(dirPath, entry.name);
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const lines = content.split(/\r?\n/);
          lines.forEach((line, idx) => {
            for (const pat of forbiddenPatterns) {
              if (line.toLowerCase().includes(pat.term)) {
                violations.push({
                  file: path.relative(rootDir, filePath),
                  line: idx + 1,
                  desc: pat.desc,
                  snippet: line.trim()
                });
              }
            }
          });
        } catch (e) {}
      }
    }
  }

  for (const fileName of targetScanFiles) {
    const filePath = path.join(rootDir, fileName);
    if (!fs.existsSync(filePath)) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split(/\r?\n/);
      lines.forEach((line, idx) => {
        for (const pat of forbiddenPatterns) {
          if (line.toLowerCase().includes(pat.term)) {
            violations.push({
              file: fileName,
              line: idx + 1,
              desc: pat.desc,
              snippet: line.trim()
            });
          }
        }
      });
    } catch (e) {}
  }

  if (violations.length === 0) {
    console.log(`  ${PASS} All public release notes, docs, and schemas correctly attribute official upstream "agentic-test-skills".`);
    return true;
  } else {
    console.error(`  ${FAIL} Public Boundary Violation: Reference to internal build repository detected:`);
    for (const v of violations) {
      console.error(`    - ${v.file}:${v.line} [${v.desc}] -> "${v.snippet}"`);
    }
    console.error('  Official upstream repository is "agentic-test-skills". Please fix before releasing.\n');
    return false;
  }
}

function checkAppInstances() {
  const instances = config.app_instances || [];
  const defaultToken = config.default_app_instance_token || process.env.MTA_APP_INSTANCE_TOKEN;
  if (!instances.length && !defaultToken) {
    console.log(`${INFO} No MTA App Instance Tokens configured (automated cloud ExecuteTest is inactive).`);
    return;
  }
  const defaultName = config.default_app_instance || (instances[0] ? instances[0].name : 'default');
  console.log(`${INFO} Configured ${instances.length || 1} MTA App Instance Token(s). Active default: [${defaultName}].`);

  if (config.mendix_mpr_path && fs.existsSync(config.mendix_mpr_path) && defaultToken) {
    const toolsRootDir = path.join(__dirname, '..');
    const mxcliBin = path.join(toolsRootDir, 'bin', process.platform === 'win32' ? 'mxcli.exe' : 'mxcli');
    if (fs.existsSync(mxcliBin)) {
      try {
        const out = require('child_process').execSync(`"${mxcliBin}" describe settings Settings -p "${config.mendix_mpr_path}"`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
          timeout: 10000
        });
        if (out.includes(defaultToken)) {
          console.log(`  ${INFO} Active App Instance Token matches a configuration in the Mendix project model.`);
        } else {
          console.log(`  ${NOTICE} Active App Instance Token was not found in the Mendix project settings (it may be an external or custom instance).`);
        }
      } catch (e) {}
    }
  }
}

function checkPlaywrightTraceSettings() {
  const viewerUrl = config.playwright_viewer_url || process.env.PLAYWRIGHT_VIEWER_URL || 'https://trace.playwright.dev/?trace=';
  const tracefileBase = config.tracefile_base_url || process.env.MTA_TRACEFILE_BASE_URL || (config.mta_base_url ? `${config.mta_base_url.replace(/\/$/, '')}/rest/private/tracefile?fileUUID=` : '');
  console.log('Checking Playwright trace inspection readiness...');
  console.log(`  ${INFO} Playwright Viewer URL: ${viewerUrl}`);
  if (tracefileBase) {
    console.log(`  ${PASS} Tracefile Base URL:   ${tracefileBase}`);
  } else {
    console.log(`  ${NOTICE} Tracefile Base URL not configured; will fall back dynamically to mta_base_url.`);
  }
}

function checkDocumentationSettings() {
  const docUrl = config.documentation_url || 'https://documentation.menditect.com';
  const llmsUrl = config.llms_txt_url || `${docUrl.replace(/\/$/, '')}/llms.txt`;
  console.log('Checking Menditect Documentation (llms.txt) configuration...');
  console.log(`  ${INFO} Documentation URL : ${docUrl}`);
  console.log(`  ${PASS} LLMs.txt Endpoint : ${llmsUrl}`);
}

function verifyMode(mode) {
  return new Promise((resolve) => {
    console.log(`Verifying ${mode} MCP server...`);
    if (mode === 'plugin') {
      console.log(`  ${INFO} Note: Make sure your app under test is running in Studio Pro to verify the Plugin MCP connection.`);
    }
    checkTokenPreflight(mode);

    if (mode === 'mta') {
      const hasToken = process.env.MTA_MCP_AUTH_HEADER || (process.env.MTA_MCP_TOKEN ? `Bearer ${process.env.MTA_MCP_TOKEN}` : null) || (config.mta_auth_header && config.mta_auth_header.trim());
      if (!hasToken) {
        console.log(`  ${NOTICE} Identification token for a service account is not configured (optional for free exploratory testing).`);
        console.log('           Cloud MTA MCP authoring tools are inactive. Local exploratory testing is enabled via Plugin MCP.');
        resolve({ success: true, offline: true, message: 'No MTA token configured; exploratory mode' });
        return;
      }
    }

    const proc = spawn('node', [proxyPath, mode], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, MCP_VERIFY_MODE: 'true' }
    });
    
    let responseData = '';
    const timeoutMs = mode === 'mta' ? 25000 : 8000;
    let timeout = setTimeout(() => {
      console.error(`Timeout waiting for ${mode} MCP server (${timeoutMs / 1000}s elapsed).`);
      if (mode === 'mta') {
        console.error(`  ${TIP} Check internet connectivity to your MTA cloud instance and ensure`);
        console.error('        MTA_MCP_AUTH_HEADER in .env contains a valid identification token for a service account.');
      }
      proc.kill();
      resolve({ success: false, offline: false, message: `Timeout waiting for ${mode} MCP server` });
    }, timeoutMs);
    
    function evaluateResponseObject(res) {
      if (!res) return false;
      if (res.id === 1 && res.result && res.result.tools) {
        clearTimeout(timeout);
        console.log(`  ${PASS} ${mode} MCP Server is responding correctly (${res.result.tools.length} tools found).`);
        proc.kill();
        resolve({ success: true, offline: false, count: res.result.tools.length });
        return true;
      } else if (res.error) {
        clearTimeout(timeout);
        const errMsg = res.error.message || '';
        const isOffline = errMsg.includes('offline') || errMsg.includes('ECONNREFUSED') || errMsg.includes('restarting');
        const isMtaAuthError = mode === 'mta' && (errMsg.includes('MCP_server_authorize_user') || errMsg.includes('substring($TokenWithPrefix') || errMsg.includes('Authentication failed') || errMsg.includes('401') || errMsg.includes('403'));

        if (mode === 'plugin' && isOffline) {
          console.log(`  ${NOTICE} Plugin MCP Server is offline (Mendix app is not running locally).`);
          console.log(`           Local test execution will be available when your app is running in Studio Pro.`);
          proc.kill();
          resolve({ success: true, offline: true, message: errMsg });
        } else if (mode === 'studiopro' && isOffline) {
          console.warn(`  ${WARN} Studio Pro MCP is offline (Studio Pro is not running on port 7782).`);
          proc.kill();
          resolve({ success: false, offline: true, message: errMsg });
        } else if (isMtaAuthError) {
          console.error(`  ${FAIL} MTA MCP Server Authentication Error:`);
          console.error(`         The MTA server rejected the identification token for a service account.`);
          console.error(`         - If you have an MTA Service Account token, verify MTA_MCP_AUTH_HEADER in .env.`);
          console.error(`         - If you do not have an MTA license/token, leave MTA_MCP_AUTH_HEADER empty in .env to use free exploratory testing.`);
          proc.kill();
          resolve({ success: false, offline: false, message: errMsg });
        } else {
          console.error(`  ${FAIL} ${mode} MCP Server returned an error:`, errMsg);
          proc.kill();
          resolve({ success: false, offline: false, message: errMsg });
        }
        return true;
      }
      return false;
    }

    proc.stdout.on('data', (data) => {
      responseData += data.toString();
      if (responseData.includes('jsonrpc')) {
        try {
          const fullObj = JSON.parse(responseData.trim());
          if (evaluateResponseObject(fullObj)) return;
        } catch (e) {}

        const lines = responseData.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const res = JSON.parse(line.trim());
            if (evaluateResponseObject(res)) return;
          } catch (e) {}
        }
      }
    });
    
    proc.on('close', () => {
      clearTimeout(timeout);
      resolve({ success: false, offline: false, message: 'Process closed unexpectedly' });
    });

    const request = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {}
    });
    
    proc.stdin.write(request + '\n');
  });
}

async function run() {
  console.log(`--- Menditect Workspace Verification${scriptVersion} ---\n`);
  const wsType = config.workspace_type || 'clone_root';
  const wsDir = config.workspace_dir || path.join(__dirname, '..');
  const skillsDir = config.skills_dir || path.join(wsDir, 'skills');
  console.log(`Workspace Type:     ${wsType}`);
  console.log(`Workspace Dir:      ${wsDir}`);
  console.log(`Skills Destination: ${skillsDir}\n`);

  console.log('Checking configuration schema compliance...');
  if (!activeConfigPath) {
    console.warn(`${WARN} No mta_config.json found! Run "npm run setup" to initialize your workspace configuration.`);
  } else {
    const schemaResult = validateConfigAgainstSchema(rawConfig);
    if (schemaResult.valid) {
      console.log(`${PASS} mta_config.json complies with mta_config.schema.json (${activeConfigPath}).`);
    } else {
      console.warn(`${WARN} mta_config.json (${activeConfigPath}) has schema validation warnings:`);
      schemaResult.errors.forEach(err => console.warn(`  - ${err}`));
    }
  }
  checkSchemaContractAlignment();
  console.log();

  checkSkillsPresence();
  console.log();

  console.log('Checking model tooling readiness...');
  checkMxcliBinary();
  console.log();
  checkLinterTooling();
  console.log();

  checkSecurityHygiene();
  console.log();

  checkAgentDirectives();
  console.log();

  checkPublicBoundaryHygiene();
  console.log();

  checkAppInstances();
  console.log();

  checkPlaywrightTraceSettings();
  console.log();

  checkDocumentationSettings();
  console.log();

  const mtaResult = await verifyMode('mta');
  console.log();
  const pluginResult = await verifyMode('plugin');
  console.log();

  let spResult = { success: true };
  if (config.model_source === 'studiopro') {
    spResult = await verifyMode('studiopro');
    console.log();
  }
  
  if (mtaResult.success && pluginResult.success && spResult.success) {
    console.log(`${colors.green}${colors.bold}Verification Complete.${colors.reset} Workspace configuration and required MCP services are verified.`);
  } else {
    console.log(`${colors.red}${colors.bold}Verification Failed.${colors.reset} Please check the errors above and ensure your .env credentials are valid.`);
  }
}

run();
