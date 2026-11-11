const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { PASS, WARN } = require('./cli-prompt');
const { ensureGitIgnoreEntries, formatBearerToken } = require('./workspace-registry');
const { findMxcliBinary } = require('./mxcli-manager');

function cleanDeploymentDirectory(projectDir) {
  if (!projectDir || !fs.existsSync(projectDir)) {
    return { success: true, notPresent: true };
  }

  const deploymentDir = path.join(projectDir, 'deployment');
  if (fs.existsSync(deploymentDir)) {
    try {
      fs.rmSync(deploymentDir, { recursive: true, force: true });
      console.log(`  ${PASS} Cleaned deployment directory (${deploymentDir}) to prevent runtime errors with updated modules.`);
      return { success: true, cleaned: true, path: deploymentDir };
    } catch (err) {
      console.warn(`  ${WARN} Could not remove deployment directory (${deploymentDir}): ${err.message}. If Mendix Studio Pro is running the application, stop it and clean the deployment directory before restarting.`);
      return { success: false, error: err.message, path: deploymentDir };
    }
  }
  return { success: true, cleaned: false, notPresent: true, path: deploymentDir };
}

function prepareMendixGitRepo(projectDir) {
  if (!projectDir || !fs.existsSync(projectDir)) {
    return { isGit: false };
  }

  let isGit = false;
  try {
    const gitOut = execSync('git rev-parse --is-inside-work-tree', {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    });
    isGit = gitOut.trim() === 'true';
  } catch (e) {
    isGit = false;
  }

  if (!isGit) {
    return { isGit: false };
  }

  console.log(`Checking Git repository setup in Mendix project (${projectDir})...`);

  const patternsToUntrack = [
    'modules/javasource/*/actions/*',
    'modules/javasource/*/proxies/*',
    'modules/javasource/system/*',
    'javasource/*/actions/*',
    'javasource/*/proxies/*',
    'javasource/system/*'
  ];

  for (const pat of patternsToUntrack) {
    try {
      execSync(`git rm -r --cached --ignore-unmatch "${pat}"`, {
        cwd: projectDir,
        stdio: ['ignore', 'ignore', 'ignore']
      });
    } catch (e) {}
  }

  const gitIgnoreEntries = [
    '/modules/javasource/*/actions/*',
    '/modules/javasource/*/proxies/*',
    '/modules/javasource/system/*',
    '/javasource/*/actions/*',
    '/javasource/*/proxies/*',
    '/javasource/system/*'
  ];

  ensureGitIgnoreEntries(
    projectDir,
    gitIgnoreEntries,
    'Menditect MTA Add-on module Git merge conflict workaround (https://documentation.menditect.com/installation/import-plugin#prepare-git)'
  );

  console.log(`  ${PASS} Prepared Git in Mendix project (untracked generated Java actions/proxies and configured .gitignore).`);
  return { isGit: true, success: true };
}

function isMendixProjectOpenInStudioPro(mprPath, projectDir) {
  if (!mprPath && !projectDir) return { isOpen: false };
  const targetMpr = mprPath ? path.resolve(mprPath).toLowerCase() : '';
  const targetDir = projectDir ? path.resolve(projectDir).toLowerCase() : (targetMpr ? path.dirname(targetMpr) : '');

  if (mprPath) {
    const lockPath = mprPath + '.lock';
    if (fs.existsSync(lockPath)) {
      try {
        const raw = fs.readFileSync(lockPath, 'utf8');
        const data = JSON.parse(raw);
        if (data && data.ProcessId) {
          try {
            process.kill(data.ProcessId, 0);
            return {
              isOpen: true,
              pid: data.ProcessId,
              source: 'lock_file',
              lockPath
            };
          } catch (e) {}
        }
      } catch (e) {}
    }
  }

  if (process.platform === 'win32') {
    try {
      const out = execSync('powershell.exe -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process -Filter \\"Name like \'%studiopro%\'\\" | Select-Object ProcessId, CommandLine | ConvertTo-Json"', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000
      });
      if (out && out.trim()) {
        const parsed = JSON.parse(out.trim());
        const procs = Array.isArray(parsed) ? parsed : [parsed];
        for (const proc of procs) {
          const cmd = (proc.CommandLine || '').toLowerCase();
          if ((targetMpr && cmd.includes(targetMpr)) || (targetDir && cmd.includes(targetDir))) {
            return {
              isOpen: true,
              pid: proc.ProcessId,
              source: 'process_cli',
              commandLine: proc.CommandLine
            };
          }
        }
      }
    } catch (e) {}
  }

  return { isOpen: false };
}

function findMpr(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() && e.name.endsWith('.mpr')) {
        return path.join(dir, e.name);
      }
    }
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

function isVersion1116OrHigher(versionStr) {
  if (!versionStr) return false;
  const parts = versionStr.split('.').map(n => parseInt(n, 10));
  const major = parts[0] || 0;
  const minor = parts[1] || 0;
  if (major > 11) return true;
  if (major === 11 && minor >= 16) return true;
  return false;
}

function detectMendixModule(mendixDir) {
  const candidate = path.join(mendixDir, 'skillssource', '_modules', 'menditect_agentictestskills');
  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    return candidate;
  }
  return null;
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
    const configurationNames = [];

    let afterStartupMicroflow = '';
    const afterStartupMatch = output.match(/AfterStartupMicroflow\s*=\s*'([^']*)'/i);
    if (afterStartupMatch && afterStartupMatch[1]) {
      afterStartupMicroflow = afterStartupMatch[1].trim();
    }

    const configBlockRegex = /(?:create\s+or\s+modify|alter\s+settings)\s+configuration\s+'([^']+)'([\s\S]*?);/gi;
    let cMatch;
    while ((cMatch = configBlockRegex.exec(output)) !== null) {
      const cfgName = cMatch[1];
      if (!configurationNames.includes(cfgName)) {
        configurationNames.push(cfgName);
      }
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
        rawMtaConnectionUrl: '',
        connectionMethod: '',
        connectionUsername: '',
        connectionPassword: '',
        enableMcpServer: '',
        rawMcpServerAccessToken: '',
        runtimeUrl,
        pluginUrl,
        pluginToken: null,
        pluginPort: port || '8081'
      });
    }

    const constRegex = /alter\s+settings\s+constant\s+'([^']+)'\s+value\s+'([^']*)'[\s\S]*?in\s+configuration\s+'([^']+)';/gi;
    let constMatch;
    while ((constMatch = constRegex.exec(output)) !== null) {
      const [_, constantName, rawVal, configName] = constMatch;
      const val = rawVal.trim();
      if (!configurationNames.includes(configName)) {
        configurationNames.push(configName);
      }
      if (!configMap.has(configName)) {
        configMap.set(configName, {
          name: configName,
          token: '',
          mtaUrl: null,
          rawMtaConnectionUrl: '',
          connectionMethod: '',
          connectionUsername: '',
          connectionPassword: '',
          enableMcpServer: '',
          rawMcpServerAccessToken: '',
          runtimeUrl: null,
          pluginUrl: null,
          pluginToken: null,
          pluginPort: '8081'
        });
      }
      const entry = configMap.get(configName);
      const lowerConst = constantName.toLowerCase();
      if (lowerConst.includes('applicationinstancetoken') && val) {
        entry.token = val;
      } else if (lowerConst.includes('mtaconnectionurl') && val) {
        entry.rawMtaConnectionUrl = val;
        entry.mtaUrl = val.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
      } else if (lowerConst.includes('connectionmethod') && val) {
        entry.connectionMethod = val;
      } else if (lowerConst.includes('mtaconnectionusername') && val) {
        entry.connectionUsername = val;
      } else if (lowerConst.includes('mtaconnectionpassword') && val) {
        entry.connectionPassword = val;
      } else if (lowerConst.includes('enablemcpserver') && val) {
        entry.enableMcpServer = val;
      } else if (lowerConst.includes('mcpserveraccesstoken') && val) {
        entry.rawMcpServerAccessToken = val;
        entry.pluginToken = formatBearerToken(val);
      }
    }

    let globalMtaUrl = null;
    let globalRawMtaConnectionUrl = '';
    const globalUrlMatch = output.match(/alter\s+settings\s+constant\s+'(?:[^']+\.)?MTAConnectionUrl'\s+value\s+'([^']*)'/i);
    if (globalUrlMatch && globalUrlMatch[1] && globalUrlMatch[1].trim()) {
      globalRawMtaConnectionUrl = globalUrlMatch[1].trim();
      globalMtaUrl = globalRawMtaConnectionUrl.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
    }

    let globalPluginToken = null;
    let globalRawMcpServerAccessToken = '';
    const globalTokenMatch = output.match(/alter\s+settings\s+constant\s+'(?:[^']+\.)?McpServerAccessToken'\s+value\s+'([^']*)'/i);
    if (globalTokenMatch && globalTokenMatch[1] && globalTokenMatch[1].trim()) {
      globalRawMcpServerAccessToken = globalTokenMatch[1].trim();
      globalPluginToken = formatBearerToken(globalRawMcpServerAccessToken);
    }

    const globalConnectionMethodMatch = output.match(/alter\s+settings\s+constant\s+'(?:[^']+\.)?ConnectionMethod'\s+value\s+'([^']*)'/i);
    const globalConnectionMethod = globalConnectionMethodMatch && globalConnectionMethodMatch[1] ? globalConnectionMethodMatch[1].trim() : '';

    const globalConnectionUsernameMatch = output.match(/alter\s+settings\s+constant\s+'(?:[^']+\.)?MTAConnectionUsername'\s+value\s+'([^']*)'/i);
    const globalConnectionUsername = globalConnectionUsernameMatch && globalConnectionUsernameMatch[1] ? globalConnectionUsernameMatch[1].trim() : '';

    const globalConnectionPasswordMatch = output.match(/alter\s+settings\s+constant\s+'(?:[^']+\.)?MTAConnectionPassword'\s+value\s+'([^']*)'/i);
    const globalConnectionPassword = globalConnectionPasswordMatch && globalConnectionPasswordMatch[1] ? globalConnectionPasswordMatch[1].trim() : '';

    const globalEnableMcpMatch = output.match(/alter\s+settings\s+constant\s+'(?:[^']+\.)?EnableMcpServer'\s+value\s+'([^']*)'/i);
    const globalEnableMcpServer = globalEnableMcpMatch && globalEnableMcpMatch[1] ? globalEnableMcpMatch[1].trim() : '';

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
    let isPluginConfigured = false;
    for (const entry of configMap.values()) {
      if (!entry.mtaUrl && globalMtaUrl) entry.mtaUrl = globalMtaUrl;
      if (!entry.rawMtaConnectionUrl && globalRawMtaConnectionUrl) entry.rawMtaConnectionUrl = globalRawMtaConnectionUrl;
      if (!entry.pluginToken && globalPluginToken) entry.pluginToken = globalPluginToken;
      if (!entry.rawMcpServerAccessToken && globalRawMcpServerAccessToken) entry.rawMcpServerAccessToken = globalRawMcpServerAccessToken;
      if (!entry.connectionMethod && globalConnectionMethod) entry.connectionMethod = globalConnectionMethod;
      if (!entry.connectionUsername && globalConnectionUsername) entry.connectionUsername = globalConnectionUsername;
      if (!entry.connectionPassword && globalConnectionPassword) entry.connectionPassword = globalConnectionPassword;
      if (!entry.enableMcpServer && globalEnableMcpServer) entry.enableMcpServer = globalEnableMcpServer;
      if (!entry.runtimeUrl && globalRuntimeUrl) entry.runtimeUrl = globalRuntimeUrl;
      if (!entry.pluginUrl && globalPluginUrl) entry.pluginUrl = globalPluginUrl;
      if (!entry.pluginPort && globalPort) entry.pluginPort = globalPort;

      if (entry.token) {
        instances.push(entry);
      }
      if (
        entry.token &&
        entry.rawMtaConnectionUrl &&
        entry.connectionMethod &&
        entry.connectionUsername &&
        entry.connectionPassword &&
        entry.enableMcpServer &&
        entry.rawMcpServerAccessToken
      ) {
        isPluginConfigured = true;
      }
    }

    return {
      instances,
      configurationNames,
      afterStartupMicroflow,
      isPluginConfigured,
      globalMtaUrl,
      globalRawMtaConnectionUrl,
      globalPluginToken,
      globalRawMcpServerAccessToken,
      globalConnectionMethod,
      globalConnectionUsername,
      globalConnectionPassword,
      globalEnableMcpServer,
      globalRuntimeUrl,
      globalPluginUrl,
      globalPluginPort: globalPort
    };
  } catch (err) {
    return null;
  }
}

function tryCreateConfigurationInMpr(mprPath, mxcliBin, configName, httpPort = 8081) {
  if (!mprPath || !fs.existsSync(mprPath) || !mxcliBin || !configName) {
    return { success: false, error: 'Missing parameters' };
  }
  const escapeMdlStr = (val) => String(val ?? '').replace(/'/g, "''");
  const safeCfg = escapeMdlStr(configName.trim());
  const tmpMdl = path.join(os.tmpdir(), `mta-create-cfg-${Date.now()}.mdl`);
  try {
    fs.writeFileSync(tmpMdl, `CREATE OR MODIFY CONFIGURATION '${safeCfg}' HttpPortNumber = ${httpPort}, ApplicationRootUrl = 'http://localhost:${httpPort}/';\n`, 'utf8');
    execSync(`"${mxcliBin}" exec "${tmpMdl}" -p "${mprPath}"`, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000
    });
    return { success: true };
  } catch (err) {
    const rawError = (err.stderr ? err.stderr.toString('utf8') : '') || (err.stdout ? err.stdout.toString('utf8') : '') || err.message || '';
    return { success: false, error: rawError.trim() || err.message };
  } finally {
    try { if (fs.existsSync(tmpMdl)) fs.unlinkSync(tmpMdl); } catch (e) {}
  }
}

function configureMtaPluginInMpr(mprPath, mxcliBin, pluginConfig) {
  if (!mprPath || !fs.existsSync(mprPath) || !mxcliBin) {
    return { success: false, error: 'Missing .mpr path or mxcli binary' };
  }

  const escapeMdlStr = (val) => String(val ?? '').replace(/'/g, "''");

  const currentSettings = inspectMendixMtaSettings(mprPath, mxcliBin);
  const existingConfigs = (currentSettings && Array.isArray(currentSettings.configurationNames) && currentSettings.configurationNames.length > 0)
    ? currentSettings.configurationNames
    : [];
  const targetConfigs = pluginConfig.configurationName
    ? [pluginConfig.configurationName]
    : (existingConfigs.length > 0 ? existingConfigs : ['Default']);

  const currentAfterStartup = currentSettings && currentSettings.afterStartupMicroflow
    ? currentSettings.afterStartupMicroflow.trim()
    : '';

  let customAfterStartupMdl = '';
  let targetAfterStartupMicroflow = 'MtaPluginModule.ASU_Setup_Connection_MTA';

  if (currentAfterStartup && currentAfterStartup !== 'MtaPluginModule.ASU_Setup_Connection_MTA') {
    targetAfterStartupMicroflow = currentAfterStartup;
    try {
      const mfOutput = execSync(`"${mxcliBin}" describe microflow "${currentAfterStartup}" -p "${mprPath}"`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 20000
      });
      if (mfOutput && !mfOutput.includes('ASU_Setup_Connection_MTA')) {
        const updatedMf = mfOutput
          .replace(/^create\s+microflow\s+/i, 'create or replace microflow ')
          .replace(/\bbegin\b/i, 'begin\n    call microflow MtaPluginModule.ASU_Setup_Connection_MTA();');
        if (updatedMf.includes('ASU_Setup_Connection_MTA')) {
          customAfterStartupMdl = updatedMf.trim().endsWith(';') ? updatedMf.trim() : `${updatedMf.trim()};`;
        }
      }
    } catch (e) {}
  }

  const appInstanceToken = escapeMdlStr(pluginConfig.applicationInstanceToken || '');
  const mtaConnectionUrl = escapeMdlStr(pluginConfig.mtaConnectionUrl || 'wss://services.menditect.com');
  const connectionMethod = escapeMdlStr(pluginConfig.connectionMethod || 'AfterStartup');
  const connectionUsername = escapeMdlStr(pluginConfig.connectionUsername || '');
  const connectionPassword = escapeMdlStr(pluginConfig.connectionPassword || '');
  const enableMcpServer = escapeMdlStr(pluginConfig.enableMcpServer || 'True');
  const mcpServerAccessToken = escapeMdlStr(pluginConfig.mcpServerAccessToken || '');

  const projectDir = path.dirname(mprPath);
  const addonMxmodulePath = path.join(projectDir, 'modules', 'MtaPluginModule.mxmodule');
  const isAddonModule = fs.existsSync(addonMxmodulePath);

  let existingInternalModule = false;
  try {
    const modulesOutput = execSync(`"${mxcliBin}" -c "SHOW MODULES;" -p "${mprPath}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 25000
    });
    existingInternalModule = /\|\s*MtaPluginModule\s*\|/i.test(modulesOutput);
  } catch (e) {}

  const mdlLines = [
    'CREATE OR REPLACE MODULE MtaPluginModule;',
    "CREATE CONSTANT MtaPluginModule.ApplicationInstanceToken TYPE String DEFAULT '';",
    "CREATE CONSTANT MtaPluginModule.ConnectionMethod TYPE String DEFAULT 'AfterStartup';",
    "CREATE CONSTANT MtaPluginModule.MTAConnectionPassword TYPE String DEFAULT '';",
    "CREATE CONSTANT MtaPluginModule.MTAConnectionUrl TYPE String DEFAULT 'wss://services.menditect.com';",
    "CREATE CONSTANT MtaPluginModule.MTAConnectionUsername TYPE String DEFAULT '';",
    "CREATE CONSTANT MtaPluginModule.EnableMcpServer TYPE Boolean DEFAULT true;",
    "CREATE CONSTANT MtaPluginModule.McpServerAccessToken TYPE String DEFAULT '';",
    'CREATE MICROFLOW MtaPluginModule.ASU_Setup_Connection_MTA () RETURNS Boolean',
    'BEGIN',
    '  RETURN true;',
    'END;'
  ];

  let effectiveConfigs = [];
  let createdConfigs = [];
  for (const cfgName of targetConfigs) {
    const configExists = existingConfigs.some(c => c.toLowerCase() === cfgName.toLowerCase());
    if (!configExists) {
      const createRes = tryCreateConfigurationInMpr(mprPath, mxcliBin, cfgName);
      if (createRes.success) {
        createdConfigs.push(cfgName);
      } else {
        return {
          success: false,
          error: `Configuration '${cfgName}' does not exist in .mpr and could not be created automatically via mxcli: ${createRes.error?.split('\n')[0]}`
        };
      }
    } else {
      const actualName = existingConfigs.find(c => c.toLowerCase() === cfgName.toLowerCase()) || cfgName;
      effectiveConfigs.push(actualName);
    }
  }
  if (createdConfigs.length > 0) {
    effectiveConfigs.push(...createdConfigs);
  }
  effectiveConfigs = Array.from(new Set(effectiveConfigs.filter(Boolean)));
  if (effectiveConfigs.length === 0) {
    return {
      success: false,
      error: 'No target configuration found or created in project settings'
    };
  }

  for (const cfgName of effectiveConfigs) {
    const safeCfg = escapeMdlStr(cfgName);
    mdlLines.push(`ALTER SETTINGS CONSTANT 'MtaPluginModule.ApplicationInstanceToken' VALUE '${appInstanceToken}' IN CONFIGURATION '${safeCfg}';`);
    mdlLines.push(`ALTER SETTINGS CONSTANT 'MtaPluginModule.ConnectionMethod' VALUE '${connectionMethod}' IN CONFIGURATION '${safeCfg}';`);
    mdlLines.push(`ALTER SETTINGS CONSTANT 'MtaPluginModule.MTAConnectionPassword' VALUE '${connectionPassword}' IN CONFIGURATION '${safeCfg}';`);
    mdlLines.push(`ALTER SETTINGS CONSTANT 'MtaPluginModule.MTAConnectionUrl' VALUE '${mtaConnectionUrl}' IN CONFIGURATION '${safeCfg}';`);
    mdlLines.push(`ALTER SETTINGS CONSTANT 'MtaPluginModule.MTAConnectionUsername' VALUE '${connectionUsername}' IN CONFIGURATION '${safeCfg}';`);
    mdlLines.push(`ALTER SETTINGS CONSTANT 'MtaPluginModule.EnableMcpServer' VALUE '${enableMcpServer}' IN CONFIGURATION '${safeCfg}';`);
    mdlLines.push(`ALTER SETTINGS CONSTANT 'MtaPluginModule.McpServerAccessToken' VALUE '${mcpServerAccessToken}' IN CONFIGURATION '${safeCfg}';`);
  }

  if (customAfterStartupMdl) {
    mdlLines.push(customAfterStartupMdl);
  } else if (!currentAfterStartup || currentAfterStartup === 'MtaPluginModule.ASU_Setup_Connection_MTA') {
    mdlLines.push(`ALTER SETTINGS MODEL AfterStartupMicroflow = '${escapeMdlStr(targetAfterStartupMicroflow)}';`);
  }

  if (isAddonModule || !existingInternalModule) {
    mdlLines.push('DROP MODULE MtaPluginModule;');
  }

  const tmpMdlPath = path.join(os.tmpdir(), `mta-plugin-config-${Date.now()}.mdl`);
  try {
    fs.writeFileSync(tmpMdlPath, mdlLines.join('\n') + '\n', 'utf8');
    execSync(`"${mxcliBin}" exec "${tmpMdlPath}" -p "${mprPath}"`, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000
    });
    return {
      success: true,
      configuredConfigurations: effectiveConfigs,
      afterStartupMicroflow: targetAfterStartupMicroflow,
      chainedIntoExistingAfterStartup: Boolean(customAfterStartupMdl)
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  } finally {
    try {
      if (fs.existsSync(tmpMdlPath)) fs.unlinkSync(tmpMdlPath);
    } catch (e) {}
  }
}

module.exports = {
  cleanDeploymentDirectory,
  prepareMendixGitRepo,
  isMendixProjectOpenInStudioPro,
  findMpr,
  detectMendixVersion,
  isVersion1112OrHigher,
  isVersion1116OrHigher,
  detectMendixModule,
  inspectMendixMtaSettings,
  tryCreateConfigurationInMpr,
  configureMtaPluginInMpr
};
