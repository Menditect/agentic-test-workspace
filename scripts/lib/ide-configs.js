const fs = require('fs');
const path = require('path');
const { toolsRootDir } = require('./cli-prompt');

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

function generateIdeConfigs(workspaceDir, mcpSource, projectDir, mprPath, mtaUrl, appName, mtaAuthHeader, pluginToken, defaultInstanceToken, pluginUrl, studioproMcpUrl, workspaceType = 'custom') {
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

  const linterMcpScriptPath = isToolsWorkspace
    ? '${workspaceFolder}/scripts/mta-lint-mcp.js'
    : (isParentWorkspace
      ? `\${workspaceFolder}/${toolsDirName}/scripts/mta-lint-mcp.js`
      : path.join(toolsRootDir, 'scripts', 'mta-lint-mcp.js').replace(/\\/g, '/'));

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
    },
    "mta_linter": {
      "command": "node",
      "args": [linterMcpScriptPath, "--stdio"],
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
  const outputPath = workspaceType === 'mendix_project'
    ? "${workspaceFolder}/maia/plans"
    : "${workspaceFolder}/menditect-output";
  const envVars = {
    "MENDIX_PROJECT_PATH": projectDir || "",
    "MENDIX_MPR_FILE": mprPath || "",
    "MENDIX_APP_NAME": appName || "",
    "MTA_BASE_URL": mtaUrl || "",
    "MTA_APP_INSTANCE_TOKEN": defaultInstanceToken || "",
    "MTA_OUTPUT_PATH": outputPath
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

  // 3. Cursor .cursor/mcp.json (merge servers) and .cursor/hooks.json
  mergeJsonFile(path.join(workspaceDir, '.cursor', 'mcp.json'), (existing) => {
    return {
      ...existing,
      mcpServers: {
        ...(existing.mcpServers || {}),
        ...newMcpServers
      }
    };
  });

  const hookGateRelPath = isToolsWorkspace
    ? 'tools/mta-hook-gate.mjs'
    : (isParentWorkspace
      ? `${toolsDirName}/tools/mta-hook-gate.mjs`
      : path.join(toolsRootDir, 'tools', 'mta-hook-gate.mjs').replace(/\\/g, '/'));
  const hookCommand = `node "${hookGateRelPath}"`;
  const hookSpec = {
    "SessionStart": [
      {
        "matcher": ".*",
        "hooks": [
          { "type": "command", "command": hookCommand }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "call_mcp_tool|mcp_mta.*|mcp_MTA.*|write_file|write_to_file|edit_file|replace_file_content|multi_replace_file_content|run_command|execute_command|Bash",
        "hooks": [
          { "type": "command", "command": hookCommand }
        ]
      }
    ]
  };

  mergeJsonFile(path.join(workspaceDir, '.agent', 'hooks.json'), (existing) => ({
    ...existing,
    hooks: { ...(existing.hooks || {}), ...hookSpec }
  }));

  mergeJsonFile(path.join(workspaceDir, '.cursor', 'hooks.json'), (existing) => ({
    ...existing,
    hooks: { ...(existing.hooks || {}), ...hookSpec }
  }));

  // 4. Claude .claude/settings.json (merge mcpServers and hooks while preserving permissions and other settings)
  mergeJsonFile(path.join(workspaceDir, '.claude', 'settings.json'), (existing) => {
    const updated = {
      ...existing,
      mcpServers: {
        ...(existing.mcpServers || {}),
        ...newMcpServers
      },
      hooks: {
        ...(existing.hooks || {}),
        ...hookSpec
      }
    };
    if (!isToolsWorkspace) {
      const existingPerms = existing.permissions || {};
      const existingDirs = Array.isArray(existingPerms.additionalDirectories) ? existingPerms.additionalDirectories : [];
      const normalizedToolsDir = toolsRootDir.replace(/\\/g, '/');
      if (!existingDirs.some(d => path.resolve(d) === path.resolve(toolsRootDir))) {
        updated.permissions = {
          ...existingPerms,
          additionalDirectories: [...existingDirs, normalizedToolsDir]
        };
      }
    }
    return updated;
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

module.exports = {
  mergeJsonFile,
  generateIdeConfigs
};
