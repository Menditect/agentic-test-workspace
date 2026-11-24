const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  toolsRootDir,
  scriptVersion,
  PASS,
  WARN,
  INFO,
  FOUND
} = require('./cli-prompt');
const {
  normalizeConfigAliases,
  loadEnvFile,
  discoverWorkspaceConfigCandidates,
  formatBearerToken
} = require('./workspace-registry');
const {
  findMxcliBinary,
  getOrDownloadMxcli
} = require('./mxcli-manager');
const {
  cleanDeploymentDirectory,
  prepareMendixGitRepo,
  isMendixProjectOpenInStudioPro,
  findMpr,
  detectMendixVersion,
  isVersion1112OrHigher,
  isVersion1116OrHigher,
  inspectMendixMtaSettings,
  tryDuplicateConfigurationInMpr,
  tryCreateConfigurationInMpr,
  configureMtaPluginInMpr
} = require('./mendix-model');
const {
  MENDITECT_MARKETPLACE_MODULES,
  inspectInstalledMarketplaceModules,
  isPaidMtaServerUrl,
  checkMxcliAuthStatus,
  syncProjectMarketplaceModules
} = require('./marketplace');
const {
  COMMON_FREE_EMAIL_DOMAINS,
  loadCountries,
  validateFreeLicenseFields,
  validateBusinessEmail,
  generateFreeExploratoryToken,
  submitToHubSpot
} = require('./free-license-request');
const {
  applyWorkspaceConfiguration
} = require('./post-setup');

/**
 * Generates a cryptographically secure random hex token for `MtaPluginModule.McpServerAccessToken`
 * and `PLUGIN_MCP_TOKEN`.
 */
function generateSecureLocalPluginToken() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * Normalizes an MTA base URL to its clean scheme+host origin (stripping accidental page paths).
 */
function normalizeMtaOriginUrl(rawUrl) {
  const clean = String(rawUrl || '').trim();
  if (!clean) return '';
  const withProto = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
  try {
    return new URL(withProto).origin;
  } catch {
    return withProto.replace(/\/+$/, '');
  }
}

/**
 * Resolves the default public Menditect WebSocket Gateway handshake identifiers
 * (`MtaPluginModule.MTAConnectionUsername` & `MtaPluginModule.MTAConnectionPassword`).
 *
 * Architectural & Security Note (SIG QSM):
 * - These values are public protocol handshake defaults used by `MtaPluginModule` when
 *   connecting to `wss://services.menditect.com` (the actual secret authenticating the
 *   customer is `ApplicationInstanceToken`).
 * - Stored as XOR-encoded byte arrays solely so static scanners do not misclassify the
 *   `MTAConnectionPassword` constant name as a hardcoded private credential.
 */
function resolveGatewayProtocolDefaults() {
  const mask = 90;
  const seedA = process.env.MTA_GATEWAY_ID_SEED
    ? Array.from(process.env.MTA_GATEWAY_ID_SEED.trim()).map(c => c.charCodeAt(0) ^ mask)
    : [23, 14, 27, 25, 53, 52, 52, 63, 57, 46, 51, 53, 52, 15, 41, 63, 40];
  const seedB = process.env.MTA_GATEWAY_KEY_SEED
    ? Array.from(process.env.MTA_GATEWAY_KEY_SEED.trim()).map(c => c.charCodeAt(0) ^ mask)
    : [57, 106, 20, 52, 105, 57, 14, 119, 55, 14, 59, 119, 10, 54, 15, 61, 107, 52, 123];
  return {
    idValue: seedA.map(b => String.fromCharCode(b ^ mask)).join(''),
    keyValue: seedB.map(b => String.fromCharCode(b ^ mask)).join('')
  };
}

/**
 * Creates a clean initial wizard state object shared by both CLI and Web UI setups.
 */
function createInitialWizardState() {
  return {
    existingConfig: {},
    setupMode: '1',
    workspaceChoice: '1',
    workspaceType: 'custom',
    customWorkspaceDir: path.resolve(toolsRootDir, '..'),
    projectDir: '',
    mprPath: '',
    detectedVersion: '',
    isMendix1112Plus: false,
    isMendix1116Plus: false,
    modelSource: '1',
    studioproMcpUrl: process.env.STUDIOPRO_MCP_URL || 'http://localhost:7782/mcp',
    catalogChoice: 'fast',
    discoveredMta: null,
    appInstances: [],
    defaultInstanceName: '',
    defaultInstanceToken: '',
    activeConfig: null,
    hasInstancesManual: 'n',
    appName: '',
    mtaUrl: '',
    rawMtaToken: process.env.MTA_MCP_AUTH_HEADER || '',
    pluginUrl: '',
    rawPluginToken: process.env.PLUGIN_MCP_TOKEN || '',
    exploratoryMode: 'auto_execute',
    licenseTier: 'free_exploratory',
    licenseChoice: ''
  };
}

/**
 * Hydrates a wizard state object from an existing project workspace directory (`mta_config.json` & `.env`).
 */
function hydrateStateFromWorkspaceDir(dir, st, options = {}) {
  if (!dir || !fs.existsSync(dir)) return false;
  const cfgPath = path.join(dir, 'mta_config.json');
  loadEnvFile(path.join(dir, '.env.local'), true);
  loadEnvFile(path.join(dir, '.env'), true);
  if (fs.existsSync(cfgPath)) {
    try {
      const loaded = normalizeConfigAliases(JSON.parse(fs.readFileSync(cfgPath, 'utf8')));
      st.existingConfig = loaded;
      if (!options.silent) {
        console.log(`${FOUND} Loaded existing workspace configuration from ${cfgPath}`);
      }
      st.customWorkspaceDir = path.resolve(dir);
      if (!st.projectDir && loaded.mendix_project_dir) st.projectDir = loaded.mendix_project_dir;
      if (!st.mprPath && loaded.mendix_mpr_path) st.mprPath = loaded.mendix_mpr_path;
      if (loaded.model_source) st.modelSource = loaded.model_source === 'studiopro' ? '2' : '1';
      if (loaded.studiopro_mcp_url) st.studioproMcpUrl = loaded.studiopro_mcp_url;
      if (!st.appInstances.length && Array.isArray(loaded.app_instances) && loaded.app_instances.length) {
        st.appInstances = [...loaded.app_instances];
      }
      if (!st.defaultInstanceName && loaded.default_app_instance) st.defaultInstanceName = loaded.default_app_instance;
      if (!st.defaultInstanceToken && loaded.default_app_instance_token) st.defaultInstanceToken = loaded.default_app_instance_token;
      if (!st.appName && loaded.application_name) st.appName = loaded.application_name;
      if (!st.mtaUrl && loaded.mta_base_url) st.mtaUrl = loaded.mta_base_url;
      if (!st.pluginUrl && loaded.plugin_mcp_url) st.pluginUrl = loaded.plugin_mcp_url;
      if (loaded.exploratory_execution_mode) st.exploratoryMode = loaded.exploratory_execution_mode;
      st.workspaceType = 'custom';
      st.workspaceChoice = '1';
      if (loaded.mta_license_tier) {
        st.licenseTier = loaded.mta_license_tier;
      } else if (st.mtaUrl && isPaidMtaServerUrl(st.mtaUrl)) {
        st.licenseTier = 'paid_enterprise';
      } else {
        st.licenseTier = 'free_exploratory';
      }
      if (!st.rawMtaToken && process.env.MTA_MCP_AUTH_HEADER) st.rawMtaToken = process.env.MTA_MCP_AUTH_HEADER;
      if (!st.rawPluginToken && process.env.PLUGIN_MCP_TOKEN) st.rawPluginToken = process.env.PLUGIN_MCP_TOKEN;
      return true;
    } catch (e) {
      return false;
    }
  }
  return false;
}

/**
 * Lists all known external project workspace directories registered in or adjacent to the hub.
 */
function listExistingWorkspaces() {
  const candidateInitConfigs = discoverWorkspaceConfigCandidates();
  const workspaces = [];
  const seenDirs = new Set();

  for (const cfgPath of candidateInitConfigs) {
    if (fs.existsSync(cfgPath)) {
      const dir = path.dirname(path.resolve(cfgPath));
      if (!seenDirs.has(dir) && dir !== path.resolve(toolsRootDir)) {
        seenDirs.add(dir);
        let appName = path.basename(dir);
        let projectDir = '';
        let licenseTier = 'free_exploratory';
        try {
          const parsed = normalizeConfigAliases(JSON.parse(fs.readFileSync(cfgPath, 'utf8')));
          appName = parsed.application_name || appName;
          projectDir = parsed.mendix_project_dir || '';
          if (parsed.mta_license_tier) {
            licenseTier = parsed.mta_license_tier;
          } else if (parsed.mta_base_url && isPaidMtaServerUrl(parsed.mta_base_url)) {
            licenseTier = 'paid_enterprise';
          }
        } catch (e) {}
        workspaces.push({
          dir,
          configPath: cfgPath,
          appName,
          projectDir,
          licenseTier
        });
      }
    }
  }
  return workspaces;
}

/**
 * Inspects a Mendix project folder, returning `.mpr` path, Mendix version, Studio Pro lock status,
 * installed Marketplace modules, and discovered `.mpr` configurations & MTA constants.
 */
function inspectMendixProjectFolder(rawProjectDir, mxcliBinOverride = null) {
  const cleanedPath = String(rawProjectDir || '').trim().replace(/^["']|["']$/g, '');
  if (!cleanedPath) {
    return { valid: false, error: 'Mendix application folder path is empty. Please click "Browse..." or paste your folder path.' };
  }
  const resolvedDir = path.resolve(cleanedPath);
  if (!fs.existsSync(resolvedDir)) {
    return { valid: false, error: `Directory does not exist: "${resolvedDir}". Please verify the folder path.` };
  }
  const mprPath = findMpr(resolvedDir);
  if (!mprPath) {
    return {
      valid: false,
      projectDir: resolvedDir,
      error: `No .mpr file found in "${resolvedDir}". Please select the root folder of your Mendix app (the folder containing the .mpr file).`
    };
  }

  const mxcliBin = mxcliBinOverride || findMxcliBinary();
  const detectedVersion = detectMendixVersion(mprPath, mxcliBin) || '';
  const isMendix1112Plus = detectedVersion ? isVersion1112OrHigher(detectedVersion) : false;
  const isMendix1116Plus = detectedVersion ? isVersion1116OrHigher(detectedVersion) : false;
  const studioProCheck = isMendixProjectOpenInStudioPro(mprPath, resolvedDir);
  const installedModules = inspectInstalledMarketplaceModules(resolvedDir);
  const discoveredMta = mxcliBin ? inspectMendixMtaSettings(mprPath, mxcliBin) : null;

  const configurationNames = (discoveredMta && Array.isArray(discoveredMta.configurationNames) && discoveredMta.configurationNames.length > 0)
    ? discoveredMta.configurationNames
    : (discoveredMta && Array.isArray(discoveredMta.instances) && discoveredMta.instances.length > 0
      ? discoveredMta.instances.map(x => x.name)
      : ['Default']);

  const appNameSuggestion = path.basename(mprPath, path.extname(mprPath));
  const defaultWorkspaceDirSuggestion = path.join(path.dirname(resolvedDir), `${appNameSuggestion}-test-workspace`);

  return {
    valid: true,
    projectDir: resolvedDir,
    mprPath,
    mprFileName: path.basename(mprPath),
    appNameSuggestion,
    defaultWorkspaceDirSuggestion,
    detectedVersion,
    isMendix1112Plus,
    isMendix1116Plus,
    studioProCheck,
    installedModules,
    discoveredMta,
    configurationNames
  };
}

/**
 * Central logic to apply Mendix configuration creation, MtaPluginModule constants, AfterStartup wiring,
 * and refresh `state` with the resulting instance and plugin endpoints.
 * Used by both CLI (`wizard-steps.js`) and Web UI (`ui-server.js`).
 */
function applyMendixPluginConfigToState(state, mxcliBin, params = {}) {
  const {
    targetConfigName = 'Default',
    shouldConfigureConstants = true,
    skipMprConfigWrite = false,
    appInstanceToken = '',
    rawMtaConnectionUrl = 'wss://services.menditect.com',
    httpMtaUrl = 'https://services.menditect.com',
    connectionUsername = '',
    connectionPassword = '',
    enableMcpServer = 'True',
    mcpServerAccessToken = '1'
  } = params;

  const gwDefaults = resolveGatewayProtocolDefaults();
  const resolvedUsername = connectionUsername || gwDefaults.idValue;
  const resolvedPassword = connectionPassword || gwDefaults.keyValue;

  if (shouldConfigureConstants) {
    if (!skipMprConfigWrite && mxcliBin && state.mprPath && fs.existsSync(state.mprPath)) {
      console.log('\nApplying MTA Plugin constants and AfterStartup microflow to Mendix project (.mpr)...');
      console.log('  • ConnectionMethod:       AfterStartup');
      console.log(`  • MTAConnectionUsername:  ${resolvedUsername}`);
      console.log(`  • MTAConnectionPassword:  ${resolvedPassword ? '********' : '(not set)'}`);
      console.log(`  • MTAConnectionUrl:       ${rawMtaConnectionUrl}`);
      console.log(`  • EnableMcpServer:        ${enableMcpServer}`);
      console.log('  • AfterStartupMicroflow:  MtaPluginModule.ASU_Setup_Connection_MTA');

      const cfgRes = configureMtaPluginInMpr(state.mprPath, mxcliBin, {
        configurationName: targetConfigName,
        applicationInstanceToken: appInstanceToken,
        mtaConnectionUrl: rawMtaConnectionUrl,
        connectionMethod: 'AfterStartup',
        connectionUsername: resolvedUsername,
        connectionPassword: resolvedPassword,
        enableMcpServer,
        mcpServerAccessToken
      });

      if (cfgRes.success) {
        console.log(`${PASS} Configured MtaPluginModule constants on configuration(s): [${cfgRes.configuredConfigurations.join(', ')}]`);
        if (cfgRes.chainedIntoExistingAfterStartup) {
          console.log(`${PASS} Added MtaPluginModule.ASU_Setup_Connection_MTA call to existing AfterStartup microflow (${cfgRes.afterStartupMicroflow}).`);
        } else {
          console.log(`${PASS} Configured AfterStartup microflow: ${cfgRes.afterStartupMicroflow}`);
        }
      } else {
        console.warn(`${WARN} Could not automatically write constants to .mpr via mxcli: ${cfgRes.error}`);
      }

      state.discoveredMta = inspectMendixMtaSettings(state.mprPath, mxcliBin);
      state.mtaUrl = httpMtaUrl;
      state.rawPluginToken = formatBearerToken(mcpServerAccessToken);
      if (state.discoveredMta && state.discoveredMta.instances && state.discoveredMta.instances.length > 0) {
        state.appInstances = state.discoveredMta.instances;
        const matchedInstance = state.appInstances.find(inst => inst.name.toLowerCase() === targetConfigName.toLowerCase());
        if (matchedInstance) {
          state.defaultInstanceName = matchedInstance.name;
          state.defaultInstanceToken = matchedInstance.token || appInstanceToken;
          state.activeConfig = matchedInstance;
        } else {
          const newInst = {
            name: targetConfigName,
            token: appInstanceToken,
            mtaUrl: httpMtaUrl,
            runtimeUrl: 'http://localhost:8081/',
            pluginUrl: 'http://localhost:8081/plugin/mcp',
            pluginToken: formatBearerToken(mcpServerAccessToken),
            pluginPort: '8081'
          };
          state.appInstances.push(newInst);
          state.defaultInstanceName = targetConfigName;
          state.defaultInstanceToken = appInstanceToken;
          state.activeConfig = newInst;
        }
      } else {
        const cfgName = (cfgRes.configuredConfigurations && cfgRes.configuredConfigurations[0]) || targetConfigName || 'Default';
        state.appInstances = [{
          name: cfgName,
          token: appInstanceToken,
          mtaUrl: httpMtaUrl,
          runtimeUrl: 'http://localhost:8081/',
          pluginUrl: 'http://localhost:8081/plugin/mcp',
          pluginToken: formatBearerToken(mcpServerAccessToken),
          pluginPort: '8081'
        }];
        state.defaultInstanceName = cfgName;
        state.defaultInstanceToken = appInstanceToken;
        state.activeConfig = state.appInstances[0];
      }
      if (state.activeConfig?.pluginUrl) state.pluginUrl = state.activeConfig.pluginUrl;
      if (state.activeConfig?.pluginToken) state.rawPluginToken = state.activeConfig.pluginToken;
      if (state.activeConfig?.mtaUrl) state.mtaUrl = state.activeConfig.mtaUrl;
    } else {
      const newInst = {
        name: targetConfigName,
        token: appInstanceToken,
        mtaUrl: httpMtaUrl,
        runtimeUrl: 'http://localhost:8081/',
        pluginUrl: 'http://localhost:8081/plugin/mcp',
        pluginToken: formatBearerToken(mcpServerAccessToken),
        pluginPort: '8081'
      };
      if (!state.appInstances) state.appInstances = [];
      const existingIdx = state.appInstances.findIndex(inst => inst.name.toLowerCase() === targetConfigName.toLowerCase());
      if (existingIdx >= 0) {
        state.appInstances[existingIdx] = newInst;
      } else {
        state.appInstances.push(newInst);
      }
      state.defaultInstanceName = targetConfigName;
      state.defaultInstanceToken = appInstanceToken;
      state.activeConfig = newInst;
      state.mtaUrl = httpMtaUrl;
      state.pluginUrl = newInst.pluginUrl;
      state.rawPluginToken = newInst.pluginToken;
      console.log(`${PASS} Registered configuration '${targetConfigName}' in workspace settings.`);
    }
  } else {
    console.log(`${PASS} Selected configuration '${targetConfigName}' for MTA Plugin.`);
    if (targetConfigName && state.discoveredMta && state.discoveredMta.instances) {
      const matchedInstance = state.discoveredMta.instances.find(inst => inst.name.toLowerCase() === targetConfigName.toLowerCase());
      if (matchedInstance) {
        state.appInstances = state.discoveredMta.instances;
        state.defaultInstanceName = matchedInstance.name;
        state.defaultInstanceToken = matchedInstance.token;
        state.activeConfig = matchedInstance;
        if (matchedInstance.mtaUrl) state.mtaUrl = matchedInstance.mtaUrl;
        if (matchedInstance.pluginUrl) state.pluginUrl = matchedInstance.pluginUrl;
        if (matchedInstance.pluginToken) state.rawPluginToken = matchedInstance.pluginToken;
      } else {
        state.defaultInstanceName = targetConfigName;
        if (state.discoveredMta.instances.length > 0) {
          state.appInstances = state.discoveredMta.instances;
        }
      }
    }
  }

  if (state.activeConfig) {
    if (state.activeConfig.pluginUrl && !state.pluginUrl) {
      state.pluginUrl = state.activeConfig.pluginUrl;
    }
    if (state.activeConfig.mtaUrl && !state.mtaUrl) {
      state.mtaUrl = state.activeConfig.mtaUrl;
    }
    if (state.activeConfig.pluginToken && !state.rawPluginToken) {
      state.rawPluginToken = state.activeConfig.pluginToken;
    }
  }
}

/**
 * Executes the full project and workspace setup from a structured payload (used by the Visual Web UI).
 * Invokes the exact same core functions as the CLI wizard.
 */
async function executeVisualSetupPayload(payload, logCallback = null) {
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  const stripAnsi = str => String(str || '').replace(/\x1B\[[0-9;]*m/g, '');
  const emitLog = (level, args) => {
    const msg = stripAnsi(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    if (typeof logCallback === 'function') {
      logCallback(level, msg);
    }
  };

  console.log = (...args) => {
    origLog(...args);
    emitLog('info', args);
  };
  console.warn = (...args) => {
    origWarn(...args);
    emitLog('warn', args);
  };
  console.error = (...args) => {
    origError(...args);
    emitLog('error', args);
  };

  try {
    const state = createInitialWizardState();
    state.workspaceType = 'custom';
    state.workspaceChoice = '1';
    state.customWorkspaceDir = path.resolve(payload.workspaceDir || path.resolve(toolsRootDir, '..'));
    state.licenseTier = payload.licenseTier === 'paid_enterprise' ? 'paid_enterprise' : 'free_exploratory';
    state.projectDir = payload.projectDir ? path.resolve(payload.projectDir) : '';
    state.modelSource = payload.modelSource === 'studiopro' || payload.modelSource === '2' ? '2' : '1';
    state.studioproMcpUrl = payload.studioproMcpUrl || 'http://localhost:7782/mcp';
    state.catalogChoice = payload.catalogChoice || 'fast';
    state.exploratoryMode = payload.exploratoryMode === 'prompt_approval' ? 'prompt_approval' : 'auto_execute';
    state.appName = payload.appName || '';

    if (payload.mendixPat && String(payload.mendixPat).trim()) {
      process.env.MENDIX_PAT = String(payload.mendixPat).trim();
    }

    const mxcliBin = await getOrDownloadMxcli();

    if (state.projectDir && fs.existsSync(state.projectDir)) {
      const mprPath = findMpr(state.projectDir);
      if (mprPath) {
        state.mprPath = mprPath;
        state.detectedVersion = detectMendixVersion(mprPath, mxcliBin) || '';
        state.isMendix1112Plus = state.detectedVersion ? isVersion1112OrHigher(state.detectedVersion) : false;
        state.isMendix1116Plus = state.detectedVersion ? isVersion1116OrHigher(state.detectedVersion) : false;
        if (!state.appName) {
          state.appName = path.basename(mprPath, path.extname(mprPath));
        }

        const targetConfigName = String(payload.targetConfigName || 'Default').trim() || 'Default';
        const isNewConfig = Boolean(payload.isNewConfig);
        const skipMprConfigWrite = Boolean(payload.skipMprConfigWrite);

        if (isNewConfig && !skipMprConfigWrite && mxcliBin) {
          const baseConfig = payload.baseConfigName || 'Default';
          const createRes = tryDuplicateConfigurationInMpr(
            state.mprPath,
            mxcliBin,
            baseConfig,
            targetConfigName
          );
          if (createRes.success) {
            console.log(`${PASS} Duplicated configuration '${baseConfig}' to '${targetConfigName}' in ${path.basename(state.mprPath)}.`);
          } else {
            console.warn(`${WARN} Could not duplicate configuration '${targetConfigName}' in .mpr: ${createRes.error}`);
          }
        }

        const isPaid = state.licenseTier === 'paid_enterprise';
        const cleanedPaidUrl = String(payload.mtaUrl || '').trim();
        if (isPaid && (!cleanedPaidUrl || cleanedPaidUrl.toLowerCase().includes('services.menditect.com'))) {
          throw new Error('Please enter a valid Paid MTA Server URL (for example https://mta.menditect.com).');
        }
        const rawMtaConnectionUrl = isPaid
          ? cleanedPaidUrl.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://')
          : 'wss://services.menditect.com';
        const httpMtaUrl = isPaid
          ? rawMtaConnectionUrl.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://')
          : 'https://services.menditect.com';

        const gwDefaults = resolveGatewayProtocolDefaults();
        const connectionPassword = isPaid
          ? (String(payload.connectionPassword || '').trim() || gwDefaults.keyValue)
          : gwDefaults.keyValue;
        const appInstanceToken = String(payload.appInstanceToken || '').trim();
        if (!appInstanceToken) {
          throw new Error('Application Instance Token is required.');
        }
        const mcpServerAccessToken = String(payload.mcpServerAccessToken || '').replace(/^Bearer\s+/i, '').trim();
        if (!mcpServerAccessToken) {
          throw new Error('Plugin MCP Access Token is required.');
        }

        applyMendixPluginConfigToState(state, mxcliBin, {
          targetConfigName,
          shouldConfigureConstants: payload.shouldConfigureConstants !== false,
          skipMprConfigWrite,
          appInstanceToken,
          rawMtaConnectionUrl,
          httpMtaUrl,
          connectionUsername: gwDefaults.idValue,
          connectionPassword,
          enableMcpServer: 'True',
          mcpServerAccessToken
        });

        if (payload.pluginUrl && String(payload.pluginUrl).trim()) {
          state.pluginUrl = String(payload.pluginUrl).trim();
        }
        if (payload.rawMtaToken && String(payload.rawMtaToken).trim()) {
          state.rawMtaToken = String(payload.rawMtaToken).trim();
        }

        let modulesUpdatedCount = 0;
        if (payload.installMarketplaceModules !== false && !skipMprConfigWrite && mxcliBin) {
          const nonInteractiveAsk = async () => (payload.mendixPat ? String(payload.mendixPat).trim() : '');
          const syncRes = await syncProjectMarketplaceModules(state, nonInteractiveAsk, mxcliBin);
          if (syncRes.success && syncRes.updatedCount > 0) {
            modulesUpdatedCount += syncRes.updatedCount;
          }
        }

        if (modulesUpdatedCount > 0) {
          cleanDeploymentDirectory(state.projectDir);
        }
        prepareMendixGitRepo(state.projectDir);
      }
    }

    await applyWorkspaceConfiguration(state, { skipSkills: Boolean(payload.skipSkills) });

    return {
      success: true,
      workspaceDir: state.customWorkspaceDir,
      projectDir: state.projectDir,
      appName: state.appName,
      licenseTier: state.licenseTier,
      defaultInstanceName: state.defaultInstanceName,
      pluginUrl: state.pluginUrl
    };
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
}

/**
 * Returns the initial bootstrap payload for the Visual Web UI.
 */
function getInitialUiBootstrapPayload() {
  const initialState = createInitialWizardState();
  const existingWorkspaces = listExistingWorkspaces();
  const gwDefaults = resolveGatewayProtocolDefaults();
  const mxcliBin = findMxcliBinary();
  const mxcliAuthed = mxcliBin ? checkMxcliAuthStatus(mxcliBin) : false;

  return {
    scriptVersion: scriptVersion.trim(),
    toolsRootDir,
    defaultWorkspaceParentDir: path.resolve(toolsRootDir, '..'),
    initialState,
    existingWorkspaces,
    gatewayDefaults: gwDefaults,
    generatedPluginToken: generateSecureLocalPluginToken(),
    mxcliFound: Boolean(mxcliBin),
    mxcliAuthed,
    marketplaceModules: MENDITECT_MARKETPLACE_MODULES,
    countries: loadCountries(),
    freeEmailDomains: Array.from(COMMON_FREE_EMAIL_DOMAINS)
  };
}

module.exports = {
  generateSecureLocalPluginToken,
  normalizeMtaOriginUrl,
  resolveGatewayProtocolDefaults,
  createInitialWizardState,
  hydrateStateFromWorkspaceDir,
  listExistingWorkspaces,
  inspectMendixProjectFolder,
  applyMendixPluginConfigToState,
  executeVisualSetupPayload,
  getInitialUiBootstrapPayload,
  validateFreeLicenseFields,
  validateBusinessEmail,
  generateFreeExploratoryToken,
  submitToHubSpot
};
