const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { toolsRootDir, PASS, WARN, NOTICE, INFO } = require('./cli-prompt');

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
    console.log(`${NOTICE} mxcli binary not found. Skipping mxcli init.`);
    return false;
  }

  const aiContextDir = path.join(targetDir, '.ai-context');
  const dotMxcliDir = path.join(targetDir, '.mxcli');
  const agentsPath = path.join(targetDir, 'AGENTS.md');
  const claudePath = path.join(targetDir, 'CLAUDE.md');
  const isAlreadyInitialized = fs.existsSync(aiContextDir);

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
      console.log(`${PASS} Initialized mxcli AI context and skills (.ai-context/skills/).`);

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

      if (mprPath && fs.existsSync(mprPath)) {
        const brainDir = path.join(targetDir, 'docs', 'brain');
        if (!fs.existsSync(brainDir)) {
          try {
            execSync(`"${mxcliBin}" brain init -p "${mprPath}"`, {
              stdio: ['ignore', 'ignore', 'ignore'],
              timeout: 15000
            });
            console.log(`${PASS} Initialized project brain architecture store (docs/brain/).`);
          } catch (e) {}
        }
      }
    } else {
      console.log(`\nRefreshing Mendix AI skills in ${targetDir}...`);
      execSync(`"${mxcliBin}" init "${targetDir}" --sync-skills`, {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 30000
      });
      console.log(`${PASS} Refreshed mxcli AI skills via --sync-skills.`);
    }

    if (!fs.existsSync(dotMxcliDir)) {
      fs.mkdirSync(dotMxcliDir, { recursive: true });
    }

    return true;
  } catch (err) {
    console.warn(`${WARN} Could not complete mxcli initialization in ${targetDir}: ${err.message}`);
    return false;
  }
}

async function buildProjectCatalog(mprPath, optionalBin, options = {}) {
  if (!mprPath || !fs.existsSync(mprPath)) return false;

  const mxcliBin = optionalBin || findMxcliBinary(mprPath);
  if (!mxcliBin) {
    console.log(`${NOTICE} mxcli binary not found. Skipping catalog build.`);
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
    console.log(`${INFO} Catalog indexing skipped.`);
    console.log(`${INFO} You can build it anytime by running:`);
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
          console.log(`\n${PASS} Catalog compiled successfully (${sizeMb} MB) at ${catalogDbPath}`);
        } else {
          console.log(`\n${PASS} Catalog refresh command completed.`);
        }
        resolve(true);
      } else {
        console.warn(`\n${WARN} Catalog build exited with code ${code}.`);
        console.warn(`       You can retry manually via: ./mxcli -c "${commandToRun}"`);
        resolve(false);
      }
    });

    proc.on('error', (err) => {
      console.warn(`\n${WARN} Failed to spawn mxcli for catalog refresh: ${err.message}`);
      resolve(false);
    });
  });
}

async function getOrDownloadMxcli(mprPath) {
  let mxcliBin = findMxcliBinary(mprPath);
  if (!mxcliBin) {
    try {
      const { syncMxcli } = require('../sync-upstream');
      const downloaded = await syncMxcli();
      if (downloaded) {
        mxcliBin = findMxcliBinary(mprPath);
      }
    } catch (e) {}
  }
  return mxcliBin;
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
set "MTA_CONFIG_PATH=%SCRIPT_DIR%mta_config.json"
node ${verifyBatScript} %*
`;

  const verifyShContent = `#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
export MTA_CONFIG_PATH="$SCRIPT_DIR/mta_config.json"
node ${verifyShScript} "$@"
`;

  fs.writeFileSync(path.join(targetDir, 'verify.bat'), verifyBatContent, 'utf8');
  const verifyShPath = path.join(targetDir, 'verify');
  fs.writeFileSync(verifyShPath, verifyShContent, 'utf8');
  try { fs.chmodSync(verifyShPath, 0o755); } catch (e) {}

  // Deploy linter MCP server runners (Streamable HTTP for MAIA)
  const linterMcpScriptInTools = path.join(toolsRootDir, 'scripts', 'mta-lint-mcp.js');
  const linterMcpBatScript = isParent
    ? `"%SCRIPT_DIR%${toolsRelName}\\scripts\\mta-lint-mcp.js"`
    : `"${linterMcpScriptInTools.replace(/\//g, '\\')}"`;

  const linterMcpShScript = isParent
    ? `"$SCRIPT_DIR/${toolsRelName}/scripts/mta-lint-mcp.js"`
    : `"${linterMcpScriptInTools.replace(/\\/g, '/')}"`;

  const linterMcpBatContent = `@echo off
set SCRIPT_DIR=%~dp0
node ${linterMcpBatScript} --http %*
`;

  const linterMcpShContent = `#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
node ${linterMcpShScript} --http "$@"
`;

  fs.writeFileSync(path.join(targetDir, 'start-linter-mcp.bat'), linterMcpBatContent, 'utf8');
  const linterMcpShPath = path.join(targetDir, 'start-linter-mcp');
  fs.writeFileSync(linterMcpShPath, linterMcpShContent, 'utf8');
  try { fs.chmodSync(linterMcpShPath, 0o755); } catch (e) {}

  console.log(`Deployed local ./mxcli, ./verify, and ./start-linter-mcp runners into ${targetDir}`);
}

module.exports = {
  findMxcliBinary,
  initializeMxcli,
  buildProjectCatalog,
  getOrDownloadMxcli,
  deployMxcliWrappers
};
