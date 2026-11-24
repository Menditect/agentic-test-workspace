const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  toolsRootDir,
  PASS,
  WARN,
  NOTICE,
  INFO,
  RESTORE,
  ask,
  closeReadline
} = require('./cli-prompt');
const {
  normalizeConfigAliases,
  registerWorkspaceInHub,
  discoverWorkspaceConfigCandidates,
  ensureGitIgnoreEntries,
  formatAuthHeader,
  formatBearerToken,
  ensureExecutionPlanFolders
} = require('./workspace-registry');
const {
  initializeMxcli,
  buildProjectCatalog,
  deployMxcliWrappers
} = require('./mxcli-manager');
const { isPaidMtaServerUrl } = require('./marketplace');
const { generateIdeConfigs } = require('./ide-configs');
const { updateAgentDirectives } = require('./directives');

async function applyWorkspaceConfiguration(state, options = {}) {
  const skipSkills = Boolean(options.skipSkills);
  const nonInteractive = Boolean(options.nonInteractive);
  const existingConfig = state.existingConfig || {};

  // --- SAVING AND CONFIGURATION PERSISTENCE ---
  const mcpSource = state.modelSource === '2' ? 'studiopro' : 'mxcli';
  const workspaceType = 'custom';
  const workspaceDir = path.resolve(state.customWorkspaceDir || path.resolve(toolsRootDir, '..'));

  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true });
  }

  const skillsDir = path.join(toolsRootDir, 'skills');
  const toolsDir = path.join(toolsRootDir, 'tools');
  const skillsStyle = 'standard';

  console.log(`\nWorkspace: App Workspace Directory (${workspaceDir})`);
  console.log(`Central Tools Hub: ${toolsRootDir}`);
  console.log(`Central Skills:    ${skillsDir} (shared, zero-copy)`);
  console.log(`Central Tools:     ${toolsDir} (shared, zero-copy)`);

  const { menditectOutputDir, plansDir } = ensureExecutionPlanFolders(workspaceDir, workspaceType);

  // --- AUTOMATED MODEL-SWITCHING MIGRATION & CLEANUP ---
  // 1. Switching from Standalone Subfolder -> Central Tools Hub: offer to remove local skills/ & tools/ copies
  if (workspaceType === 'custom' && path.resolve(workspaceDir) !== path.resolve(toolsRootDir)) {
    const localSkillsCopy = path.join(workspaceDir, 'skills');
    const localToolsCopy = path.join(workspaceDir, 'tools');
    const localBinCopy = path.join(workspaceDir, 'bin');
    const hasLocalSkills = fs.existsSync(localSkillsCopy);
    const hasLocalTools = fs.existsSync(localToolsCopy);
    if (hasLocalSkills || hasLocalTools) {
      console.log(`\n[MIGRATION] Detected local ${[hasLocalSkills ? 'skills/' : null, hasLocalTools ? 'tools/' : null].filter(Boolean).join(' and ')} inside ${workspaceDir} from a previous Standalone setup.`);
      const cleanAns = nonInteractive ? 'y' : await ask('Remove these redundant local copies so this workspace uses the Central Tools Hub exclusively? (y/n)', 'y', { allowBack: false });
      if (cleanAns.toLowerCase().startsWith('y')) {
        try {
          if (hasLocalSkills) fs.rmSync(localSkillsCopy, { recursive: true, force: true });
          if (hasLocalTools) fs.rmSync(localToolsCopy, { recursive: true, force: true });
          if (fs.existsSync(localBinCopy)) fs.rmSync(localBinCopy, { recursive: true, force: true });
          console.log(`${PASS} Removed redundant local skills/tools copies from ${workspaceDir}.`);
        } catch (e) {
          console.warn(`${WARN} Could not remove all local copies: ${e.message}`);
        }
      }
    }
  }

  // 2. Switching from Direct Mendix Project -> Central Hub
  if (workspaceType === 'custom' && state.projectDir && fs.existsSync(state.projectDir) && path.resolve(state.projectDir) !== path.resolve(workspaceDir)) {
    const mendixCfgPath = path.join(state.projectDir, 'mta_config.json');
    const mendixOutputDir = path.join(state.projectDir, 'menditect-output');
    const mendixMaiaDir = path.join(state.projectDir, 'maia');
    if (fs.existsSync(mendixCfgPath) || fs.existsSync(mendixOutputDir) || fs.existsSync(mendixMaiaDir)) {
      console.log(`\n[MIGRATION] Detected an existing Direct Mendix Project setup in ${state.projectDir}.`);
      const migAns = nonInteractive ? 'y' : await ask(`Migrate execution plans to ${workspaceDir} and clean up MTA config files from the Mendix project folder? (y/n)`, 'y', { allowBack: false });
      if (migAns.toLowerCase().startsWith('y')) {
        try {
          if (fs.existsSync(mendixOutputDir)) {
            fs.cpSync(mendixOutputDir, menditectOutputDir, { recursive: true, force: false });
            fs.rmSync(mendixOutputDir, { recursive: true, force: true });
          }
          if (fs.existsSync(mendixMaiaDir)) {
            const maiaPlans = path.join(mendixMaiaDir, 'plans');
            if (fs.existsSync(maiaPlans)) {
              fs.cpSync(maiaPlans, plansDir, { recursive: true, force: false });
            }
          }
          const filesToClean = ['mta_config.json', 'mta_config.schema.json', '.env', 'mxcli.bat', 'mxcli', 'verify.bat', 'verify'];
          for (const f of filesToClean) {
            const fp = path.join(state.projectDir, f);
            if (fs.existsSync(fp)) fs.unlinkSync(fp);
          }
          const localMendixSkills = path.join(state.projectDir, 'skills');
          if (fs.existsSync(localMendixSkills)) {
            fs.rmSync(localMendixSkills, { recursive: true, force: true });
          }
          console.log(`${PASS} Migrated execution plans to ${workspaceDir} and cleaned up ${state.projectDir}.`);
        } catch (e) {
          console.warn(`${WARN} Partial migration warning: ${e.message}`);
        }
      }
    }
  }

  const mtaAuthHeader = state.rawMtaToken.trim() ? formatAuthHeader(state.rawMtaToken) : '';
  const pluginToken = formatBearerToken(state.rawPluginToken);
  const mtaUrl = state.mtaUrl;
  const mcpEndpoint = mtaUrl ? (mtaUrl.replace(/\/$/, '') + '/primitivetools/mcp') : '';
  const defaultPlaywrightViewerUrl = existingConfig.playwright_viewer_url || 'https://trace.playwright.dev/?trace=';
  const defaultTracefileBaseUrl = existingConfig.tracefile_base_url || (mtaUrl ? `${mtaUrl.replace(/\/$/, '')}/rest/private/tracefile?fileUUID=` : '');
  const defaultDocumentationUrl = existingConfig.documentation_url || 'https://documentation.menditect.com';
  const defaultLlmsTxtUrl = existingConfig.llms_txt_url || `${defaultDocumentationUrl.replace(/\/$/, '')}/llms.txt`;

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

  const isPaidServer = (state.licenseTier === 'paid_enterprise') || isPaidMtaServerUrl(state.mtaUrl);
  state.licenseTier = isPaidServer ? 'paid_enterprise' : 'free_exploratory';
  let normalizedMtaUrl = mtaUrl;
  try {
    if (normalizedMtaUrl) normalizedMtaUrl = new URL(/^https?:\/\//i.test(normalizedMtaUrl) ? normalizedMtaUrl : `https://${normalizedMtaUrl}`).origin;
  } catch {}
  const normalizedMcpEndpoint = normalizedMtaUrl ? `${normalizedMtaUrl}/primitivetools/mcp` : mcpEndpoint;
  const preservedPaidFields = isPaidServer
    ? {
        ...(existingConfig.mta_application_key ? { mta_application_key: existingConfig.mta_application_key } : {}),
        ...(existingConfig.mta_application_instance_key ? { mta_application_instance_key: existingConfig.mta_application_instance_key } : {}),
        ...(existingConfig.mta_test_configuration_key ? { mta_test_configuration_key: existingConfig.mta_test_configuration_key } : {}),
        ...(existingConfig.mta_test_configuration_name ? { mta_test_configuration_name: existingConfig.mta_test_configuration_name } : {}),
        ...(typeof existingConfig.auto_download_and_adapt_on_push === 'boolean' ? { auto_download_and_adapt_on_push: existingConfig.auto_download_and_adapt_on_push } : {}),
        ...(typeof existingConfig.block_mta_mcp_on_revision_mismatch === 'boolean' ? { block_mta_mcp_on_revision_mismatch: existingConfig.block_mta_mcp_on_revision_mismatch } : {}),
        ...(typeof existingConfig.auto_queue_construction_errors_on_adapt === 'boolean' ? { auto_queue_construction_errors_on_adapt: existingConfig.auto_queue_construction_errors_on_adapt } : {}),
        ...(typeof existingConfig.auto_scan_changes_on_adapt === 'boolean' ? { auto_scan_changes_on_adapt: existingConfig.auto_scan_changes_on_adapt } : {}),
        ...(typeof existingConfig.mta_api_polling_interval_seconds === 'number' ? { mta_api_polling_interval_seconds: existingConfig.mta_api_polling_interval_seconds } : {})
      }
    : {};

  const config = {
    $schema: './mta_config.schema.json',
    mta_license_tier: state.licenseTier || existingConfig.mta_license_tier || 'auto',
    workspace_type: workspaceType,
    workspace_dir: workspaceDir,
    skills_dir: skillsDir,
    skills_style: skillsStyle,
    ...(toolsDir ? { tools_root_dir: toolsRootDir, tools_dir: toolsDir } : {}),
    mta_output_path: menditectOutputDir,
    execution_plans_dir: plansDir,
    exploratory_execution_mode: state.exploratoryMode || 'auto_execute',
    mendix_version: state.detectedVersion || '',
    application_name: state.appName,
    mta_base_url: normalizedMtaUrl,
    mcp_endpoint: normalizedMcpEndpoint,
    plugin_mcp_url: state.pluginUrl,
    playwright_viewer_url: defaultPlaywrightViewerUrl,
    tracefile_base_url: defaultTracefileBaseUrl,
    documentation_url: defaultDocumentationUrl,
    llms_txt_url: defaultLlmsTxtUrl,
    app_instances: sanitizedInstances,
    default_app_instance: state.defaultInstanceName,
    default_app_instance_token: state.defaultInstanceToken,
    model_source: mcpSource,
    mendix_project_dir: state.projectDir,
    mendix_mpr_path: state.mprPath,
    ...preservedPaidFields
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
      for (const staleFile of ['mta_config.json', '.env', '.env.local']) {
        const stalePath = path.join(toolsRootDir, staleFile);
        if (fs.existsSync(stalePath)) {
          try { fs.unlinkSync(stalePath); } catch (e) {}
        }
      }
    } catch (e) {}
    registerWorkspaceInHub(workspaceDir);
    console.log(`\nCreated / updated mta_config.json in workspace (${workspaceDir}) (toolsRootDir kept clean)`);
  } else {
    fs.writeFileSync(path.join(toolsRootDir, 'mta_config.json'), JSON.stringify(config, null, 2));
    registerWorkspaceInHub(toolsRootDir);
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

  const mendixPat = process.env.MENDIX_PAT || process.env.MXCLI_PAT || '';
  if (mendixPat) {
    envContent += `MENDIX_PAT="${mendixPat}"\n`;
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
    console.log(`\n${NOTICE} Skipping skills synchronization (--skip-skills specified).`);
  } else {
    console.log('\n--- Menditect Agentic Test Skills Synchronization ---');
    try {
      const { syncSkills } = require('../sync-upstream');
      skillsSyncSuccess = await syncSkills({ config, fastIfCurrent: true });
      if (skillsSyncSuccess) {
        console.log(`${PASS} Upstream skills synchronized successfully into ${skillsDir}.`);
      } else {
        console.warn(`${WARN} Skills synchronization did not complete. You can run "npm run update:skills" later.`);
      }
    } catch (err) {
      console.warn(`${WARN} Could not automatically sync skills: ${err.message}`);
      console.warn(`       You can sync skills manually later via "npm run update:skills".`);
    }
  }

  // Scaffolding & Runners
  initializeMxcli(workspaceDir, state.mprPath, null, { isMendixProject: false });
  deployMxcliWrappers(workspaceDir, state.mprPath);
  if (state.catalogChoice !== 'skip' && state.mprPath && fs.existsSync(state.mprPath)) {
    await buildProjectCatalog(state.mprPath, null, { choice: state.catalogChoice });
  }

  // IDE Configs
  generateIdeConfigs(workspaceDir, mcpSource, state.projectDir, state.mprPath, mtaUrl, state.appName, mtaAuthHeader, pluginToken, state.defaultInstanceToken, state.pluginUrl, state.studioproMcpUrl, workspaceType);

  // Update Agent Directives
  updateAgentDirectives(workspaceDir, state.appName, mtaUrl, skillsStyle, state.appInstances, state.defaultInstanceName, skillsDir, toolsDir);

  console.log('\n======================================================');
  console.log(' Setup completed successfully!');
  console.log(` Workspace configured at: ${workspaceDir}`);
  console.log(` Skills destination:      ${skillsDir}`);
  if (toolsDir) {
    console.log(` Central Tools location:  ${toolsDir}`);
  }
  if (!skipSkills) {
    console.log(` Skills status:           ${skillsSyncSuccess ? 'Synchronized from agentic-test-skills' : 'Pending (run npm run update:skills)'}`);
  }
  console.log(` Default App Instance:    ${state.defaultInstanceName || '(none)'}`);
  console.log(` App Instances Total:     ${state.appInstances.length}`);
  console.log(` Execution plans:         ${plansDir}`);
  console.log('======================================================\n');

  try {
    const { registerWindowsProtocolHandler } = require('../studio-pro-bridge');
    if (registerWindowsProtocolHandler) registerWindowsProtocolHandler();
  } catch (e) {}

  if (nonInteractive) {
    return;
  }

  // Verify Prompt
  console.log('--- Workspace Verification ---');
  console.log(`${WARN} Make sure your app under test is running in Studio Pro when verifying the MCP connection!\n`);
  const doVerify = await ask('Would you like to verify MCP connectivity now? (npm run verify) (y/n)', 'y', { allowBack: false });

  if (doVerify.toLowerCase().startsWith('y')) {
    console.log('\nRunning verification...\n');
    try {
      const verifyScript = path.join(toolsRootDir, 'scripts', 'verify-setup.js');
      execSync(`node "${verifyScript}"`, {
        stdio: 'inherit',
        env: { ...process.env, MTA_CONFIG_PATH: path.join(workspaceDir, 'mta_config.json') }
      });
    } catch (e) {
      console.warn(`\n${NOTICE} Verification completed with warnings or errors. You can rerun anytime via "npm run verify".`);
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

  closeReadline();
}

function runDirectivesOnly() {
  const candidateConfigPaths = discoverWorkspaceConfigCandidates(process.argv[3]);

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
  const toolsDir = config.tools_dir || (config.workspace_type === 'custom' ? path.join(toolsRootDir, 'tools') : null);
  console.log(`${RESTORE} Restoring Menditect Architecture Setup directives in ${workspaceDir}...`);
  updateAgentDirectives(workspaceDir, appName, mtaUrl, skillsStyle, appInstances, defaultInstanceName, skillsDir, toolsDir);
  console.log(`${PASS} Agent directives successfully restored across AGENTS.md, CLAUDE.md, and GEMINI.md.`);
}

module.exports = {
  applyWorkspaceConfiguration,
  runDirectivesOnly
};
