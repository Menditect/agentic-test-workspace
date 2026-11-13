const fs = require('fs');
const path = require('path');
const { toolsRootDir } = require('./cli-prompt');

function normalizeConfigAliases(cfg) {
  if (!cfg || typeof cfg !== 'object') return {};
  const normalized = { ...cfg };
  normalized.mendix_mpr_path = cfg.mendix_mpr_path || cfg.mpr_path || cfg.mprPath || '';
  normalized.mendix_project_dir = cfg.mendix_project_dir || cfg.project_dir || cfg.projectDir || '';
  normalized.mta_base_url = cfg.mta_base_url || cfg.mta_url || cfg.mtaUrl || '';
  normalized.default_app_instance_token = cfg.default_app_instance_token || (cfg.app_instances && cfg.app_instances[0]?.token) || cfg.instance_token || '';
  normalized.execution_plans_dir = cfg.execution_plans_dir || (cfg.mta_output_path ? path.join(cfg.mta_output_path, 'execution-plans') : '');
  normalized.exploratory_execution_mode = cfg.exploratory_execution_mode || cfg.exploratoryExecutionMode || 'auto_execute';
  normalized.playwright_viewer_url = cfg.playwright_viewer_url || cfg.playwrightViewerUrl || '';
  normalized.tracefile_base_url = cfg.tracefile_base_url || cfg.tracefileBaseUrl || cfg.tracefile_url || '';
  let studioProUrl = cfg.studiopro_mcp_url || cfg.studioproMcpUrl || cfg.studio_pro_mcp_url || '';
  if (typeof studioProUrl === 'string') {
    studioProUrl = studioProUrl.replace(/^\[|\]$/g, '').trim();
  }
  normalized.studiopro_mcp_url = studioProUrl;
  normalized.documentation_url = cfg.documentation_url || cfg.documentationUrl || 'https://documentation.menditect.com';
  normalized.llms_txt_url = cfg.llms_txt_url || cfg.llmsTxtUrl || '';
  let rawTier = (cfg.mta_license_tier || cfg.license_tier || cfg.licenseTier || 'auto').toLowerCase();
  if (rawTier === 'exploratory_free' || rawTier === 'free') rawTier = 'free_exploratory';
  if (rawTier === 'paid' || rawTier === 'enterprise') rawTier = 'paid_enterprise';
  normalized.mta_license_tier = rawTier;
  return normalized;
}

function loadEnvFile(filePath, override = false) {
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
        if (override || !process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  } catch (e) {}
}

const hubRegistryPath = path.join(toolsRootDir, '.mxcli', 'workspaces.json');

function registerWorkspaceInHub(workspaceDir) {
  if (!workspaceDir) return;
  try {
    const resolvedWs = path.resolve(workspaceDir);
    const mxcliDir = path.dirname(hubRegistryPath);
    if (!fs.existsSync(mxcliDir)) {
      fs.mkdirSync(mxcliDir, { recursive: true });
    }
    let registry = { active_workspace_dir: resolvedWs, workspaces: [] };
    if (fs.existsSync(hubRegistryPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(hubRegistryPath, 'utf8'));
        if (parsed && Array.isArray(parsed.workspaces)) {
          registry.workspaces = parsed.workspaces;
        }
      } catch (e) {}
    }
    registry.active_workspace_dir = resolvedWs;
    registry.workspaces = [
      resolvedWs,
      ...registry.workspaces.filter(w => {
        try {
          return path.resolve(w) !== resolvedWs && fs.existsSync(path.join(w, 'mta_config.json'));
        } catch (e) {
          return false;
        }
      })
    ];
    fs.writeFileSync(hubRegistryPath, JSON.stringify(registry, null, 2), 'utf8');
  } catch (e) {}
}

function discoverWorkspaceConfigCandidates(explicitArgPath = null) {
  const rawCandidates = [];

  // 1. Explicit CLI argument (folder or mta_config.json path)
  if (explicitArgPath) {
    const resolvedArg = path.resolve(explicitArgPath);
    if (resolvedArg.endsWith('.json')) {
      rawCandidates.push(resolvedArg);
    } else {
      rawCandidates.push(path.join(resolvedArg, 'mta_config.json'));
    }
  }

  // 2. Explicit MTA_CONFIG_PATH env var
  if (process.env.MTA_CONFIG_PATH) {
    rawCandidates.push(path.resolve(process.env.MTA_CONFIG_PATH));
  }

  // 3. Current working directory (if running inside an external workspace)
  if (path.resolve(process.cwd()) !== path.resolve(toolsRootDir)) {
    rawCandidates.push(path.join(process.cwd(), 'mta_config.json'));
  }

  // 4. Central Tools Hub registry (.mxcli/workspaces.json)
  if (fs.existsSync(hubRegistryPath)) {
    try {
      const reg = JSON.parse(fs.readFileSync(hubRegistryPath, 'utf8'));
      if (reg.active_workspace_dir) {
        rawCandidates.push(path.join(reg.active_workspace_dir, 'mta_config.json'));
      }
      if (Array.isArray(reg.workspaces)) {
        for (const ws of reg.workspaces) {
          rawCandidates.push(path.join(ws, 'mta_config.json'));
        }
      }
    } catch (e) {}
  }

  // 5. Global Antigravity mcp_config.json (set by setup.js on every run)
  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  const globalMcpPaths = [
    path.join(homeDir, '.gemini', 'config', 'mcp_config.json'),
    path.join(homeDir, '.gemini', 'antigravity', 'mcp_config.json')
  ];
  for (const gPath of globalMcpPaths) {
    if (fs.existsSync(gPath)) {
      try {
        const gCfg = JSON.parse(fs.readFileSync(gPath, 'utf8'));
        const servers = gCfg.mcpServers || {};
        for (const srv of Object.values(servers)) {
          if (srv && srv.env && srv.env.MTA_CONFIG_PATH) {
            rawCandidates.push(path.resolve(srv.env.MTA_CONFIG_PATH));
          }
        }
      } catch (e) {}
    }
  }

  // 6. Parent directory (Option 2 Standalone Subfolder)
  const parentDir = path.resolve(toolsRootDir, '..');
  rawCandidates.push(path.join(parentDir, 'mta_config.json'));

  // 7. Sibling workspace directories in parentDir (Option 1 Central Tools Hub siblings)
  try {
    const excludedFolders = new Set([path.basename(toolsRootDir).toLowerCase(), 'mta-ai-assistant', 'agentic-test-skills']);
    const entries = fs.readdirSync(parentDir, { withFileTypes: true });
    const siblingConfigs = [];
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !excludedFolders.has(entry.name.toLowerCase())) {
        const candidateCfg = path.join(parentDir, entry.name, 'mta_config.json');
        if (fs.existsSync(candidateCfg)) {
          try {
            const stat = fs.statSync(candidateCfg);
            siblingConfigs.push({ path: candidateCfg, mtimeMs: stat.mtimeMs });
          } catch (e) {}
        }
      }
    }
    siblingConfigs.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const sc of siblingConfigs) {
      rawCandidates.push(sc.path);
    }
  } catch (e) {}

  // 8. Fallback: toolsRootDir/mta_config.json (only if valid)
  rawCandidates.push(path.join(toolsRootDir, 'mta_config.json'));

  // Deduplicate and validate that workspace_dir exists
  const validPaths = [];
  const seen = new Set();
  for (const cp of rawCandidates) {
    if (!cp) continue;
    const resolved = path.resolve(cp);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!fs.existsSync(resolved)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
      if (!parsed || typeof parsed !== 'object') continue;
      if (parsed.workspace_dir) {
        const resolvedWsDir = path.resolve(parsed.workspace_dir);
        if (!fs.existsSync(resolvedWsDir)) continue;
        const targetWsConfig = path.join(resolvedWsDir, 'mta_config.json');
        if (path.resolve(path.dirname(resolved)) === path.resolve(toolsRootDir) && resolvedWsDir !== path.resolve(toolsRootDir)) {
          if (fs.existsSync(targetWsConfig)) {
            const targetKey = process.platform === 'win32' ? targetWsConfig.toLowerCase() : targetWsConfig;
            if (!seen.has(targetKey)) {
              seen.add(targetKey);
              validPaths.push(targetWsConfig);
            }
            continue;
          } else {
            continue;
          }
        }
      }
      validPaths.push(resolved);
    } catch (e) {}
  }

  return validPaths;
}

function ensureGitIgnoreEntries(dirPath, entries, headerText = 'Menditect Agent local environment & secrets') {
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
    const header = currentContent.trimEnd() ? `\n\n# ${headerText}\n` : `# ${headerText}\n`;
    const updated = currentContent.trimEnd() + header + linesToAdd.join('\n') + '\n';
    try {
      fs.writeFileSync(gitIgnorePath, updated, 'utf8');
      console.log(`Protected ${path.relative(process.cwd(), gitIgnorePath) || '.gitignore'}: added [${linesToAdd.join(', ')}]`);
    } catch (e) {
      console.warn(`Warning: Could not update ${gitIgnorePath}: ${e.message}`);
    }
  }
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

function ensureExecutionPlanFolders(targetDir, workspaceType = 'custom') {
  const menditectOutputDir = path.join(targetDir, 'menditect-output');
  const plansDir = path.join(menditectOutputDir, 'execution-plans');
  if (!fs.existsSync(menditectOutputDir)) fs.mkdirSync(menditectOutputDir, { recursive: true });
  if (!fs.existsSync(plansDir)) fs.mkdirSync(plansDir, { recursive: true });
  console.log(`Ensured execution plan folder at:`);
  console.log(`  - ${plansDir}`);
  return { menditectOutputDir, plansDir };
}

module.exports = {
  normalizeConfigAliases,
  loadEnvFile,
  registerWorkspaceInHub,
  discoverWorkspaceConfigCandidates,
  ensureGitIgnoreEntries,
  formatAuthHeader,
  formatBearerToken,
  parseInstanceSelection,
  ensureExecutionPlanFolders
};
