const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync, spawn } = require('child_process');

let rl = null;

function getReadline() {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }
  return rl;
}

const toolsRootDir = path.join(__dirname, '..');
let scriptVersion = '';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(toolsRootDir, 'package.json'), 'utf8'));
  if (pkg.version) scriptVersion = ` (v${pkg.version})`;
} catch (e) {}

const BACK_ACTION = '__MTA_BACK__';

function isBack(val) {
  return val === BACK_ACTION;
}

function ask(question, defaultVal, options = {}) {
  const allowBack = options.allowBack !== false;
  return new Promise(resolve => {
    const activeRl = getReadline();
    if (activeRl.closed) {
      return resolve(defaultVal !== undefined ? String(defaultVal) : '');
    }
    const hasDefault = defaultVal !== undefined && defaultVal !== '';
    let promptStr;
    if (allowBack) {
      promptStr = hasDefault
        ? `${question} [${defaultVal}] (Press Enter to accept, or 'b' to go back): `
        : `${question} (or 'b' to go back): `;
    } else {
      promptStr = hasDefault
        ? `${question} [${defaultVal}] (Press Enter to accept): `
        : `${question}: `;
    }
    activeRl.question(promptStr, answer => {
      const trimmed = answer.trim();
      if (allowBack && (trimmed.toLowerCase() === 'b' || trimmed.toLowerCase() === 'back')) {
        console.log('  ◀ Going back to previous question...\n');
        return resolve(BACK_ACTION);
      }
      const chosen = trimmed || (hasDefault ? String(defaultVal) : '');
      if (!trimmed && hasDefault) {
        console.log(`  -> Selected: ${chosen}`);
      }
      resolve(chosen);
    });
  });
}

function normalizeConfigAliases(cfg) {
  if (!cfg || typeof cfg !== 'object') return {};
  const normalized = { ...cfg };
  normalized.mendix_mpr_path = cfg.mendix_mpr_path || cfg.mpr_path || cfg.mprPath || '';
  normalized.mendix_project_dir = cfg.mendix_project_dir || cfg.project_dir || cfg.projectDir || '';
  normalized.mta_base_url = cfg.mta_base_url || cfg.mta_url || cfg.mtaUrl || '';
  normalized.default_app_instance_token = cfg.default_app_instance_token || (cfg.app_instances && cfg.app_instances[0]?.token) || cfg.instance_token || '';
  normalized.execution_plans_dir = cfg.execution_plans_dir || (cfg.mta_output_path ? path.join(cfg.mta_output_path, 'execution-plans') : '');
  normalized.playwright_viewer_url = cfg.playwright_viewer_url || cfg.playwrightViewerUrl || '';
  normalized.tracefile_base_url = cfg.tracefile_base_url || cfg.tracefileBaseUrl || cfg.tracefile_url || '';
  normalized.studiopro_mcp_url = cfg.studiopro_mcp_url || cfg.studioproMcpUrl || cfg.studio_pro_mcp_url || '';
  return normalized;
}

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

function ensureGitIgnoreEntries(dirPath, entries) {
  const gitIgnorePath = path.join(dirPath, '.gitignore');
  let currentContent = '';
  if (fs.existsSync(gitIgnorePath)) {
    try {
      currentContent = fs.readFileSync(gitIgnorePath, 'utf8');
    } catch (e) {
      return;
    }
  }

  const linesToAdd = entries.filter(entry => {
    const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|\\r?\\n)${escaped}(\\r?\\n|$)`);
    return !regex.test(currentContent);
  });

  if (linesToAdd.length > 0) {
    const header = currentContent.trimEnd() ? '\n\n# Menditect Agent local environment & secrets\n' : '# Menditect Agent local environment & secrets\n';
    const updated = currentContent.trimEnd() + header + linesToAdd.join('\n') + '\n';
    try {
      fs.writeFileSync(gitIgnorePath, updated, 'utf8');
      console.log(`Protected ${path.relative(process.cwd(), gitIgnorePath) || '.gitignore'}: added [${linesToAdd.join(', ')}]`);
    } catch (e) {
      console.warn(`Warning: Could not update ${gitIgnorePath}: ${e.message}`);
    }
  }
}

// Pre-load ambient secrets from tools root if available
loadEnvFile(path.join(toolsRootDir, '.env.local'));
loadEnvFile(path.join(toolsRootDir, '.env'));

function findMpr(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() && e.name.endsWith('.mpr')) {
        return path.join(dir, e.name);
      }
    }
    // check 1 level down
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) {
        const sub = path.join(dir, e.name);
        const subEntries = fs.readdirSync(sub, { withFileTypes: true });
        for (const se of subEntries) {
          if (!se.isDirectory() && se.name.endsWith('.mpr')) {
            return path.join(sub, se.name);
          }
        }
      }
    }
  } catch (e) {
    return null;
  }
  return null;
}

function detectMendixVersion(mprPath) {
  if (!mprPath || !fs.existsSync(mprPath)) return null;
  try {
    const buf = fs.readFileSync(mprPath);
    const str = buf.toString('latin1', 0, Math.min(buf.length, 1024 * 512));
    const match = str.match(/\b(1[0-2]\.\d+(?:\.\d+)?)\b/);
    if (match) return match[1];
  } catch (e) {}
  return null;
}

function isVersion1112OrHigher(versionStr) {
  if (!versionStr) return false;
  const parts = versionStr.split('.').map(n => parseInt(n, 10));
  const major = parts[0] || 0;
  const minor = parts[1] || 0;
  if (major > 11) return true;
  if (major === 11 && minor >= 12) return true;
  return false;
}

function formatAuthHeader(token) {
  if (!token) return '';
  let cleanToken = token.trim();
  if (/^bearer\s+/i.test(cleanToken)) {
    cleanToken = cleanToken.replace(/^bearer\s+/i, '');
  }
  return `Bearer ${cleanToken}`;
}

function formatBearerToken(token) {
  return formatAuthHeader(token);
}

function detectMendixModule(mendixDir) {
  const candidate = path.join(mendixDir, 'skillssource', '_modules', 'menditect_agentictestskills');
  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    return candidate;
  }
  return null;
}

function parseInstanceSelection(input, instances) {
  const trimmed = (input || '').trim().toLowerCase();
  if (!trimmed || trimmed === 'all' || trimmed === 'y' || trimmed === 'yes') {
    return { type: 'all', selected: instances };
  }
  if (trimmed === 'none' || trimmed === 'n' || trimmed === 'no') {
    return { type: 'none', selected: [] };
  }

  const tokens = trimmed.split(/[, ]+/).filter(Boolean);
  const selectedIndices = new Set();

  for (const token of tokens) {
    if (token.includes('-')) {
      const [startStr, endStr] = token.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end) && start <= end) {
        for (let idx = start; idx <= end; idx++) {
          if (idx >= 1 && idx <= instances.length) {
            selectedIndices.add(idx - 1);
          } else {
            return { type: 'invalid', selected: [] };
          }
        }
      } else {
        return { type: 'invalid', selected: [] };
      }
    } else {
      const idx = parseInt(token, 10);
      if (!isNaN(idx) && idx >= 1 && idx <= instances.length) {
        selectedIndices.add(idx - 1);
      } else {
        return { type: 'invalid', selected: [] };
      }
    }
  }

  if (selectedIndices.size === 0) {
    return { type: 'invalid', selected: [] };
  }

  const selected = Array.from(selectedIndices)
    .sort((a, b) => a - b)
    .map(i => instances[i]);

  return { type: 'subset', selected };
}

function findMxcliBinary(mprPath) {
  const candidates = [
    path.join(toolsRootDir, 'bin', process.platform === 'win32' ? 'mxcli.exe' : 'mxcli'),
    ...(mprPath ? [path.join(path.dirname(mprPath), 'bin', process.platform === 'win32' ? 'mxcli.exe' : 'mxcli')] : [])
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  try {
    execSync('mxcli --version', { stdio: 'ignore' });
    return 'mxcli';
  } catch (e) {
    return null;
  }
}

function initializeMxcli(targetDir, mprPath, optionalBin, options = {}) {
  if (!targetDir || !fs.existsSync(targetDir)) return false;

  const mxcliBin = optionalBin || findMxcliBinary(mprPath);
  if (!mxcliBin) {
    console.log('[NOTICE] mxcli binary not found. Skipping mxcli init.');
    return false;
  }

  const aiContextDir = path.join(targetDir, '.ai-context');
  const dotMxcliDir = path.join(targetDir, '.mxcli');
  const agentsPath = path.join(targetDir, 'AGENTS.md');
  const claudePath = path.join(targetDir, 'CLAUDE.md');
  const isAlreadyInitialized = fs.existsSync(aiContextDir);

  // Preserve pre-existing custom headers (e.g. Orchestrator instructions) so mxcli init does not discard them
  let savedCustomAgentsHeader = '';
  let savedCustomClaudeHeader = '';
  if (!isAlreadyInitialized || options.forceFull) {
    if (fs.existsSync(agentsPath)) {
      const existing = fs.readFileSync(agentsPath, 'utf8');
      const cleaned = existing.replace(/# Menditect Architecture Setup[\s\S]*?(?=(?:\r?\n#[^#]|$))/, '').trim();
      if (cleaned && !cleaned.startsWith('# Mendix Project:')) {
        savedCustomAgentsHeader = cleaned;
      }
    }
    if (fs.existsSync(claudePath)) {
      const existing = fs.readFileSync(claudePath, 'utf8');
      const cleaned = existing.replace(/# Menditect Architecture Setup[\s\S]*?(?=(?:\r?\n#[^#]|$))/, '').trim();
      if (cleaned && !cleaned.startsWith('# Mendix Project:')) {
        savedCustomClaudeHeader = cleaned;
      }
    }
  }

  try {
    if (!isAlreadyInitialized || options.forceFull) {
      console.log(`\nInitializing Mendix AI scaffolding in ${targetDir}...`);
      execSync(`"${mxcliBin}" init "${targetDir}" --all-tools`, {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 45000
      });
      console.log(`[PASS] Initialized mxcli AI context and skills (.ai-context/skills/).`);

      // Restore saved custom headers if present
      if (savedCustomAgentsHeader && fs.existsSync(agentsPath)) {
        const generated = fs.readFileSync(agentsPath, 'utf8');
        if (!generated.includes(savedCustomAgentsHeader)) {
          fs.writeFileSync(agentsPath, savedCustomAgentsHeader + '\n\n' + generated, 'utf8');
        }
      }
      if (savedCustomClaudeHeader && fs.existsSync(claudePath)) {
        const generated = fs.readFileSync(claudePath, 'utf8');
        if (!generated.includes(savedCustomClaudeHeader)) {
          fs.writeFileSync(claudePath, savedCustomClaudeHeader + '\n\n' + generated, 'utf8');
        }
      }

      // Initialize brain if .mpr is available and docs/brain does not exist
      if (mprPath && fs.existsSync(mprPath)) {
        const brainDir = path.join(targetDir, 'docs', 'brain');
        if (!fs.existsSync(brainDir)) {
          try {
            execSync(`"${mxcliBin}" brain init -p "${mprPath}"`, {
              stdio: ['ignore', 'ignore', 'ignore'],
              timeout: 15000
            });
            console.log(`[PASS] Initialized project brain architecture store (docs/brain/).`);
          } catch (e) {}
        }
      }
    } else {
      console.log(`\nRefreshing Mendix AI skills in ${targetDir}...`);
      execSync(`"${mxcliBin}" init "${targetDir}" --sync-skills`, {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 30000
      });
      console.log(`[PASS] Refreshed mxcli AI skills via --sync-skills.`);
    }

    // Ensure local operational working directory .mxcli exists
    if (!fs.existsSync(dotMxcliDir)) {
      fs.mkdirSync(dotMxcliDir, { recursive: true });
    }

    return true;
  } catch (err) {
    console.warn(`[WARN] Could not complete mxcli initialization in ${targetDir}: ${err.message}`);
    return false;
  }
}

async function buildProjectCatalog(mprPath, optionalBin, options = {}) {
  if (!mprPath || !fs.existsSync(mprPath)) return false;

  const mxcliBin = optionalBin || findMxcliBinary(mprPath);
  if (!mxcliBin) {
    console.log('[NOTICE] mxcli binary not found. Skipping catalog build.');
    return false;
  }

  const projectDir = path.dirname(mprPath);
  const dotMxcliDir = path.join(projectDir, '.mxcli');
  const catalogDbPath = path.join(dotMxcliDir, 'catalog.db');

  if (!fs.existsSync(dotMxcliDir)) {
    try { fs.mkdirSync(dotMxcliDir, { recursive: true }); } catch (e) {}
  }

  let choice = options.choice !== undefined ? options.choice : 'fast';
  if (options.choice === undefined) {
    console.log('\n--- Mendix Project Search Index (.mxcli/catalog.db) ---');
    console.log('mxcli can create a local SQLite database index of your Mendix app.');
    console.log('This enables the AI assistant to instantly search your domain model, microflows,');
    console.log('pages, and caller/callee dependencies offline without opening Studio Pro.');
    console.log('Documentation: https://www.mxcli.org/\n');
    console.log('Indexing options:');
    console.log('  [1] Fast (Recommended - seconds):');
    console.log('      Indexes all entities, attributes, microflow signatures, and page widgets.');
    console.log('      Fastest setup; covers over 90% of test generation and analysis tasks.');
    console.log('  [2] Full (Deep - 1 to 5+ minutes):');
    console.log('      Deeply indexes every activity, microflow expression, and full document source.');
    console.log('      (Can take longer on large projects with thousands of documents).');
    console.log('  [3] Skip (Do not index now):');
    console.log('      Skip index creation. You can generate it anytime later in the background via:');
    console.log('      ./mxcli -c "REFRESH CATALOG FULL FORCE;"\n');

    if (options.askFn) {
      const rawCatalogChoice = await options.askFn('Select indexing option: [1] Fast (recommended), [2] Full, [3] Skip', '1');
      const trimmed = (rawCatalogChoice || '1').trim().toLowerCase();
      if (trimmed === '2' || trimmed === 'full' || trimmed === 'deep' || trimmed === 'y' || trimmed === 'yes') {
        choice = 'full';
      } else if (trimmed === '3' || trimmed === 'skip' || trimmed === 'n' || trimmed === 'no' || trimmed === 'none') {
        choice = 'skip';
      } else {
        choice = 'fast';
      }
    }
  }

  const normalized = (choice || 'fast').toLowerCase();
  if (normalized === 'skip' || normalized === '3' || normalized.startsWith('n')) {
    console.log('[INFO] Catalog indexing skipped.');
    console.log('[INFO] You can build it anytime by running:');
    console.log('       ./mxcli -c "REFRESH CATALOG FULL FORCE;" (fast mode) or');
    console.log('       ./mxcli -c "REFRESH CATALOG SOURCE FORCE;" (full mode)');
    return false;
  }

  let commandToRun = 'REFRESH CATALOG FULL FORCE;';
  let modeName = 'structural metadata & activities (fast mode)';
  if (normalized === 'full' || normalized === '2' || normalized === 'deep' || normalized.startsWith('y')) {
    commandToRun = 'REFRESH CATALOG SOURCE FORCE;';
    modeName = 'full source definitions (deep extraction)';
  }

  console.log(`\nCompiling catalog in ${modeName}...`);
  console.log(`Executing: "${mxcliBin}" -p "${mprPath}" -c "${commandToRun}"\n`);

  return new Promise((resolve) => {
    const proc = spawn(mxcliBin, ['-p', mprPath, '-c', commandToRun], {
      stdio: 'inherit',
      shell: false
    });

    proc.on('close', (code) => {
      if (code === 0) {
        if (fs.existsSync(catalogDbPath)) {
          const stats = fs.statSync(catalogDbPath);
          const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
          console.log(`\n[PASS] Catalog compiled successfully (${sizeMb} MB) at ${catalogDbPath}`);
        } else {
          console.log('\n[PASS] Catalog refresh command completed.');
        }
        resolve(true);
      } else {
        console.warn(`\n[WARN] Catalog build exited with code ${code}.`);
        console.warn(`       You can retry manually via: ./mxcli -c "${commandToRun}"`);
        resolve(false);
      }
    });

    proc.on('error', (err) => {
      console.warn(`\n[WARN] Failed to spawn mxcli for catalog refresh: ${err.message}`);
      resolve(false);
    });
  });
}

async function getOrDownloadMxcli(mprPath) {
  let mxcliBin = findMxcliBinary(mprPath);
  if (!mxcliBin) {
    try {
      const { syncMxcli } = require('./sync-upstream');
      const downloaded = await syncMxcli();
      if (downloaded) {
        mxcliBin = findMxcliBinary(mprPath);
      }
    } catch (e) {}
  }
  return mxcliBin;
}

function inspectMendixMtaSettings(mprPath, optionalBin) {
  if (!mprPath || !fs.existsSync(mprPath)) return null;

  const mxcliBin = optionalBin || findMxcliBinary(mprPath);
  if (!mxcliBin) return null;

  try {
    const output = execSync(`"${mxcliBin}" describe settings Settings -p "${mprPath}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 25000
    });

    const configMap = new Map();

    // 1. Parse configuration blocks to capture HttpPortNumber / ApplicationRootUrl per configuration
    // Supports both 'create or modify configuration' and 'alter settings configuration'
    const configBlockRegex = /(?:create\s+or\s+modify|alter\s+settings)\s+configuration\s+'([^']+)'([\s\S]*?);/gi;
    let cMatch;
    while ((cMatch = configBlockRegex.exec(output)) !== null) {
      const cfgName = cMatch[1];
      const body = cMatch[2];
      let port = null;
      const portMatch = body.match(/HttpPortNumber\s*=\s*(\d+)/i);
      if (portMatch) {
        port = portMatch[1].trim();
      }

      let runtimeUrl = null;
      const rootUrlMatch = body.match(/ApplicationRootUrl\s*=\s*'([^']+)'/i);
      if (rootUrlMatch && rootUrlMatch[1] && rootUrlMatch[1].trim()) {
        runtimeUrl = rootUrlMatch[1].trim();
      } else if (port) {
        runtimeUrl = `http://localhost:${port}/`;
      }

      let pluginUrl = null;
      if (runtimeUrl) {
        pluginUrl = runtimeUrl.replace(/\/+$/, '') + '/plugin/mcp';
      }

      configMap.set(cfgName, {
        name: cfgName,
        token: '',
        mtaUrl: null,
        runtimeUrl,
        pluginUrl,
        pluginToken: null,
        pluginPort: port || '8081'
      });
    }

    // 2. Parse alter settings constant ... in configuration '...'
    const constRegex = /alter\s+settings\s+constant\s+'([^']+)'\s+value\s+'([^']*)'[\s\S]*?in\s+configuration\s+'([^']+)';/gi;
    let constMatch;
    while ((constMatch = constRegex.exec(output)) !== null) {
      const [_, constantName, rawVal, configName] = constMatch;
      const val = rawVal.trim();
      if (!configMap.has(configName)) {
        configMap.set(configName, {
          name: configName,
          token: '',
          mtaUrl: null,
          runtimeUrl: null,
          pluginUrl: null,
          pluginToken: null,
          pluginPort: '8081'
        });
      }
      const entry = configMap.get(configName);
      if (constantName.toLowerCase().includes('applicationinstancetoken') && val) {
        entry.token = val;
      } else if (constantName.toLowerCase().includes('mtaconnectionurl') && val) {
        entry.mtaUrl = val.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
      } else if (constantName.toLowerCase().includes('mcpserveraccesstoken') && val) {
        entry.pluginToken = formatBearerToken(val);
      }
    }

    // 3. Global fallbacks if not defined on a specific configuration
    let globalMtaUrl = null;
    const globalUrlMatch = output.match(/alter\s+settings\s+constant\s+'(?:[^']+\.)?MTAConnectionUrl'\s+value\s+'([^']*)'/i);
    if (globalUrlMatch && globalUrlMatch[1] && globalUrlMatch[1].trim()) {
      globalMtaUrl = globalUrlMatch[1].trim().replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
    }

    let globalPluginToken = null;
    const globalTokenMatch = output.match(/alter\s+settings\s+constant\s+'(?:[^']+\.)?McpServerAccessToken'\s+value\s+'([^']*)'/i);
    if (globalTokenMatch && globalTokenMatch[1] && globalTokenMatch[1].trim()) {
      globalPluginToken = formatBearerToken(globalTokenMatch[1].trim());
    }

    let globalPort = null;
    const globalPortMatch = output.match(/HttpPortNumber\s*=\s*(\d+)/i);
    if (globalPortMatch && globalPortMatch[1]) {
      globalPort = globalPortMatch[1].trim();
    }

    let globalRuntimeUrl = null;
    let globalPluginUrl = null;
    const globalRootUrlMatch = output.match(/ApplicationRootUrl\s*=\s*'([^']+)'/i);
    if (globalRootUrlMatch && globalRootUrlMatch[1] && globalRootUrlMatch[1].trim()) {
      globalRuntimeUrl = globalRootUrlMatch[1].trim();
      globalPluginUrl = globalRuntimeUrl.replace(/\/+$/, '') + '/plugin/mcp';
    }

    const instances = [];
    for (const entry of configMap.values()) {
      if (entry.token) {
        if (!entry.mtaUrl && globalMtaUrl) entry.mtaUrl = globalMtaUrl;
        if (!entry.pluginToken && globalPluginToken) entry.pluginToken = globalPluginToken;
        if (!entry.runtimeUrl && globalRuntimeUrl) entry.runtimeUrl = globalRuntimeUrl;
        if (!entry.pluginUrl && globalPluginUrl) entry.pluginUrl = globalPluginUrl;
        if (!entry.pluginPort && globalPort) entry.pluginPort = globalPort;
        instances.push(entry);
      }
    }

    return {
      instances,
      globalMtaUrl,
      globalPluginToken,
      globalRuntimeUrl,
      globalPluginUrl,
      globalPluginPort: globalPort
    };
  } catch (err) {
    return null;
  }
}

function mergeJsonFile(filePath, updater) {
  let existing = {};
  if (fs.existsSync(filePath)) {
    try {
      existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      existing = {};
    }
  }
  const updated = updater(existing);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf8');
}

function generateIdeConfigs(workspaceDir, mcpSource, projectDir, mprPath, mtaUrl, appName, mtaAuthHeader, pluginToken, defaultInstanceToken, pluginUrl, studioproMcpUrl) {
  const isToolsWorkspace = path.resolve(workspaceDir) === path.resolve(toolsRootDir);
  const isParentWorkspace = path.resolve(workspaceDir) === path.resolve(toolsRootDir, '..');
  const toolsDirName = path.basename(toolsRootDir);

  const proxyScriptPath = isToolsWorkspace
    ? '${workspaceFolder}/scripts/mta-proxy.js'
    : (isParentWorkspace
      ? `\${workspaceFolder}/${toolsDirName}/scripts/mta-proxy.js`
      : path.join(toolsRootDir, 'scripts', 'mta-proxy.js').replace(/\\/g, '/'));

  const mtaConfigEnvPath = isToolsWorkspace
    ? '${workspaceFolder}/mta_config.json'
    : (isParentWorkspace
      ? '${workspaceFolder}/mta_config.json'
      : path.join(workspaceDir, 'mta_config.json').replace(/\\/g, '/'));

  const newMcpServers = {
    "mta": {
      "command": "node",
      "args": [proxyScriptPath, "mta"],
      "env": {
        "MTA_CONFIG_PATH": mtaConfigEnvPath
      }
    },
    "mta_plugin": {
      "command": "node",
      "args": [proxyScriptPath, "plugin"],
      "env": {
        "MTA_CONFIG_PATH": mtaConfigEnvPath
      }
    }
  };

  if (mcpSource === 'studiopro') {
    newMcpServers['StudioPro'] = {
      "command": "node",
      "args": [proxyScriptPath, "studiopro"],
      "env": {
        "MTA_CONFIG_PATH": mtaConfigEnvPath
      }
    };
  }

  // 1. VS Code .vscode/mcp.json (merge servers)
  mergeJsonFile(path.join(workspaceDir, '.vscode', 'mcp.json'), (existing) => {
    return {
      ...existing,
      mcpServers: {
        ...(existing.mcpServers || {}),
        ...newMcpServers
      }
    };
  });

  // 2. VS Code .vscode/settings.json (merge terminal env vars, excluding sensitive tokens)
  const envVars = {
    "MENDIX_PROJECT_PATH": projectDir || "",
    "MENDIX_MPR_FILE": mprPath || "",
    "MENDIX_APP_NAME": appName || "",
    "MTA_BASE_URL": mtaUrl || "",
    "MTA_APP_INSTANCE_TOKEN": defaultInstanceToken || "",
    "MTA_OUTPUT_PATH": "${workspaceFolder}/menditect-output"
  };

  mergeJsonFile(path.join(workspaceDir, '.vscode', 'settings.json'), (existing) => {
    const cleanPlatformEnv = (orig) => {
      const merged = { ...(orig || {}), ...envVars };
      delete merged.MTA_MCP_AUTH_HEADER;
      delete merged.PLUGIN_MCP_TOKEN;
      return merged;
    };
    return {
      ...existing,
      "terminal.integrated.env.windows": cleanPlatformEnv(existing["terminal.integrated.env.windows"]),
      "terminal.integrated.env.linux": cleanPlatformEnv(existing["terminal.integrated.env.linux"]),
      "terminal.integrated.env.osx": cleanPlatformEnv(existing["terminal.integrated.env.osx"])
    };
  });

  // 3. Cursor .cursor/mcp.json (merge servers)
  mergeJsonFile(path.join(workspaceDir, '.cursor', 'mcp.json'), (existing) => {
    return {
      ...existing,
      mcpServers: {
        ...(existing.mcpServers || {}),
        ...newMcpServers
      }
    };
  });

  // 4. Claude .claude/settings.json (merge mcpServers while preserving permissions and other settings)
  mergeJsonFile(path.join(workspaceDir, '.claude', 'settings.json'), (existing) => {
    return {
      ...existing,
      mcpServers: {
        ...(existing.mcpServers || {}),
        ...newMcpServers
      }
    };
  });

  // 5. Global Antigravity mcp_config.json
  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  const antigravityConfigPaths = [
    path.join(homeDir, '.gemini', 'config', 'mcp_config.json'),
    path.join(homeDir, '.gemini', 'antigravity', 'mcp_config.json'),
    path.join(homeDir, '.gemini', 'antigravity-ide', 'mcp_config.json')
  ];

  const globalProxyPath = path.join(toolsRootDir, 'scripts', 'mta-proxy.js').replace(/\\/g, '/');
  const mtaEnv = {
    "MTA_CONFIG_PATH": path.join(workspaceDir, 'mta_config.json').replace(/\\/g, '/')
  };
  if (mtaAuthHeader) mtaEnv["MTA_MCP_AUTH_HEADER"] = mtaAuthHeader;

  const effectivePluginUrl = pluginUrl || 'http://localhost:8081/plugin/mcp';
  const pluginEnv = {
    "MTA_CONFIG_PATH": path.join(workspaceDir, 'mta_config.json').replace(/\\/g, '/'),
    "PLUGIN_MCP_URL": effectivePluginUrl,
    "PLUGIN_MCP_TOKEN": pluginToken || "Bearer 1"
  };

  const globalMcpServers = {
    "MTA": {
      "command": "node",
      "args": [globalProxyPath, "mta"],
      "env": mtaEnv
    },
    "MTA_plugin": {
      "command": "node",
      "args": [globalProxyPath, "plugin"],
      "env": pluginEnv
    }
  };

  if (mcpSource === 'studiopro') {
    globalMcpServers['StudioPro'] = {
      "command": "node",
      "args": [globalProxyPath, "studiopro"],
      "env": {
        "MTA_CONFIG_PATH": path.join(workspaceDir, 'mta_config.json').replace(/\\/g, '/')
      }
    };
  }

  for (const cfgPath of antigravityConfigPaths) {
    if (fs.existsSync(cfgPath) || cfgPath.includes(path.join('.gemini', 'config'))) {
      const dir = path.dirname(cfgPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      mergeJsonFile(cfgPath, (existing) => {
        return {
          ...existing,
          mcpServers: {
            ...(existing.mcpServers || {}),
            ...globalMcpServers
          }
        };
      });
      console.log(`Synchronized global Antigravity MCP configuration at ${cfgPath}`);
    }
  }

  // 6. Global Claude Desktop config if existing
  const claudeDesktopPath = process.platform === 'win32'
    ? path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json')
    : path.join(process.env.HOME || '', 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  if (fs.existsSync(claudeDesktopPath)) {
    const globalProxyPath = path.join(toolsRootDir, 'scripts', 'mta-proxy.js').replace(/\\/g, '/');
    const globalMcpServers = {
      "mta": {
        "command": "node",
        "args": [globalProxyPath, "mta"],
        "env": {
          "MTA_CONFIG_PATH": path.join(workspaceDir, 'mta_config.json').replace(/\\/g, '/')
        }
      },
      "mta_plugin": {
        "command": "node",
        "args": [globalProxyPath, "plugin"],
        "env": {
          "MTA_CONFIG_PATH": path.join(workspaceDir, 'mta_config.json').replace(/\\/g, '/')
        }
      }
    };

    if (mcpSource === 'studiopro') {
      globalMcpServers['StudioPro'] = {
        "command": "node",
        "args": [globalProxyPath, "studiopro"],
        "env": {
          "MTA_CONFIG_PATH": path.join(workspaceDir, 'mta_config.json').replace(/\\/g, '/')
        }
      };
    }

    mergeJsonFile(claudeDesktopPath, (existing) => {
      return {
        ...existing,
        mcpServers: {
          ...(existing.mcpServers || {}),
          ...globalMcpServers
        }
      };
    });
    console.log(`Synchronized global Claude Desktop configuration at ${claudeDesktopPath}`);
  }

  console.log(`Generated and merged IDE configurations in ${workspaceDir}`);
}

function deployMxcliWrappers(targetDir, mprPathOrName) {
  if (path.resolve(targetDir) === path.resolve(toolsRootDir)) return;

  const binDirInTools = path.join(toolsRootDir, 'bin').replace(/\\/g, '/');
  let mprArg = '';
  let mprArgSh = '';

  if (mprPathOrName) {
    const isFullPath = mprPathOrName.includes('/') || mprPathOrName.includes('\\');
    const isInsideTarget = isFullPath && path.resolve(targetDir) === path.resolve(path.dirname(mprPathOrName));
    const mprName = path.basename(mprPathOrName);

    if (!isFullPath || isInsideTarget) {
      mprArg = ` -p "%SCRIPT_DIR%${mprName}"`;
      mprArgSh = ` -p "$SCRIPT_DIR/${mprName}"`;
    } else {
      mprArg = ` -p "${mprPathOrName.replace(/\//g, '\\')}"`;
      mprArgSh = ` -p "${mprPathOrName.replace(/\\/g, '/')}"`;
    }
  }

  const batContent = `@echo off
set SCRIPT_DIR=%~dp0
set BIN_DIR=%SCRIPT_DIR%bin
if not exist "%BIN_DIR%\\mxcli.exe" (
    set BIN_DIR=${binDirInTools}
)
if not exist "%BIN_DIR%\\mxcli.exe" (
    echo [ERROR] mxcli binary not found. Please run "npm run update:mxcli" in ${toolsRootDir}.
    exit /b 1
)
"%BIN_DIR%\\mxcli.exe"${mprArg} %*
`;

  const shContent = `#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$SCRIPT_DIR/bin"
if [ ! -f "$BIN_DIR/mxcli" ]; then
    BIN_DIR="${binDirInTools}"
fi
if [ ! -f "$BIN_DIR/mxcli" ]; then
    echo "[ERROR] mxcli binary not found. Please run 'npm run update:mxcli' in ${toolsRootDir}."
    exit 1
fi
"$BIN_DIR/mxcli"${mprArgSh} "$@"
`;

  fs.writeFileSync(path.join(targetDir, 'mxcli.bat'), batContent, 'utf8');
  const shPath = path.join(targetDir, 'mxcli');
  fs.writeFileSync(shPath, shContent, 'utf8');
  try { fs.chmodSync(shPath, 0o755); } catch (e) {}

  // Deploy verify runners
  const verifyScriptInTools = path.join(toolsRootDir, 'scripts', 'verify-setup.js');
  const isParent = path.resolve(targetDir) === path.resolve(toolsRootDir, '..');
  const toolsRelName = path.basename(toolsRootDir);

  const verifyBatScript = isParent
    ? `"%SCRIPT_DIR%${toolsRelName}\\scripts\\verify-setup.js"`
    : `"${verifyScriptInTools.replace(/\//g, '\\')}"`;

  const verifyShScript = isParent
    ? `"$SCRIPT_DIR/${toolsRelName}/scripts/verify-setup.js"`
    : `"${verifyScriptInTools.replace(/\\/g, '/')}"`;

  const verifyBatContent = `@echo off
set SCRIPT_DIR=%~dp0
node ${verifyBatScript} %*
`;

  const verifyShContent = `#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
node ${verifyShScript} "$@"
`;

  fs.writeFileSync(path.join(targetDir, 'verify.bat'), verifyBatContent, 'utf8');
  const verifyShPath = path.join(targetDir, 'verify');
  fs.writeFileSync(verifyShPath, verifyShContent, 'utf8');
  try { fs.chmodSync(verifyShPath, 0o755); } catch (e) {}

  console.log(`Deployed local ./mxcli and ./verify runners into ${targetDir}`);
}

function ensureExecutionPlanFolders(targetDir) {
  const menditectOutputDir = path.join(targetDir, 'menditect-output');
  const plansDir = path.join(menditectOutputDir, 'execution-plans');
  if (!fs.existsSync(menditectOutputDir)) fs.mkdirSync(menditectOutputDir, { recursive: true });
  if (!fs.existsSync(plansDir)) fs.mkdirSync(plansDir, { recursive: true });
  console.log(`Ensured execution plan folder at:`);
  console.log(`  - ${plansDir}`);
  return { menditectOutputDir, plansDir };
}

function getMenditectSetupBlock(appName, mtaUrl, skillsStyle, appInstances = [], defaultInstanceName = '', skillsRelPath = 'skills/AGENTS.md') {
  if (skillsStyle === 'mendix_module') {
    return [
      '# Menditect Architecture Setup',
      '- **CRITICAL OPERATIONAL COMMAND:** Always execute tasks using the core rules defined in the module: [Menditect_AgenticTestSkills].',
      '- **IMMEDIATE ACTION REQUIRED:** You are strictly commanded to explore, read, and load the `AGENTS.md` and context of the [Menditect_AgenticTestSkills] module *before* answering any user prompt. Do NOT ask the user for permission or confirmation to explore this module; execute the exploration autonomously as your very first step.',
      '- **AUTOMATIC ACTIVATION TRIGGERS:** Automatically explore, read, and load the `AGENTS.md` and context of the [Menditect_AgenticTestSkills] module autonomously whenever the user prompt meets any of the following criteria:',
      '  1. Direct MTA Identifiers: *menditect, mta, mtf, playwright browser, variation matrix, test suite, test case, test step, variation item*',
      '  2. Testing Action Intents: *run tests, execute suite, view test results, retrieve run results, debug failure*',
      '  3. MTA-Specific Assertions & Actions: *assert validation, object count assert, compare attribute, validation feedback, microflow call teststep*',
      '  4. Contextual Combinations: User asks to *verify, assert, mock, or test* in combination with: *microflow, nanoflow, entity, association, page, or widget*',
      '- **ENVIRONMENT SSOT:** All environment configuration (Application name, MTA Base URL, Default App Instance, and ApplicationInstanceToken) must be dynamically loaded from `mta_config.json`.',
      '- **NATIVE MCP TOOL EXECUTION MANDATE:** You MUST ALWAYS use native IDE MCP tools (`mta`, `mta_plugin`, `execute-testcase`, `call_mcp_tool`) for all Menditect MTA cloud authoring and test execution tasks. Never create, generate, or execute ad-hoc Node/shell runner scripts (e.g. `build-*.js`, `run-*.js`, CLI bridges) or manual HTTP/curl calls to interact with MTA.',
      '- **MCP SUBPROCESS PROTECTION & TOKEN ROTATION:** NEVER execute terminal commands (`Stop-Process`, `taskkill`, `kill`) against running MCP server/proxy processes (`mta-proxy.js`, `node.exe`, or custom proxies). Terminating stdio child processes causes AI IDEs (Antigravity, Cursor, Claude Desktop, VS Code) to permanently disable MCP servers for the active session. The built-in proxy reloads `.env` dynamically on every request with zero restart needed. If using a static or custom proxy that returns HTTP 401, prompt the user to update their credentials and use their IDE\'s "Restart MCP Server" / "Reload Window" UI action.'
    ].join('\n');
  }

  return [
    '# Menditect Architecture Setup',
    `- **CRITICAL OPERATIONAL COMMAND:** Always execute tasks using the core rules defined in \`${skillsRelPath}\`.`,
    '- **ENVIRONMENT SSOT:** All environment configuration (Application name, MTA Base URL, Default App Instance, and ApplicationInstanceToken) must be dynamically loaded from `mta_config.json`.',
    '- **NATIVE MCP TOOL EXECUTION MANDATE:** You MUST ALWAYS use native IDE MCP tools (`mta`, `mta_plugin`, `execute-testcase`, `call_mcp_tool`) for all Menditect MTA cloud authoring and test execution tasks. Never create, generate, or execute ad-hoc Node/shell runner scripts (e.g. `build-*.js`, `run-*.js`, CLI bridges) or manual HTTP/curl calls to interact with MTA.',
    '- **MCP SUBPROCESS PROTECTION & TOKEN ROTATION:** NEVER execute terminal commands (`Stop-Process`, `taskkill`, `kill`) against running MCP server/proxy processes (`mta-proxy.js`, `node.exe`, or custom proxies). Terminating stdio child processes causes AI IDEs (Antigravity, Cursor, Claude Desktop, VS Code) to permanently disable MCP servers for the active session. The built-in proxy reloads `.env` dynamically on every request with zero restart needed. If using a static or custom proxy that returns HTTP 401, prompt the user to update their credentials and use their IDE\'s "Restart MCP Server" / "Reload Window" UI action.'
  ].join('\n');
}

function updateDirectiveFile(filePath, appName, mtaUrl, skillsStyle, appInstances, defaultInstanceName, skillsRelPath = 'skills/AGENTS.md') {
  let content = '';
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf8');
  } else {
    // Seed from toolsRootDir template if available
    const baseFile = path.join(toolsRootDir, path.basename(filePath));
    if (fs.existsSync(baseFile)) {
      content = fs.readFileSync(baseFile, 'utf8');
    }
  }

  if (skillsRelPath === 'skills/AGENTS.md') {
    content = content.replace(/[a-zA-Z0-9_\-\.]+\/skills\/AGENTS\.md/g, 'skills/AGENTS.md');
    content = content.replace(/`[a-zA-Z0-9_\-\.]+\/skills\/`/g, '`skills/`');
    content = content.replace(/in the `[a-zA-Z0-9_\-\.]+\/skills\/` directory/g, 'in the `skills/` directory');
  } else {
    content = content.replace(/skills\/AGENTS\.md/g, skillsRelPath);
    const skillsDirRel = path.dirname(skillsRelPath);
    content = content.replace(/`skills\/`/g, `\`${skillsDirRel}/\``);
  }

  const setupBlock = getMenditectSetupBlock(appName, mtaUrl, skillsStyle, appInstances, defaultInstanceName, skillsRelPath);

  const headerRegex = /# Menditect Architecture Setup[\s\S]*?(?=(?:\r?\n#[^#]|$))/;
  if (headerRegex.test(content)) {
    content = content.replace(headerRegex, setupBlock + '\n');
  } else {
    content = content.trimEnd() ? (content.trimEnd() + '\n\n' + setupBlock + '\n') : (setupBlock + '\n');
  }

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function updateAgentDirectives(targetDir, appName, mtaUrl, skillsStyle, appInstances, defaultInstanceName, skillsDir) {
  const targetFiles = [
    path.join(targetDir, 'AGENTS.md'),
    path.join(targetDir, 'CLAUDE.md'),
    path.join(targetDir, 'GEMINI.md'),
    path.join(targetDir, '.github', 'copilot-instructions.md')
  ];

  let skillsRelPath = 'skills/AGENTS.md';
  if (skillsDir) {
    const rel = path.relative(targetDir, skillsDir).replace(/\\/g, '/');
    skillsRelPath = rel ? `${rel}/AGENTS.md` : 'skills/AGENTS.md';
  }

  for (const file of targetFiles) {
    updateDirectiveFile(file, appName, mtaUrl, skillsStyle, appInstances, defaultInstanceName, skillsRelPath);
  }
  console.log(`Configured Menditect Architecture Setup in ${targetDir}`);
}

async function run(options = {}) {
  const skipSkills = options.skipSkills || process.argv.includes('--skip-skills') || process.argv.includes('--no-skills') || process.argv.includes('--skip-skills-sync');
  console.log('======================================================');
  console.log(` Menditect Agent Workspace Setup${scriptVersion}`);
  console.log('======================================================\n');

  console.log('NOTICE AND DISCLAIMER:');
  console.log('------------------------------------------------------');
  console.log('This project and setup tooling have been vibe-coded with');
  console.log('AI coding assistants and are provided strictly "AS IS".');
  console.log('Menditect B.V. provides NO official support, SLAs, or guarantees');
  console.log('if anything fails to work as expected, and accepts NO liability');
  console.log('for any damages, corrupted files, data loss, or unintended actions');
  console.log('(as governed by the Apache License 2.0).');
  console.log('');
  console.log('Safety precautions:');
  console.log('- Always ensure your Mendix project is committed to Git before continuing.');
  console.log('- Do not run tools against projects actively open in Studio Pro.');
  console.log('------------------------------------------------------\n');

  const acknowledge = await ask('Do you acknowledge and accept these terms to continue? (y/n)', 'y', { allowBack: false });
  if (!acknowledge.toLowerCase().startsWith('y')) {
    console.log('\nSetup aborted by user. Exiting without modifying any files.');
    process.exit(0);
  }
  console.log('');

  let existingConfig = {};
  try {
    const existingConfigPath = path.join(toolsRootDir, 'mta_config.json');
    if (fs.existsSync(existingConfigPath)) {
      existingConfig = normalizeConfigAliases(JSON.parse(fs.readFileSync(existingConfigPath, 'utf8')));
    }
  } catch (e) {}

  console.log('======================================================');
  console.log(' NAVIGATION TIPS:');
  console.log(' • Press [Enter] to accept the detected [default value in brackets]');
  console.log(" • Type 'b' or 'back' at any question to return to the previous step");
  console.log(' • You can review and edit all answers before any files are saved');
  console.log('======================================================\n');

  const defaultMpr = existingConfig.mendix_mpr_path || '';
  const defaultDetectedVersion = defaultMpr ? detectMendixVersion(defaultMpr) : '';

  const state = {
    workspaceChoice: existingConfig.workspace_type === 'mendix_project' ? '2' : '1',
    projectDir: existingConfig.mendix_project_dir || '',
    mprPath: defaultMpr,
    detectedVersion: defaultDetectedVersion,
    isMendix1112Plus: defaultDetectedVersion ? isVersion1112OrHigher(defaultDetectedVersion) : false,
    modelSource: existingConfig.model_source === 'studiopro' ? '2' : '1',
    studioproMcpUrl: existingConfig.studiopro_mcp_url || process.env.STUDIOPRO_MCP_URL || 'http://localhost:7782/mcp',
    catalogChoice: 'fast',
    discoveredMta: null,
    appInstances: existingConfig.app_instances ? [...existingConfig.app_instances] : [],
    defaultInstanceName: existingConfig.default_app_instance || '',
    defaultInstanceToken: existingConfig.default_app_instance_token || '',
    activeConfig: null,
    hasInstancesManual: 'n',
    appName: existingConfig.application_name || '',
    mtaUrl: existingConfig.mta_base_url || '',
    rawMtaToken: process.env.MTA_MCP_AUTH_HEADER || existingConfig.mta_auth_header || '',
    pluginUrl: existingConfig.plugin_mcp_url || '',
    rawPluginToken: process.env.PLUGIN_MCP_TOKEN || existingConfig.plugin_mcp_token || ''
  };

  let currentStep = 'workspace';
  const stepHistory = [];
  let editingSingleSetting = null;

  while (currentStep !== 'DONE') {
    let nextStep = null;
    let goBack = false;

    if (currentStep === 'workspace') {
      console.log('\n--- Workspace Structure ---');
      console.log('Choose how you want to structure your Agentic Testing Workspace:');
      console.log('(The workspace is the dedicated project environment where your AI agent operates with skills, MCP tools, and test plans)\n');
      console.log('[1] Dedicated Tools Workspace (Recommended)');
      console.log('    ★ ADVANTAGE: Keeps your Mendix project Git 100% clean and untouched.');
      console.log('    - Active Workspace: Parent directory (workspace/)');
      console.log('    - How It Works: Test execution plans, agent directives, and local tooling configs');
      console.log('      stay isolated in your workspace without modifying your Mendix repository.');
      console.log('    - Best For: Individual developers, multi-app setups, or testing without polluting');
      console.log('      Mendix project git history.\n');
      console.log('[2] Direct Mendix Project Workspace');
      console.log('    ★ ADVANTAGE: Team collaboration — test skills and agent configs are committed');
      console.log('      directly into your Mendix repository and shared with your team via Git.');
      console.log('    - Active Workspace: Your local Mendix project directory');
      console.log('    - How It Works: Agent directives and test skills reside directly inside the Mendix app.');
      console.log('    - Best For: Teams collaborating on automated testing within the same Mendix repository.\n');

      let ans = '';
      while (ans !== '1' && ans !== '2' && !isBack(ans)) {
        ans = await ask('Select Workspace Option (1/2)', state.workspaceChoice);
      }
      if (isBack(ans)) {
        goBack = true;
      } else {
        state.workspaceChoice = ans;
        nextStep = 'project_dir';
      }
    } else if (currentStep === 'project_dir') {
      console.log('\n--- Mendix Project Location ---');
      const defaultDir = state.projectDir || existingConfig.mendix_project_dir || '';
      const ans = await ask('Local Mendix App to test (project folder containing .mpr)', defaultDir);
      if (isBack(ans)) {
        goBack = true;
      } else {
        state.projectDir = ans;
        state.mprPath = '';
        const found = findMpr(state.projectDir);
        if (found) {
          console.log(`Found Mendix .mpr file: ${found}`);
          state.mprPath = found;
          state.detectedVersion = detectMendixVersion(found);
          if (state.detectedVersion) {
            console.log(`Detected Mendix Studio Pro version: ${state.detectedVersion}`);
            state.isMendix1112Plus = isVersion1112OrHigher(state.detectedVersion);
            if (!state.isMendix1112Plus) {
              console.log(`Note: Mendix ${state.detectedVersion} is below 11.12. Module-level skills require Mendix 11.12 or higher.`);
            }
          }
          if (state.mprPath) {
            const mxcliBin = await getOrDownloadMxcli(state.mprPath);
            if (mxcliBin) {
              process.stdout.write('Checking Mendix project for configured MTA settings via mxcli... ');
              state.discoveredMta = inspectMendixMtaSettings(state.mprPath, mxcliBin);
              if (state.discoveredMta && state.discoveredMta.instances && state.discoveredMta.instances.length > 0) {
                console.log('done.');
              } else {
                console.log('none found.');
              }
            }
          }
        } else {
          console.log('Warning: No .mpr file found in directory.');
        }

        if (state.workspaceChoice === '2' && !state.detectedVersion) {
          nextStep = 'version_check';
        } else {
          nextStep = 'model_source';
        }
      }
    } else if (currentStep === 'version_check') {
      const ans = await ask('Is this project running Mendix 11.12 or higher? (Module-level skills require 11.12+) (y/n)', state.isMendix1112Plus ? 'y' : 'n');
      if (isBack(ans)) {
        goBack = true;
      } else {
        state.isMendix1112Plus = ans.toLowerCase().startsWith('y');
        nextStep = 'model_source';
      }
    } else if (currentStep === 'model_source') {
      console.log('\n--- Model Inspection Source (AI Assistant) ---');
      console.log('Choose how the AI assistant inspects your Mendix model inside your IDE:\n');
      console.log('  [1] mxcli (Recommended / Standalone):');
      console.log('      Reads your .mpr file directly from disk. Fast, works offline, and does NOT');
      console.log('      require Mendix Studio Pro to be open. Best for headless agents and CI/CD.');
      console.log('      (Documentation: https://www.mxcli.org/)');
      console.log('  [2] Studio Pro MCP (Live IDE):');
      console.log('      Connects live to an open Studio Pro session (port 7782, requires Mendix 11.12+).');
      console.log('      Enables the AI to inspect live in-memory changes while you work in Studio Pro.\n');

      let ans = '';
      while (ans !== '1' && ans !== '2' && !isBack(ans)) {
        ans = await ask('Select Model Source: [1] mxcli (recommended), [2] Studio Pro MCP', state.modelSource);
        if (ans === '2' && state.detectedVersion && !state.isMendix1112Plus) {
          console.log(`\n[WARNING] Studio Pro MCP requires Mendix 11.12 or higher (detected version: ${state.detectedVersion}).`);
        }
      }
      if (isBack(ans)) {
        goBack = true;
      } else {
        state.modelSource = ans;
        if (state.modelSource === '2') {
          nextStep = 'studiopro_url';
        } else if (state.mprPath && fs.existsSync(state.mprPath)) {
          nextStep = 'catalog_index';
        } else {
          nextStep = 'mta_instances';
        }
      }
    } else if (currentStep === 'studiopro_url') {
      const defaultStudioUrl = state.studioproMcpUrl || existingConfig.studiopro_mcp_url || process.env.STUDIOPRO_MCP_URL || 'http://localhost:7782/mcp';
      const ans = await ask('Studio Pro MCP URL (port configured in Studio Pro Preferences)', defaultStudioUrl);
      if (isBack(ans)) {
        goBack = true;
      } else {
        state.studioproMcpUrl = ans;
        console.log('\n┌──────────────────────────────────────────────────────────────────────────┐');
        console.log('│ ACTION REQUIRED IN MENDIX STUDIO PRO:                                    │');
        console.log('│ 1. Open this project in Mendix Studio Pro (version 11.12+ required).     │');
        console.log('│ 2. In Studio Pro, go to Edit > Preferences and enable the MCP Server.    │');
        console.log(`│ 3. Confirm the port/URL matches: ${(state.studioproMcpUrl || 'http://localhost:7782/mcp').padEnd(39)} │`);
        console.log('│ 4. Keep Studio Pro running with this project while using your AI agent.  │');
        console.log('└──────────────────────────────────────────────────────────────────────────┘\n');
        console.log('[INFO] Studio Pro MCP configured for your IDE AI assistant.');
        console.log('[INFO] Note: The setup wizard will continue using mxcli in the background to inspect');
        console.log('       project configurations, discover MTA settings, and prepare workspace scaffolding.');
        state.catalogChoice = 'skip';
        nextStep = 'mta_instances';
      }
    } else if (currentStep === 'catalog_index') {
      console.log('\n--- Mendix Project Search Index (.mxcli/catalog.db) ---');
      console.log('mxcli can create an optional local SQLite database index of your Mendix app.');
      console.log('This enables the AI assistant to instantly search your domain model, microflows,');
      console.log('pages, and caller/callee dependencies offline without opening Studio Pro.');
      console.log('Documentation: https://www.mxcli.org/\n');
      console.log('Indexing options:');
      console.log('  [1] Fast (Recommended - seconds):');
      console.log('      Indexes all entities, attributes, microflow signatures, and page widgets.');
      console.log('      Fastest setup; covers over 90% of test generation and analysis tasks.');
      console.log('  [2] Full (Deep - 1 to 5+ minutes):');
      console.log('      Deeply indexes every activity, microflow expression, and full document source.');
      console.log('      (Can take longer on large projects with thousands of documents).');
      console.log('  [3] Skip (Do not index now):');
      console.log('      Skip index creation. You can generate it anytime later in the background via:');
      console.log('      ./mxcli -c "REFRESH CATALOG FULL FORCE;"\n');

      const defaultOpt = state.catalogChoice === 'full' ? '2' : (state.catalogChoice === 'skip' ? '3' : '1');
      const ans = await ask('Select indexing option: [1] Fast (recommended), [2] Full, [3] Skip', defaultOpt);
      if (isBack(ans)) {
        goBack = true;
      } else {
        const trimmed = (ans || '1').trim().toLowerCase();
        if (trimmed === '2' || trimmed === 'full' || trimmed === 'deep' || trimmed === 'y' || trimmed === 'yes') {
          state.catalogChoice = 'full';
        } else if (trimmed === '3' || trimmed === 'skip' || trimmed === 'n' || trimmed === 'no' || trimmed === 'none') {
          state.catalogChoice = 'skip';
        } else {
          state.catalogChoice = 'fast';
        }
        nextStep = 'mta_instances';
      }
    } else if (currentStep === 'mta_instances') {
      console.log('\n--- MTA Connection & Application Instances ---');
      let stepSubBack = false;

      if ((!state.discoveredMta || !state.discoveredMta.instances || state.discoveredMta.instances.length === 0) && state.mprPath) {
        const mxcliBin = await getOrDownloadMxcli(state.mprPath);
        if (mxcliBin) {
          state.discoveredMta = inspectMendixMtaSettings(state.mprPath, mxcliBin);
        }
      }

      if (state.discoveredMta && state.discoveredMta.instances && state.discoveredMta.instances.length > 0) {
        state.appInstances = state.discoveredMta.instances;
        console.log(`\n[FOUND] Discovered ${state.appInstances.length} App Instance Token(s) across Mendix project configurations:`);
        state.appInstances.forEach((inst, idx) => {
          const previewToken = inst.token.length > 12 ? `${inst.token.slice(0, 8)}...${inst.token.slice(-4)}` : inst.token;
          const urlInfo = inst.mtaUrl ? ` -> MTA: ${inst.mtaUrl}` : '';
          console.log(`  [${idx + 1}] ${inst.name.padEnd(25)} (Token: ${previewToken})${urlInfo}`);
        });

        if (state.appInstances.length === 1) {
          state.defaultInstanceName = state.appInstances[0].name;
          state.defaultInstanceToken = state.appInstances[0].token;
          state.activeConfig = state.appInstances[0];
          console.log(`\nDefault instance: [${state.defaultInstanceName}]`);
          console.log(`*(Note: The selected instance must be running and connected to MTA when you execute tests)*`);
        } else {
          let defaultIdx = 1;
          if (state.defaultInstanceName) {
            const foundIdx = state.appInstances.findIndex(x => x.name.toLowerCase() === state.defaultInstanceName.toLowerCase());
            if (foundIdx >= 0) defaultIdx = foundIdx + 1;
          }
          let selIdx = defaultIdx;
          console.log(`\n*(Note: The selected instance must be running and connected to MTA when you execute tests)*`);
          const choice = await ask(`Select default instance for ExecuteTest (1-${state.appInstances.length})`, String(defaultIdx));
          if (isBack(choice)) {
            stepSubBack = true;
          } else {
            const parsed = parseInt(choice, 10);
            if (!isNaN(parsed) && parsed >= 1 && parsed <= state.appInstances.length) {
              selIdx = parsed;
            }
            state.defaultInstanceName = state.appInstances[selIdx - 1].name;
            state.defaultInstanceToken = state.appInstances[selIdx - 1].token;
            state.activeConfig = state.appInstances[selIdx - 1];
            console.log(`Default instance: [${state.defaultInstanceName}]`);
          }
        }
      } else {
        const existingInstances = state.appInstances.length ? state.appInstances : (existingConfig.app_instances || []);
        console.log('\n--- MTA Application Instances (Automated Cloud Execution) ---');
        console.log('MTA Application Instances connect automated test suites in the MTA Cloud to your running app.');
        console.log('(Note: Only required if you have an MTA license and run automated tests.');
        console.log(' Free exploratory testing uses the local App Under Test Plugin below and does not need MTA instances.)\n');

        const defaultHasInst = existingInstances.length ? 'y' : state.hasInstancesManual;
        const hasInstancesAns = await ask('Do you have an MTA Application Instance to configure? (y/n)', defaultHasInst);
        if (isBack(hasInstancesAns)) {
          stepSubBack = true;
        } else {
          state.hasInstancesManual = hasInstancesAns.toLowerCase().startsWith('y') ? 'y' : 'n';
          if (state.hasInstancesManual === 'y') {
            const defaultCount = existingInstances.length ? String(existingInstances.length) : '1';
            const rawCount = await ask('How many MTA application instances do you have?', defaultCount);
            if (isBack(rawCount)) {
              stepSubBack = true;
            } else {
              const count = Math.max(1, parseInt(rawCount, 10) || 1);
              const newInstances = [];
              for (let i = 1; i <= count; i++) {
                const existingInst = existingInstances[i - 1];
                const defaultName = existingInst ? existingInst.name : (i === 1 ? 'local' : (i === 2 ? 'test' : `instance-${i}`));
                const instName = await ask(`Instance #${i} name (e.g. local, test)`, defaultName);
                if (isBack(instName)) { stepSubBack = true; break; }

                let token = '';
                const defaultToken = existingInst ? existingInst.token : (i === 1 ? (state.defaultInstanceToken || '') : '');
                while (!token) {
                  token = await ask(`Instance #${i} token (from MTA Portal > Application > Application Instances)`, defaultToken);
                  if (isBack(token)) { stepSubBack = true; break; }
                  token = token.trim();
                  if (!token) {
                    console.log('[ERROR] Application instance token cannot be empty.');
                  }
                }
                if (stepSubBack) break;
                if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
                  console.log('[NOTICE] Token does not match standard UUID format, but will be used as entered.');
                }
                newInstances.push({ name: instName, token });
              }
              if (!stepSubBack) {
                state.appInstances = newInstances;
                let selIdx = 1;
                if (state.appInstances.length > 1) {
                  const defaultSel = state.defaultInstanceName
                    ? String(state.appInstances.findIndex(x => x.name === state.defaultInstanceName) + 1 || 1)
                    : '1';
                  console.log(`\n*(Note: The selected instance must be running and connected to MTA when you execute tests)*`);
                  const choice = await ask(`Select default instance for ExecuteTest (1-${state.appInstances.length})`, defaultSel);
                  if (!isBack(choice)) {
                    const parsed = parseInt(choice, 10);
                    if (!isNaN(parsed) && parsed >= 1 && parsed <= state.appInstances.length) {
                      selIdx = parsed;
                    }
                  }
                }
                state.defaultInstanceName = state.appInstances[selIdx - 1].name;
                state.defaultInstanceToken = state.appInstances[selIdx - 1].token;
                console.log(`Default instance: [${state.defaultInstanceName}]`);
              }
            }
          } else {
            state.appInstances = [];
            state.defaultInstanceName = '';
            state.defaultInstanceToken = '';
            console.log('[INFO] Skipped. Automated cloud test execution (ExecuteTest) is inactive.');
            console.log('       Local exploratory testing remains fully available via the runtime plugin below.');
          }
        }
      }

      if (stepSubBack) {
        goBack = true;
      } else {
        nextStep = 'app_name';
      }
    } else if (currentStep === 'app_name') {
      console.log('\n--- MTA Connection Settings ---');
      const defaultAppName = state.appName
        || (state.mprPath ? path.basename(state.mprPath, path.extname(state.mprPath)) : (existingConfig.application_name || (state.projectDir ? path.basename(state.projectDir) : 'MyApp')));
      const ans = await ask('Application Name', defaultAppName);
      if (isBack(ans)) {
        goBack = true;
      } else {
        state.appName = ans;
        nextStep = 'mta_url';
      }
    } else if (currentStep === 'mta_url') {
      console.log('\n--- MTA URL ---');
      console.log('Default is https://mta-trial.mendixcloud.com.');
      console.log('*(Note: For free exploratory users, the cloud MTA URL is not relevant because all testing runs locally on your machine.');
      console.log(' You can safely press Enter to accept the default or leave it empty.)*\n');
      const defaultMtaUrl = state.mtaUrl || state.activeConfig?.mtaUrl || state.discoveredMta?.globalMtaUrl || existingConfig.mta_base_url || 'https://mta-trial.mendixcloud.com';
      const ans = await ask('MTA URL', defaultMtaUrl);
      if (isBack(ans)) {
        goBack = true;
      } else {
        state.mtaUrl = ans;
        nextStep = 'mta_token';
      }
    } else if (currentStep === 'mta_token') {
      console.log('\n--- Identification Token for a Service Account ---');
      console.log('Press Enter to SKIP (leave blank).');
      console.log('*(Note: You do not need an MTA Cloud license or service account token for exploratory testing.');
      console.log(' Required only to author test cases/suites and store test results in the MTA Cloud Portal.');
      console.log(' In the MTA Portal as ServiceAccountManager, go to Service account overview, create a ServiceAccount,');
      console.log(' and ensure "Call MCP primitive tools = Enabled" is checked.)*\n');
      const defaultMtaToken = state.rawMtaToken || process.env.MTA_MCP_AUTH_HEADER || existingConfig.mta_auth_header || '';
      const ans = await ask('Identification token for a service account (Press Enter to skip / leave blank)', defaultMtaToken);
      if (isBack(ans)) {
        goBack = true;
      } else {
        state.rawMtaToken = ans;
        if (!state.rawMtaToken.trim()) {
          console.log('[INFO] Identification token for a service account skipped. Cloud authoring tools will remain inactive.');
        }
        nextStep = 'plugin_url';
      }
    } else if (currentStep === 'plugin_url') {
      console.log('\n--- App Under Test Plugin (Local Exploratory Testing) ---');
      console.log('(Available for all users, including free tier.');
      console.log(' Enables the AI assistant to inspect entities and execute microflows in your running Mendix app.)\n');
      const defaultPluginUrl = state.pluginUrl
        || state.activeConfig?.pluginUrl
        || state.discoveredMta?.globalPluginUrl
        || (state.activeConfig?.pluginPort ? `http://localhost:${state.activeConfig.pluginPort}/plugin/mcp` : null)
        || (state.discoveredMta?.globalPluginPort ? `http://localhost:${state.discoveredMta.globalPluginPort}/plugin/mcp` : null)
        || existingConfig.plugin_mcp_url
        || 'http://localhost:8081/plugin/mcp';
      const ans = await ask('App under test Plugin URL', defaultPluginUrl);
      if (isBack(ans)) {
        goBack = true;
      } else {
        state.pluginUrl = ans;
        nextStep = 'plugin_token';
      }
    } else if (currentStep === 'plugin_token') {
      console.log('\n(App under test Plugin Token: Security token protecting the MtaPluginModule MCP endpoint in your running app.');
      console.log(' Configured in Studio Pro via constant MtaPluginModule.McpServerAccessToken.)');
      const defaultPluginToken = state.rawPluginToken
        || process.env.PLUGIN_MCP_TOKEN
        || state.activeConfig?.pluginToken
        || state.discoveredMta?.globalPluginToken
        || existingConfig.plugin_mcp_token
        || 'Bearer 1';
      const ans = await ask('App under test Plugin Token (Bearer token recommended)', defaultPluginToken);
      if (isBack(ans)) {
        goBack = true;
      } else {
        state.rawPluginToken = ans;
        nextStep = 'summary_review';
      }
    } else if (currentStep === 'summary_review') {
      const mcpSource = state.modelSource === '2' ? 'studiopro' : 'mxcli';
      const workspaceType = state.workspaceChoice === '2' ? 'mendix_project' : 'clone_root';
      const resolvedWorkspaceDir = workspaceType === 'clone_root' ? path.resolve(toolsRootDir, '..') : (state.projectDir || process.cwd());
      const mtaTokenPreview = state.rawMtaToken ? 'Set (Configured)' : '(skipped - local exploratory testing)';
      const pluginTokenPreview = state.rawPluginToken ? 'Set (Configured)' : '(none)';
      const instanceSummary = state.appInstances.length
        ? `${state.appInstances.length} configured (Default: "${state.defaultInstanceName || state.appInstances[0]?.name}")`
        : 'None (cloud test execution inactive)';
      const modelSourceSummary = mcpSource === 'studiopro'
        ? `Studio Pro MCP (${state.studioproMcpUrl || 'http://localhost:7782/mcp'})`
        : `mxcli (offline .mpr analysis) [Catalog: ${state.catalogChoice.toUpperCase()}]`;

      console.log('\n================================================================================');
      console.log(' CONFIGURATION SUMMARY & REVIEW');
      console.log('================================================================================');
      console.log(` [1] Workspace Setup:    ${workspaceType === 'clone_root' ? 'Dedicated Tools Workspace' : 'Direct Mendix Project Workspace'} (${resolvedWorkspaceDir})`);
      console.log(` [2] Mendix App Path:    ${state.projectDir || '(none)'}${state.detectedVersion ? ` (Mendix v${state.detectedVersion})` : ''}`);
      console.log(` [3] Model Source:       ${modelSourceSummary}`);
      console.log(` [4] MTA Server URL:     ${state.mtaUrl || '(none)'} (App: ${state.appName || 'MyApp'})`);
      console.log(` [5] Service Token:      ${mtaTokenPreview}`);
      console.log(` [6] App Instances:      ${instanceSummary}`);
      console.log(` [7] Plugin MCP URL:     ${state.pluginUrl || '(none)'}`);
      console.log(` [8] Plugin Token:       ${pluginTokenPreview}`);
      console.log('================================================================================\n');

      console.log('Options:');
      console.log('  • Press [Enter] or type "y" to confirm and save this configuration');
      console.log('  • Type a number [1-8] to jump directly to and edit that setting');
      console.log("  • Type 'b' to go back to the previous question");
      console.log('  • Type "n" or "abort" to exit without saving\n');

      const reviewAns = await ask('Confirm and apply configuration? [Y/n/1-8]', 'y', { allowBack: false });
      const trimmed = reviewAns.trim().toLowerCase();

      if (trimmed === 'b' || trimmed === 'back') {
        goBack = true;
      } else if (trimmed === 'n' || trimmed === 'no' || trimmed === 'abort' || trimmed === 'exit') {
        console.log('\nSetup aborted by user. Exiting without modifying any files.');
        process.exit(0);
      } else if (['1', '2', '3', '4', '5', '6', '7', '8'].includes(trimmed)) {
        editingSingleSetting = true;
        stepHistory.push('summary_review');
        if (trimmed === '1') currentStep = 'workspace';
        else if (trimmed === '2') currentStep = 'project_dir';
        else if (trimmed === '3') currentStep = 'model_source';
        else if (trimmed === '4') currentStep = 'app_name';
        else if (trimmed === '5') currentStep = 'mta_token';
        else if (trimmed === '6') currentStep = 'mta_instances';
        else if (trimmed === '7') currentStep = 'plugin_url';
        else if (trimmed === '8') currentStep = 'plugin_token';
        continue;
      } else {
        currentStep = 'DONE';
        continue;
      }
    }

    if (goBack) {
      if (editingSingleSetting) {
        editingSingleSetting = null;
        currentStep = 'summary_review';
      } else if (stepHistory.length > 0) {
        currentStep = stepHistory.pop();
      } else {
        console.log('[INFO] Already at the first step.\n');
      }
    } else if (nextStep) {
      if (editingSingleSetting) {
        if (currentStep === 'model_source' && nextStep === 'studiopro_url') {
          currentStep = 'studiopro_url';
        } else if (currentStep === 'app_name') {
          currentStep = 'mta_url';
        } else {
          editingSingleSetting = null;
          currentStep = 'summary_review';
        }
      } else {
        stepHistory.push(currentStep);
        currentStep = nextStep;
      }
    }
  }

  // --- SAVING AND CONFIGURATION PERSISTENCE ---
  const mcpSource = state.modelSource === '2' ? 'studiopro' : 'mxcli';
  const workspaceType = state.workspaceChoice === '2' ? 'mendix_project' : 'clone_root';
  const workspaceDir = workspaceType === 'clone_root' ? path.resolve(toolsRootDir, '..') : state.projectDir;
  let skillsDir = path.join(workspaceDir, 'skills');
  let skillsStyle = 'standard';

  if (workspaceType === 'clone_root') {
    skillsDir = path.join(workspaceDir, 'skills');
    skillsStyle = 'standard';
    console.log(`\nWorkspace: Parent Workspace Directory (${workspaceDir})`);
    console.log(`Tools Root: ${toolsRootDir}`);
    console.log(`Skills destination: ${skillsDir}`);
  } else if (workspaceType === 'mendix_project') {
    if (!state.isMendix1112Plus) {
      skillsDir = path.join(workspaceDir, 'skills');
      skillsStyle = 'standard';
      console.log(`\nMendix version does not support module skills (requires Mendix 11.12+).`);
      console.log(`Skills will be placed as project-level skills in: ${skillsDir}`);
    } else {
      const detectedModule = detectMendixModule(workspaceDir);
      if (detectedModule) {
        skillsDir = detectedModule;
        skillsStyle = 'mendix_module';
        console.log(`\n[FOUND] Menditect_AgenticTestSkills module detected at:`);
        console.log(`        ${path.relative(workspaceDir, detectedModule)}`);
        console.log(`Skills will be installed inside this module.`);
      } else {
        skillsDir = path.join(workspaceDir, 'skills');
        skillsStyle = 'standard';
        console.log(`\n[NOTICE] Menditect_AgenticTestSkills Marketplace module was not detected in this project.`);
        console.log(`Skills will be placed as project-level skills in ./skills/.`);
        console.log(`(Tip: Download Menditect_AgenticTestSkills from the Mendix Marketplace anytime,`);
        console.log(`then re-run setup to automatically relocate skills into the module.)`);
      }
    }
  }

  const { menditectOutputDir, plansDir } = ensureExecutionPlanFolders(workspaceDir);
  const mtaAuthHeader = state.rawMtaToken.trim() ? formatAuthHeader(state.rawMtaToken) : '';
  const pluginToken = formatBearerToken(state.rawPluginToken);
  const mtaUrl = state.mtaUrl;
  const mcpEndpoint = mtaUrl ? (mtaUrl.replace(/\/$/, '') + '/primitivetools/mcp') : '';
  const defaultPlaywrightViewerUrl = existingConfig.playwright_viewer_url || 'https://trace.playwright.dev/?trace=';
  const defaultTracefileBaseUrl = existingConfig.tracefile_base_url || (mtaUrl ? `${mtaUrl.replace(/\/$/, '')}/rest/private/tracefile?fileUUID=` : '');

  const sanitizedInstances = state.appInstances.map(inst => {
    const item = {
      name: inst.name,
      token: inst.token
    };
    if (inst.mtaUrl && typeof inst.mtaUrl === 'string') item.mtaUrl = inst.mtaUrl;
    if (inst.runtimeUrl && typeof inst.runtimeUrl === 'string') item.runtimeUrl = inst.runtimeUrl;
    if (inst.pluginUrl && typeof inst.pluginUrl === 'string') item.pluginUrl = inst.pluginUrl;
    if (inst.pluginToken && typeof inst.pluginToken === 'string') item.pluginToken = inst.pluginToken;
    if (inst.pluginPort) item.pluginPort = String(inst.pluginPort);
    if (inst.tracefileUrl && typeof inst.tracefileUrl === 'string') item.tracefileUrl = inst.tracefileUrl;
    return item;
  });

  const config = {
    $schema: './mta_config.schema.json',
    workspace_type: workspaceType,
    workspace_dir: workspaceDir,
    skills_dir: skillsDir,
    skills_style: skillsStyle,
    mta_output_path: menditectOutputDir,
    execution_plans_dir: plansDir,
    mendix_version: state.detectedVersion || '',
    application_name: state.appName,
    mta_base_url: mtaUrl,
    mcp_endpoint: mcpEndpoint,
    plugin_mcp_url: state.pluginUrl,
    playwright_viewer_url: defaultPlaywrightViewerUrl,
    tracefile_base_url: defaultTracefileBaseUrl,
    app_instances: sanitizedInstances,
    default_app_instance: state.defaultInstanceName,
    default_app_instance_token: state.defaultInstanceToken,
    model_source: mcpSource,
    mendix_project_dir: state.projectDir,
    mendix_mpr_path: state.mprPath
  };
  if (state.studioproMcpUrl) {
    config.studiopro_mcp_url = state.studioproMcpUrl;
  }

  // Cloned Repository Immutability Rule
  if (path.resolve(workspaceDir) !== path.resolve(toolsRootDir)) {
    try {
      fs.writeFileSync(path.join(workspaceDir, 'mta_config.json'), JSON.stringify(config, null, 2));
      const schemaSource = path.join(toolsRootDir, 'mta_config.schema.json');
      if (fs.existsSync(schemaSource)) {
        fs.copyFileSync(schemaSource, path.join(workspaceDir, 'mta_config.schema.json'));
      }
    } catch (e) {}
    console.log(`\nCreated / updated mta_config.json in workspace (${workspaceDir}) (toolsRootDir kept clean)`);
  } else {
    fs.writeFileSync(path.join(toolsRootDir, 'mta_config.json'), JSON.stringify(config, null, 2));
    console.log('\nCreated / updated mta_config.json (secrets decoupled to .env)');
  }

  // Ensure .gitignore
  ensureGitIgnoreEntries(workspaceDir, ['.env', '.env.local', '.mxcli/']);
  if (state.projectDir && fs.existsSync(state.projectDir) && path.resolve(state.projectDir) !== path.resolve(workspaceDir)) {
    ensureGitIgnoreEntries(state.projectDir, ['.mxcli/']);
  }

  let envContent = `MTA_MCP_ENDPOINT="${mcpEndpoint}"
MTA_MCP_AUTH_HEADER="${mtaAuthHeader}"
PLUGIN_MCP_URL="${state.pluginUrl}"
PLUGIN_MCP_TOKEN="${pluginToken}"
MENDIX_PROJECT_DIR="${state.projectDir}"
MENDIX_MPR_PATH="${state.mprPath}"
MENDIX_APP_NAME="${state.appName}"
MTA_OUTPUT_PATH="${menditectOutputDir.replace(/\\/g, '/')}"
MTA_APP_INSTANCE_TOKEN="${state.defaultInstanceToken}"
MTA_APP_INSTANCE_DEFAULT="${state.defaultInstanceName}"
`;

  if (state.studioproMcpUrl) {
    envContent += `STUDIOPRO_MCP_URL="${state.studioproMcpUrl}"\n`;
  }

  for (const inst of state.appInstances) {
    const safeEnvName = inst.name.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
    envContent += `MTA_APP_INSTANCE_${safeEnvName}="${inst.token}"\n`;
  }

  try {
    fs.writeFileSync(path.join(workspaceDir, '.env'), envContent, { mode: 0o600 });
  } catch (e) {
    fs.writeFileSync(path.join(workspaceDir, '.env'), envContent);
  }
  console.log(`Created .env in ${workspaceDir}`);

  // Skills synchronization
  let skillsSyncSuccess = false;
  if (skipSkills) {
    console.log('\n[NOTICE] Skipping skills synchronization (--skip-skills specified).');
  } else {
    console.log('\n--- Menditect Agentic Test Skills Synchronization ---');
    try {
      const { syncSkills } = require('./sync-upstream');
      skillsSyncSuccess = await syncSkills({ config });
      if (skillsSyncSuccess) {
        console.log(`[PASS] Upstream skills synchronized successfully into ${skillsDir}.`);
      } else {
        console.warn(`[WARN] Skills synchronization did not complete. You can run "npm run update:skills" later.`);
      }
    } catch (err) {
      console.warn(`[WARN] Could not automatically sync skills: ${err.message}`);
      console.warn(`       You can sync skills manually later via "npm run update:skills".`);
    }
  }

  // Scaffolding
  if (state.workspaceChoice === '1') {
    initializeMxcli(workspaceDir, state.mprPath, null, { isMendixProject: false });
  } else if (state.workspaceChoice === '2') {
    initializeMxcli(workspaceDir, state.mprPath, null, { isMendixProject: true });
  }

  // IDE Configs
  generateIdeConfigs(workspaceDir, mcpSource, state.projectDir, state.mprPath, mtaUrl, state.appName, mtaAuthHeader, pluginToken, state.defaultInstanceToken, state.pluginUrl, state.studioproMcpUrl);

  // Deploy runners
  deployMxcliWrappers(workspaceDir, state.mprPath);

  // Build catalog if not skipped
  if (state.catalogChoice !== 'skip' && state.mprPath && fs.existsSync(state.mprPath)) {
    await buildProjectCatalog(state.mprPath, null, { choice: state.catalogChoice });
  }

  // Update Agent Directives
  updateAgentDirectives(workspaceDir, state.appName, mtaUrl, skillsStyle, state.appInstances, state.defaultInstanceName, skillsDir);

  console.log('\n======================================================');
  console.log(' Setup completed successfully!');
  console.log(` Workspace configured at: ${workspaceDir}`);
  console.log(` Skills destination:      ${skillsDir}`);
  if (!skipSkills) {
    console.log(` Skills status:           ${skillsSyncSuccess ? 'Synchronized from agentic-test-skills' : 'Pending (run npm run update:skills)'}`);
  }
  console.log(` Default App Instance:    ${state.defaultInstanceName || '(none)'}`);
  console.log(` App Instances Total:     ${state.appInstances.length}`);
  console.log(` Execution plans:         ${plansDir}`);
  console.log('======================================================\n');

  // Verify Prompt
  console.log('--- Workspace Verification ---');
  console.log('[WARNING] Make sure your app under test is running in Studio Pro when verifying the MCP connection!\n');
  const doVerify = await ask('Would you like to verify MCP connectivity now? (npm run verify) (y/n)', 'y', { allowBack: false });
  
  if (doVerify.toLowerCase().startsWith('y')) {
    console.log('\nRunning verification...\n');
    try {
      const verifyScript = path.join(__dirname, 'verify-setup.js');
      execSync(`node "${verifyScript}"`, { stdio: 'inherit' });
    } catch (e) {
      console.warn('\n[NOTICE] Verification completed with warnings or errors. You can rerun anytime via "npm run verify".');
    }
  }

  // Configuration Summary & Next Steps
  const activeCfgPath = path.join(workspaceDir, 'mta_config.json');
  console.log('\n================================================================================');
  console.log(` Configuration File: ${activeCfgPath}`);
  console.log('--------------------------------------------------------------------------------');
  console.log(' This configuration file has been generated for your workspace.');
  console.log(' You can inspect or manually edit "mta_config.json" at any time,');
  console.log(' or simply re-run "npm run setup" whenever your settings change.');
  console.log('================================================================================\n');

  const showCfg = await ask('Would you like to view the contents of mta_config.json now? (y/n)', 'n', { allowBack: false });
  if (showCfg.toLowerCase().startsWith('y')) {
    console.log('\n--- mta_config.json ---');
    try {
      if (fs.existsSync(activeCfgPath)) {
        const displayedCfg = JSON.parse(fs.readFileSync(activeCfgPath, 'utf8'));
        console.log(JSON.stringify(displayedCfg, null, 2));
      }
    } catch (e) {}
    console.log('-----------------------\n');
  }

  console.log('Next Steps: Open the workspace in your AI Agent / Editor:');
  console.log(`  - Cursor:               Open "${workspaceDir}" (MCP servers connect automatically)`);
  console.log(`  - VS Code / Copilot:    Open "${workspaceDir}" (tools load from .vscode/mcp.json)`);
  console.log(`  - Claude Code:          Run "claude" in "${workspaceDir}" (reads CLAUDE.md & .claude/settings.json)`);
  console.log(`  - Antigravity / Gemini: Open "${workspaceDir}" (reads GEMINI.md & AGENTS.md)\n`);

  console.log('Suggested prompt for your AI Agent:');
  console.log('  "Read `mta_config.json` and `.env` in this workspace, and configure your MCP client settings to connect to the `mta` server (`mcp_endpoint`) and `mta_plugin` server (`plugin_mcp_url`) using their corresponding Bearer tokens."\n');

  console.log('For next steps and all npm verification, update, and synchronization options, see:');
  console.log('  README.md in the agentic-test-workspace folder or in https://github.com/Menditect/agentic-test-workspace/blob/main/README.md\n');

  if (rl) rl.close();
}

function runDirectivesOnly() {
  const candidateConfigPaths = [
    process.env.MTA_CONFIG_PATH,
    path.join(process.cwd(), 'mta_config.json'),
    path.join(toolsRootDir, 'mta_config.json')
  ].filter(Boolean);

  let config = {};
  for (const cfgPath of candidateConfigPaths) {
    if (fs.existsSync(cfgPath)) {
      try {
        config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        break;
      } catch (e) {}
    }
  }
  if (normalizeConfigAliases) {
    config = normalizeConfigAliases(config);
  }

  const workspaceDir = config.workspace_dir || process.cwd();

  const appName = config.application_name || 'MyApp';
  const mtaUrl = config.mta_base_url || 'https://mta-trial.mendixcloud.com';
  const skillsStyle = config.skills_style || 'standard';
  const appInstances = config.app_instances || [];
  const defaultInstanceName = config.default_app_instance || '';

  const skillsDir = config.skills_dir || path.join(workspaceDir, 'skills');
  console.log(`[RESTORE] Restoring Menditect Architecture Setup directives in ${workspaceDir}...`);
  updateAgentDirectives(workspaceDir, appName, mtaUrl, skillsStyle, appInstances, defaultInstanceName, skillsDir);
  console.log(`[PASS] Agent directives successfully restored across AGENTS.md, CLAUDE.md, and GEMINI.md.`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--directives-only') || args.includes('--directives')) {
    runDirectivesOnly();
  } else {
    const skipSkills = args.includes('--skip-skills') || args.includes('--no-skills') || args.includes('--skip-skills-sync');
    run({ skipSkills });
  }
} else {
  module.exports = {
    parseInstanceSelection,
    inspectMendixMtaSettings,
    findMxcliBinary,
    initializeMxcli,
    buildProjectCatalog,
    updateAgentDirectives,
    getMenditectSetupBlock,
    formatAuthHeader,
    formatBearerToken,
    findMpr,
    detectMendixVersion,
    isVersion1112OrHigher,
    normalizeConfigAliases,
    ensureExecutionPlanFolders,
    runDirectivesOnly,
    run
  };
}
