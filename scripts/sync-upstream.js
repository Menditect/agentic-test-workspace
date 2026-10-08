const https = require('https');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');
const os = require('os');

const rootDir = path.join(__dirname, '..');
const defaultBinDir = path.join(rootDir, 'bin');

let scriptVersion = '';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  if (pkg.version) scriptVersion = ` (v${pkg.version})`;
} catch (e) {}

function loadConfig() {
  const possiblePaths = [
    process.env.MTA_CONFIG_PATH,
    path.join(rootDir, 'mta_config.json'),
    path.join(process.cwd(), 'mta_config.json'),
    path.join(rootDir, '..', 'mta_config.json')
  ].filter(Boolean);

  let config = {};
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        const { normalizeConfigAliases } = require('./setup');
        config = normalizeConfigAliases ? normalizeConfigAliases(raw) : raw;
        break;
      } catch (e) {}
    }
  }

  if (config.workspace_dir && fs.existsSync(path.join(config.workspace_dir, 'mta_config.json'))) {
    const wsPath = path.join(config.workspace_dir, 'mta_config.json');
    if (path.resolve(wsPath) !== path.resolve(rootDir, 'mta_config.json')) {
      try {
        const wsRaw = JSON.parse(fs.readFileSync(wsPath, 'utf8'));
        const { normalizeConfigAliases } = require('./setup');
        const normalizedWs = normalizeConfigAliases ? normalizeConfigAliases(wsRaw) : wsRaw;
        config = { ...config, ...normalizedWs };
      } catch (e) {}
    }
  }

  return config;
}

function saveConfig(config) {
  try {
    if (config.workspace_dir && path.resolve(config.workspace_dir) !== path.resolve(rootDir)) {
      fs.writeFileSync(path.join(config.workspace_dir, 'mta_config.json'), JSON.stringify(config, null, 2), 'utf8');
      const schemaSource = path.join(rootDir, 'mta_config.schema.json');
      if (fs.existsSync(schemaSource)) {
        try { fs.copyFileSync(schemaSource, path.join(config.workspace_dir, 'mta_config.schema.json')); } catch (e) {}
      }
    } else {
      fs.writeFileSync(path.join(rootDir, 'mta_config.json'), JSON.stringify(config, null, 2), 'utf8');
    }
  } catch (e) {}
}

function apiRequest(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { 'User-Agent': 'Menditect-Workspace-Setup' }
    };
    https.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return apiRequest(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    }).on('error', reject);
  });
}

function fetchRawText(url) {
  return new Promise((resolve, reject) => {
    const options = { headers: { 'User-Agent': 'Menditect-Workspace-Setup' } };
    https.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchRawText(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function extractFrontmatterVersion(content) {
  if (!content) return null;
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('version:')) {
      const v = trimmed.replace(/^version:\s*['"]?/, '').replace(/['"]?\s*$/, '');
      if (v) return v;
    }
  }
  return null;
}

function extractFrontmatterName(content) {
  if (!content) return null;
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('name:')) {
      const n = trimmed.replace(/^name:\s*['"]?/, '').replace(/['"]?\s*$/, '');
      if (n) return n;
    }
  }
  return null;
}

function promptConfirmation(question, defaultYes = true) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      return resolve(defaultYes);
    }
    const suffix = defaultYes ? ' [Y/n]: ' : ' [y/N]: ';
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(question + suffix, (ans) => {
      rl.close();
      const trimmed = ans.trim().toLowerCase();
      if (!trimmed) {
        return resolve(defaultYes);
      }
      if (trimmed === 'y' || trimmed === 'yes') {
        return resolve(true);
      }
      return resolve(false);
    });
  });
}

function getLocalMxcliVersion(binDir = defaultBinDir) {
  const binaryName = process.platform === 'win32' ? 'mxcli.exe' : 'mxcli';
  const binPath = path.join(binDir, binaryName);
  if (!fs.existsSync(binPath)) {
    return { installed: false, version: null, raw: null };
  }
  try {
    const out = execSync(`"${binPath}" --version`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 5000
    }).trim();
    const match = out.match(/mxcli version (v?[0-9a-zA-Z\.\-]+)/i);
    const version = match ? match[1] : out;
    return { installed: true, version, raw: out };
  } catch (e) {
    return { installed: true, version: 'Unknown', raw: null };
  }
}

async function getRemoteMxcliRelease() {
  try {
    const release = await apiRequest('https://api.github.com/repos/mendixlabs/mxcli/releases/latest');
    const version = release.tag_name || release.name || 'Unknown';
    const publishedAt = release.published_at ? release.published_at.substring(0, 10) : '';
    return {
      available: true,
      version,
      publishedAt,
      release
    };
  } catch (e) {
    return { available: false, version: null, error: e.message };
  }
}

function getLocalSkillVersions(skillsDir) {
  const results = new Map();
  if (!fs.existsSync(skillsDir)) {
    return results;
  }

  const agentsPath = path.join(skillsDir, 'AGENTS.md');
  if (fs.existsSync(agentsPath)) {
    try {
      const content = fs.readFileSync(agentsPath, 'utf8');
      const v = extractFrontmatterVersion(content);
      results.set('AGENTS.md', {
        name: 'Root Orchestrator (AGENTS.md)',
        type: 'agents',
        relPath: 'AGENTS.md',
        version: v || 'Unknown',
        installed: true
      });
    } catch (e) {}
  }

  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
        if (fs.existsSync(skillPath)) {
          try {
            const content = fs.readFileSync(skillPath, 'utf8');
            const v = extractFrontmatterVersion(content);
            const n = extractFrontmatterName(content) || entry.name;
            results.set(entry.name, {
              name: n,
              type: 'skill',
              relPath: `${entry.name}/SKILL.md`,
              version: v || 'Unknown',
              installed: true
            });
          } catch (e) {}
        }
      }
    }
  } catch (e) {}

  return results;
}

async function getRemoteSkillVersions() {
  const results = new Map();
  let commitInfo = null;

  try {
    const commitData = await apiRequest('https://api.github.com/repos/Menditect/agentic-test-skills/commits/main');
    if (commitData && commitData.sha) {
      commitInfo = {
        sha: commitData.sha.substring(0, 7),
        date: commitData.commit && commitData.commit.committer ? commitData.commit.committer.date.substring(0, 10) : '',
        message: commitData.commit ? commitData.commit.message.split('\n')[0] : ''
      };
    }
  } catch (e) {}

  const knownSkillPaths = [
    { key: 'AGENTS.md', relPath: 'AGENTS.md', name: 'Root Orchestrator (AGENTS.md)', type: 'agents' },
    { key: 'mta-test-design', relPath: 'mta-test-design/SKILL.md', name: 'mta-test-design', type: 'skill' },
    { key: 'mta-build', relPath: 'mta-build/SKILL.md', name: 'mta-build', type: 'skill' },
    { key: 'mta-run-analyze', relPath: 'mta-run-analyze/SKILL.md', name: 'mta-run-analyze', type: 'skill' },
    { key: 'mta-install-config', relPath: 'mta-install-config/SKILL.md', name: 'mta-install-config', type: 'skill' },
    { key: 'menditecttestabilityframework', relPath: 'menditecttestabilityframework/SKILL.md', name: 'menditecttestabilityframework', type: 'skill' }
  ];

  try {
    const treeData = await apiRequest('https://api.github.com/repos/Menditect/agentic-test-skills/git/trees/main?recursive=1');
    if (treeData && Array.isArray(treeData.tree)) {
      for (const item of treeData.tree) {
        if (item.path && item.path.startsWith('AgenticTestSkills/')) {
          const sub = item.path.replace(/^AgenticTestSkills\//, '');
          if (sub.endsWith('/SKILL.md')) {
            const skillDirName = sub.replace(/\/SKILL\.md$/, '');
            if (!knownSkillPaths.some(k => k.key === skillDirName)) {
              knownSkillPaths.push({
                key: skillDirName,
                relPath: sub,
                name: skillDirName,
                type: 'skill'
              });
            }
          }
        }
      }
    }
  } catch (e) {}

  await Promise.all(knownSkillPaths.map(async (item) => {
    try {
      const rawUrl = `https://raw.githubusercontent.com/Menditect/agentic-test-skills/main/AgenticTestSkills/${item.relPath}`;
      const content = await fetchRawText(rawUrl);
      const v = extractFrontmatterVersion(content);
      const n = extractFrontmatterName(content) || item.name;
      results.set(item.key, {
        name: n,
        type: item.type,
        relPath: item.relPath,
        version: v || 'Unknown',
        available: true
      });
    } catch (err) {
      results.set(item.key, {
        name: item.name,
        type: item.type,
        relPath: item.relPath,
        version: null,
        available: false
      });
    }
  }));

  return { results, commitInfo };
}

function getLocalLinterVersion(rDir) {
  const linterPath = path.join(rDir, 'tools', 'mta-lint.mjs');
  if (!fs.existsSync(linterPath)) {
    return { installed: false, version: null };
  }
  try {
    const content = fs.readFileSync(linterPath, 'utf8');
    const m = content.match(/export\s+const\s+LINTER_VERSION\s*=\s*["']([^"']+)["']/);
    if (m) return { installed: true, version: m[1] };
    const m2 = content.match(/VERSION\s*=\s*["']([^"']+)["']/);
    return { installed: true, version: m2 ? m2[1] : 'Unknown' };
  } catch (e) {
    return { installed: false, version: null, error: e.message };
  }
}

async function getRemoteLinterVersion() {
  try {
    const raw = await fetchRawText('https://raw.githubusercontent.com/Menditect/agentic-test-workspace/main/tools/mta-lint.mjs');
    const m = raw.match(/export\s+const\s+LINTER_VERSION\s*=\s*["']([^"']+)["']/);
    if (m) return { available: true, version: m[1] };
    const m2 = raw.match(/VERSION\s*=\s*["']([^"']+)["']/);
    return { available: true, version: m2 ? m2[1] : 'Unknown' };
  } catch (e) {
    return { available: false, version: null, error: e.message };
  }
}

async function checkVersions(options = {}) {
  const config = options.config || loadConfig();
  const targetSkillsDir = (options.config && options.config.skills_dir) || config.skills_dir || path.join(rootDir, 'skills');
  const targetBinDir = defaultBinDir;

  const target = options.target || 'all';
  const report = {
    mxcli: null,
    skills: null,
    linter: null,
    hasUpdates: false,
    summary: []
  };

  if (target === 'all' || target === 'mxcli') {
    const local = getLocalMxcliVersion(targetBinDir);
    const remote = await getRemoteMxcliRelease();
    
    let status = 'Unknown';
    let updateAvailable = false;
    if (!local.installed) {
      status = 'Not installed (Download available)';
      updateAvailable = remote.available;
    } else if (!remote.available) {
      status = 'Remote check failed';
    } else if (local.version && remote.version) {
      const cleanLocal = local.version.replace(/^v/, '');
      const cleanRemote = remote.version.replace(/^v/, '');
      if (cleanLocal === cleanRemote) {
        status = 'Up to date';
      } else {
        status = 'Update available';
        updateAvailable = true;
      }
    }

    report.mxcli = {
      local: local.version || '(not installed)',
      remote: remote.version ? `${remote.version}${remote.publishedAt ? ` (${remote.publishedAt})` : ''}` : '(failed to fetch)',
      status,
      updateAvailable,
      rawRemote: remote.version
    };

    if (updateAvailable) report.hasUpdates = true;
  }

  if (target === 'all' || target === 'skills') {
    const localMap = getLocalSkillVersions(targetSkillsDir);
    const { results: remoteMap, commitInfo } = await getRemoteSkillVersions();

    const allKeys = Array.from(new Set([...localMap.keys(), ...remoteMap.keys()]));
    const skillRows = [];
    let skillsUpdateAvailable = false;

    for (const key of allKeys) {
      const loc = localMap.get(key);
      const rem = remoteMap.get(key);

      const displayName = (loc && loc.name) || (rem && rem.name) || key;
      const localVer = loc ? loc.version : '(not installed)';
      const remoteVer = rem && rem.version ? rem.version : '(not found)';

      let status = 'Unknown';
      let needsUpdate = false;

      if (!loc) {
        status = 'New skill available';
        needsUpdate = true;
      } else if (!rem || !rem.version) {
        status = 'Upstream unavailable';
      } else if (loc.version === rem.version) {
        status = 'Up to date';
      } else {
        status = 'Update available';
        needsUpdate = true;
      }

      if (needsUpdate) {
        skillsUpdateAvailable = true;
      }

      skillRows.push({
        key,
        name: displayName,
        localVersion: localVer,
        remoteVersion: remoteVer,
        status,
        needsUpdate,
        type: (loc && loc.type) || (rem && rem.type) || 'skill'
      });
    }

    skillRows.sort((a, b) => {
      if (a.key === 'AGENTS.md') return -1;
      if (b.key === 'AGENTS.md') return 1;
      return a.name.localeCompare(b.name);
    });

    report.skills = {
      targetDir: targetSkillsDir,
      commitInfo,
      items: skillRows,
      updateAvailable: skillsUpdateAvailable
    };

    if (skillsUpdateAvailable) report.hasUpdates = true;
  }

  if (target === 'all' || target === 'skills' || target === 'tools') {
    const local = getLocalLinterVersion(rootDir);
    const remote = await getRemoteLinterVersion();

    let status = 'Unknown';
    let updateAvailable = false;
    if (!local.installed) {
      status = 'Not installed (Download available)';
      updateAvailable = remote.available;
    } else if (!remote.available) {
      status = 'Remote check failed';
    } else if (local.version && remote.version) {
      const cleanLocal = local.version.replace(/^v/, '');
      const cleanRemote = remote.version.replace(/^v/, '');
      if (cleanLocal === cleanRemote) {
        status = 'Up to date';
      } else {
        status = 'Update available';
        updateAvailable = true;
      }
    }

    report.linter = {
      local: local.version || '(not installed)',
      remote: remote.version || '(failed to fetch)',
      status,
      updateAvailable,
      rawRemote: remote.version
    };

    if (updateAvailable) report.hasUpdates = true;
  }

  return report;
}

function printVersionTable(report) {
  console.log('================================================================================');
  console.log(`                Menditect Workspace Upstream Version Check${scriptVersion}`);
  console.log('================================================================================\n');

  const pad = (str, len) => String(str || '').padEnd(len);

  if (report.mxcli) {
    console.log('--- Mendix Model CLI (mendixlabs/mxcli) ---');
    console.log(`${pad('Component', 35)} | ${pad('Local Version', 16)} | ${pad('Remote Version', 20)} | Status`);
    console.log('-'.repeat(88));
    console.log(
      `${pad('mxcli binary', 35)} | ` +
      `${pad(report.mxcli.local, 16)} | ` +
      `${pad(report.mxcli.remote, 20)} | ` +
      `${report.mxcli.status}`
    );
    console.log();
  }

  if (report.skills) {
    const commitStr = report.skills.commitInfo
      ? ` (@ ${report.skills.commitInfo.sha}${report.skills.commitInfo.date ? `, ${report.skills.commitInfo.date}` : ''})`
      : '';
    console.log(`--- MTA Testing Skills (Menditect/agentic-test-skills${commitStr}) ---`);
    console.log(`Destination: ${report.skills.targetDir}`);
    console.log(`${pad('Skill / Orchestrator', 35)} | ${pad('Local Version', 16)} | ${pad('Remote Version', 20)} | Status`);
    console.log('-'.repeat(88));

    for (const item of report.skills.items) {
      console.log(
        `${pad(item.name, 35)} | ` +
        `${pad(item.localVersion, 16)} | ` +
        `${pad(item.remoteVersion, 20)} | ` +
        `${item.status}`
      );
    }
    console.log();
  }

  if (report.linter) {
    console.log('--- MTA Linter Tooling (Menditect/agentic-test-workspace/tools) ---');
    console.log(`${pad('Component', 35)} | ${pad('Local Version', 16)} | ${pad('Remote Version', 20)} | Status`);
    console.log('-'.repeat(88));
    console.log(
      `${pad('tools/mta-lint.mjs', 35)} | ` +
      `${pad(report.linter.local, 16)} | ` +
      `${pad(report.linter.remote, 20)} | ` +
      `${report.linter.status}`
    );
    console.log();
  }

  console.log('--------------------------------------------------------------------------------');
  const countUpdates = [];
  if (report.mxcli && report.mxcli.updateAvailable) countUpdates.push('mxcli binary');
  if (report.linter && report.linter.updateAvailable) countUpdates.push('mta-lint tooling');
  if (report.skills) {
    const updatedCount = report.skills.items.filter(i => i.needsUpdate).length;
    if (updatedCount > 0) countUpdates.push(`${updatedCount} skill(s) / orchestrator`);
  }

  if (countUpdates.length > 0) {
    console.log(`[NOTICE] Updates available for: ${countUpdates.join(', ')}.`);
    if (report.skills && report.skills.items.some(i => i.needsUpdate)) {
      console.log(`[WARNING] Updating skills performs complete replacement of official MTA skills`);
      console.log(`          in the target directory to prevent orphan skills.`);
    }
  } else {
    console.log(`[PASS] All inspected components are up to date with upstream.`);
  }
  console.log('--------------------------------------------------------------------------------\n');
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const options = { headers: { 'User-Agent': 'Menditect-Workspace-Setup' } };
    https.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

function getMenditectSetupBlock(appName, mtaUrl, skillsStyle) {
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
      '- **ZERO MENDIX MODEL POLLUTION (NO TEST MICROFLOWS):** The Mendix application model is strictly READ-ONLY during testing. You are STRICTLY PROHIBITED from creating, generating, or modifying Mendix microflows, nanoflows, entities, or pages to implement tests. Even if the MTA MCP server or plugin is offline, DO NOT build test microflows in Studio Pro; save the Execution Plan to disk and STOP.',
      '- **ENVIRONMENT SSOT:** All environment configuration (Application name, MTA Base URL, Default App Instance, and ApplicationInstanceToken) must be dynamically loaded from `mta_config.json`.'
    ].join('\n');
  }

  return [
    '# Menditect Architecture Setup',
    '- **CRITICAL OPERATIONAL COMMAND:** Always execute tasks using the core rules defined in `skills/AGENTS.md`.',
    '- **ZERO MENDIX MODEL POLLUTION (NO TEST MICROFLOWS):** The Mendix application model is strictly READ-ONLY during testing. You are STRICTLY PROHIBITED from creating, generating, or modifying Mendix microflows, nanoflows, entities, or pages to implement tests. Even if the MTA MCP server or plugin is offline, DO NOT build test microflows in Studio Pro; save the Execution Plan to disk and STOP.',
    '- **ENVIRONMENT SSOT:** All environment configuration (Application name, MTA Base URL, Default App Instance, and ApplicationInstanceToken) must be dynamically loaded from `mta_config.json`.'
  ].join('\n');
}

function updateDirectives(targetDir, appName, mtaUrl, skillsStyle) {
  const targetFiles = [
    path.join(targetDir, 'AGENTS.md'),
    path.join(targetDir, 'CLAUDE.md'),
    path.join(targetDir, 'GEMINI.md'),
    path.join(targetDir, '.github', 'copilot-instructions.md')
  ];

  const setupBlock = getMenditectSetupBlock(appName, mtaUrl, skillsStyle);
  const headerRegex = /# Menditect Architecture Setup[\s\S]*?(?=(?:\r?\n#[^#]|$))/;

  for (const filePath of targetFiles) {
    let content = '';
    if (fs.existsSync(filePath)) {
      content = fs.readFileSync(filePath, 'utf8');
    }
    if (headerRegex.test(content)) {
      content = content.replace(headerRegex, setupBlock + '\n');
    } else {
      content = content.trimEnd() ? (content.trimEnd() + '\n\n' + setupBlock + '\n') : (setupBlock + '\n');
    }
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

async function syncLinterTools({ rootDir: rDir, workspaceDir: wsDir } = {}) {
  const targetRootDir = rDir || rootDir;
  const targetWsDir = wsDir || loadConfig().workspace_dir || targetRootDir;

  console.log('Syncing MTA linter tooling (tools/mta-lint.mjs) from Menditect/agentic-test-workspace...');
  const rootToolsDir = path.join(targetRootDir, 'tools');
  const rootFixturesDir = path.join(rootToolsDir, 'fixtures');
  if (!fs.existsSync(rootFixturesDir)) fs.mkdirSync(rootFixturesDir, { recursive: true });

  try {
    const linterCode = await fetchRawText('https://raw.githubusercontent.com/Menditect/agentic-test-workspace/main/tools/mta-lint.mjs');
    if (linterCode && linterCode.includes('LINTER_VERSION')) {
      fs.writeFileSync(path.join(rootToolsDir, 'mta-lint.mjs'), linterCode, 'utf8');

      if (targetWsDir && path.resolve(targetWsDir) !== path.resolve(targetRootDir)) {
        const wsToolsDir = path.join(targetWsDir, 'tools');
        if (!fs.existsSync(wsToolsDir)) fs.mkdirSync(wsToolsDir, { recursive: true });
        fs.writeFileSync(path.join(wsToolsDir, 'mta-lint.mjs'), linterCode, 'utf8');
      }
      console.log('[PASS] Synchronized tools/mta-lint.mjs from upstream workspace repository.');
    }
  } catch (err) {
    console.warn(`[WARN] Could not download latest mta-lint.mjs from upstream: ${err.message}`);
  }

  // Also sync run-linter.mjs dispatcher
  try {
    const runnerUrl = 'https://raw.githubusercontent.com/Menditect/agentic-test-workspace/main/tools/run-linter.mjs';
    const runnerCode = await fetchRawText(runnerUrl);
    if (runnerCode && runnerCode.includes('spawnSync')) {
      fs.writeFileSync(path.join(rootToolsDir, 'run-linter.mjs'), runnerCode, 'utf8');
      if (targetWsDir && path.resolve(targetWsDir) !== path.resolve(targetRootDir)) {
        const wsToolsDir = path.join(targetWsDir, 'tools');
        if (!fs.existsSync(wsToolsDir)) fs.mkdirSync(wsToolsDir, { recursive: true });
        fs.writeFileSync(path.join(wsToolsDir, 'run-linter.mjs'), runnerCode, 'utf8');
      }
      console.log('[PASS] Synchronized tools/run-linter.mjs dispatcher.');
    }
  } catch (err) {
    // Non-fatal if offline or not yet merged on upstream main
  }

  // Check and preserve custom linter override if present
  const customLinterPath = path.join(rootToolsDir, 'mta-lint.custom.mjs');
  if (fs.existsSync(customLinterPath)) {
    console.log('[NOTICE] Preserving local custom linter override: tools/mta-lint.custom.mjs');
  }

  // Sync test fixtures if available
  const fixtureFiles = [
    'valid_plan.md',
    'invalid_matrix_assoc.md',
    'invalid_step_anti01.md',
    'valid_frontend_plan.md',
    'invalid_frontend_anti20.md',
    'invalid_frontend_backend_assert_in_ui.md',
    'invalid_frontend_orphaned_validation_locator.md',
    'invalid_frontend_wrong_locator_type.md',
    'valid_frontend_validation_feedback_plan.md',
    'valid_intent_feature_plan.md',
    'invalid_intent_circular_spec.md',
    'invalid_intent_missing_spec.md',
    'invalid_intent_trivial_risk.md',
    'invalid_piped_retrieve_no_count.md',
    'invalid_datepicker_no_format.md',
    'invalid_date_macro.md',
    'invalid_empty_object_no_sentinel.md',
    'valid_plan_with_sentinel.md',
    'server_response_pass.json',
    'server_response_fail.json',
    'server_response_doc_mismatch.json'
  ];

  for (const f of fixtureFiles) {
    try {
      const fixUrl = `https://raw.githubusercontent.com/Menditect/agentic-test-workspace/main/tools/fixtures/${f}`;
      const content = await fetchRawText(fixUrl);
      if (content && content.length > 0) {
        fs.writeFileSync(path.join(rootFixturesDir, f), content, 'utf8');
        if (targetWsDir && path.resolve(targetWsDir) !== path.resolve(targetRootDir)) {
          const wsFixDir = path.join(targetWsDir, 'tools', 'fixtures');
          if (!fs.existsSync(wsFixDir)) fs.mkdirSync(wsFixDir, { recursive: true });
          fs.writeFileSync(path.join(wsFixDir, f), content, 'utf8');
        }
      }
    } catch (e) {}
  }

  // Always run self-test verification
  try {
    const linterPath = path.join(targetRootDir, 'tools', 'mta-lint.mjs');
    if (fs.existsSync(linterPath)) {
      console.log('Running linter health self-test...');
      execSync(`node "${linterPath}" self-test`, { stdio: 'inherit' });
    }
  } catch (testErr) {
    console.warn(`[WARN] Linter self-test verification reported errors: ${testErr.message}`);
  }
  return true;
}

async function syncSkills(options = {}) {
  const config = options.config || loadConfig();
  let targetSkillsDir = (options.config && options.config.skills_dir) || config.skills_dir || path.join(rootDir, 'skills');
  const workspaceDir = (options.config && options.config.workspace_dir) || config.workspace_dir || rootDir;

  // Ensure execution-plans folder exists in workspace (menditect-output/execution-plans)
  const menditectOutputDir = config.mta_output_path || path.join(workspaceDir, 'menditect-output');
  const plansDir = config.execution_plans_dir || path.join(menditectOutputDir, 'execution-plans');
  if (!fs.existsSync(menditectOutputDir)) fs.mkdirSync(menditectOutputDir, { recursive: true });
  if (!fs.existsSync(plansDir)) fs.mkdirSync(plansDir, { recursive: true });

  // Check if Marketplace module was recently added and offer/perform automatic migration (requires Mendix 11.12+)
  if (config.workspace_type === 'mendix_project' && config.skills_style === 'standard') {
    const is1112Plus = !config.mendix_version || (() => {
      const parts = config.mendix_version.split('.').map(n => parseInt(n, 10));
      return (parts[0] > 11) || (parts[0] === 11 && (parts[1] || 0) >= 12);
    })();

    if (is1112Plus) {
      const candidateModule = path.join(workspaceDir, 'skillssource', '_modules', 'menditect_agentictestskills');
      if (fs.existsSync(candidateModule) && fs.statSync(candidateModule).isDirectory()) {
        console.log(`\n[MIGRATION] Detected Menditect_AgenticTestSkills module at:`);
        console.log(`            ${path.relative(workspaceDir, candidateModule)}`);
        console.log('Migrating skills from project-level ./skills/ into module...');

        targetSkillsDir = candidateModule;
        config.skills_dir = candidateModule;
        config.skills_style = 'mendix_module';
        saveConfig(config);

        // Clean up legacy skills directory if it exists
        const oldSkillsDir = path.join(workspaceDir, 'skills');
        if (fs.existsSync(oldSkillsDir) && path.resolve(oldSkillsDir) !== path.resolve(candidateModule)) {
          try { fs.rmSync(oldSkillsDir, { recursive: true, force: true }); } catch (e) {}
        }

        // Update project directives to explore the module
        updateDirectives(workspaceDir, config.application_name || 'MyApp', config.mta_base_url || 'https://mta-trial.mendixcloud.com', 'mendix_module');
        console.log('Updated project AGENTS.md to explore [Menditect_AgenticTestSkills].');
      }
    }
  }

  console.log(`Syncing skills from Menditect/agentic-test-skills into ${targetSkillsDir}...`);
  console.log(`[WARNING] Complete skills replacement: all files in ${targetSkillsDir} will be replaced with the latest upstream release to prevent orphan skills.`);
  console.log(`          Any inline modifications to MTA skills will be erased.`);
  console.log(`          Custom skills should be added as separate, new skills rather than editing MTA skills inline.\n`);

  const tmpDir = path.join(os.tmpdir(), 'agentic-test-skills-tmp-' + Date.now());
  try {
    execSync(`git clone --depth 1 https://github.com/Menditect/agentic-test-skills.git "${tmpDir}"`, { stdio: 'ignore' });
    
    const sourceSkillsDir = path.join(tmpDir, 'AgenticTestSkills');
    if (fs.existsSync(sourceSkillsDir)) {
      // Clean out existing files/subdirectories completely to prevent orphan skills
      if (fs.existsSync(targetSkillsDir)) {
        fs.rmSync(targetSkillsDir, { recursive: true, force: true });
      }
      fs.mkdirSync(targetSkillsDir, { recursive: true });
      
      fs.cpSync(sourceSkillsDir, targetSkillsDir, { recursive: true });
      console.log(`Skills synced successfully into ${targetSkillsDir}`);

      // Synchronize canonical mta_config.schema.json from upstream skills references
      const upstreamSchemaCandidate = path.join(sourceSkillsDir, 'mta-build', 'references', 'mta_config.schema.json');
      if (fs.existsSync(upstreamSchemaCandidate)) {
        try {
          const upstreamSchema = JSON.parse(fs.readFileSync(upstreamSchemaCandidate, 'utf8'));
          const targetSchemaPath = path.join(rootDir, 'mta_config.schema.json');
          fs.copyFileSync(upstreamSchemaCandidate, targetSchemaPath);
          console.log(`[PASS] Synchronized canonical mta_config.schema.json (v${upstreamSchema.version || 'unknown'}) from upstream skills.`);
          if (path.resolve(workspaceDir) !== path.resolve(rootDir)) {
            const wsSchemaPath = path.join(workspaceDir, 'mta_config.schema.json');
            if (fs.existsSync(wsSchemaPath)) {
              fs.copyFileSync(upstreamSchemaCandidate, wsSchemaPath);
            }
          }
        } catch (schemaErr) {
          console.warn(`[WARN] Could not update mta_config.schema.json from upstream: ${schemaErr.message}`);
        }
      }

      // Synchronize MTA linter tooling and execute health self-test
      await syncLinterTools({ rootDir, workspaceDir });

      return true;
    } else {
      console.warn('[WARN] AgenticTestSkills directory not found in repository.');
      return false;
    }
  } catch (err) {
    console.error('Failed to sync skills (is git installed?):', err.message);
    return false;
  } finally {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch(e) {}
  }
}

async function syncMxcli() {
  const config = loadConfig();
  const workspaceDir = config.workspace_dir || rootDir;

  if (!fs.existsSync(defaultBinDir)) fs.mkdirSync(defaultBinDir, { recursive: true });

  console.log('Fetching latest mxcli release from mendixlabs/mxcli...');
  try {
    const release = await apiRequest('https://api.github.com/repos/mendixlabs/mxcli/releases/latest');
    console.log(`Found mxcli ${release.tag_name}`);
    
    let assetName = '';
    const platform = process.platform;
    const arch = process.arch;
    
    if (platform === 'win32') {
      assetName = arch === 'arm64' ? 'mxcli-windows-arm64.exe' : 'mxcli-windows-amd64.exe';
    } else if (platform === 'darwin') {
      assetName = arch === 'arm64' ? 'mxcli-darwin-arm64' : 'mxcli-darwin-amd64';
    } else {
      assetName = arch === 'arm64' ? 'mxcli-linux-arm64' : 'mxcli-linux-amd64';
    }
    
    const asset = release.assets.find(a => a.name === assetName);
    if (!asset) {
      console.log(`No mxcli binary found for ${platform} ${arch}`);
      return false;
    }
    
    const finalBinName = platform === 'win32' ? 'mxcli.exe' : 'mxcli';
    const binaryPath = path.join(defaultBinDir, finalBinName);
    
    console.log(`Downloading ${asset.browser_download_url}...`);
    await downloadFile(asset.browser_download_url, binaryPath);
    
    if (platform !== 'win32') {
      if (fs.existsSync(binaryPath)) {
        fs.chmodSync(binaryPath, 0o755);
        console.log('Applied chmod +x to mxcli.');
      }
    }
    console.log(`mxcli updated successfully in ${defaultBinDir}`);

    // If workspace is separate, ensure workspace bin directory also has the binary
    if (path.resolve(workspaceDir) !== path.resolve(rootDir)) {
      const workspaceBinDir = path.join(workspaceDir, 'bin');
      if (!fs.existsSync(workspaceBinDir)) fs.mkdirSync(workspaceBinDir, { recursive: true });
      const targetBinaryPath = path.join(workspaceBinDir, finalBinName);
      fs.copyFileSync(binaryPath, targetBinaryPath);
      if (platform !== 'win32') {
        try { fs.chmodSync(targetBinaryPath, 0o755); } catch (e) {}
      }
      console.log(`Copied mxcli binary to ${workspaceBinDir}`);
    }

    // Sync mxcli AI skills in workspace and/or Mendix project using the updated binary
    const targetsToSync = new Set();
    if (workspaceDir && fs.existsSync(workspaceDir)) {
      if (fs.existsSync(path.join(workspaceDir, '.ai-context'))) {
        targetsToSync.add(workspaceDir);
      }
    }
    if (config.mendix_project_dir && fs.existsSync(config.mendix_project_dir)) {
      if (fs.existsSync(path.join(config.mendix_project_dir, '.ai-context'))) {
        targetsToSync.add(config.mendix_project_dir);
      }
    }

    for (const target of targetsToSync) {
      try {
        console.log(`Refreshing mxcli skills in ${target}...`);
        execSync(`"${binaryPath}" init "${target}" --sync-skills`, { stdio: 'ignore', timeout: 30000 });
        console.log(`[PASS] Refreshed mxcli skills in ${target}`);
      } catch (e) {
        console.warn(`[WARN] Could not sync mxcli skills in ${target}: ${e.message}`);
      }
    }

    return true;
  } catch (err) {
    console.error('Failed to update mxcli:', err.message);
    return false;
  }
}

async function run(cliTarget = null) {
  const args = process.argv.slice(2);
  const isCheckOnly = args.includes('--check') || args.includes('-c');
  const isAutoYes = args.includes('--yes') || args.includes('-y');
  const isForce = args.includes('--force') || args.includes('-f');

  const positionalArgs = args.filter(a => !a.startsWith('-'));
  const target = cliTarget || positionalArgs[0] || 'all';

  const report = await checkVersions({ target });
  printVersionTable(report);

  if (isCheckOnly) {
    return;
  }

  let shouldProceed = false;

  if (isAutoYes) {
    if (report.hasUpdates || isForce) {
      shouldProceed = true;
    } else {
      console.log('Nothing to update. (Use --force to re-download/re-sync anyway).\n');
      return;
    }
  } else if (!process.stdin.isTTY) {
    // Non-interactive fallback
    if (report.hasUpdates || isForce) {
      console.log('[INFO] Non-interactive environment detected. Proceeding with update...\n');
      shouldProceed = true;
    } else {
      console.log('All components are up to date.\n');
      return;
    }
  } else {
    // Interactive TTY prompt
    if (report.hasUpdates) {
      shouldProceed = await promptConfirmation('Proceed with update?', true);
    } else {
      shouldProceed = await promptConfirmation('Everything is up to date. Force re-download/re-sync anyway?', false);
    }

    if (!shouldProceed) {
      console.log('Update cancelled by user.\n');
      return;
    }
  }

  console.log('\nStarting update...\n');
  if (target === 'skills' || target === 'tools') {
    await syncSkills();
    console.log();
    await syncLinterTools();
  } else if (target === 'mxcli') {
    await syncMxcli();
  } else {
    // 'all' (default: npm run update)
    await syncSkills();
    console.log();
    await syncLinterTools();
    console.log();
    await syncMxcli();
  }
  console.log('\n[PASS] Upstream update complete.');
}

module.exports = {
  syncSkills,
  syncLinterTools,
  syncMxcli,
  checkVersions,
  printVersionTable,
  getLocalMxcliVersion,
  getRemoteMxcliRelease,
  getLocalSkillVersions,
  getRemoteSkillVersions,
  getLocalLinterVersion,
  getRemoteLinterVersion,
  run
};

if (require.main === module) {
  run();
}
