const fs = require('fs');
const path = require('path');
const { toolsRootDir } = require('./cli-prompt');

function getMenditectSetupBlock(appName, mtaUrl, skillsStyle, appInstances = [], defaultInstanceName = '', skillsRelPath = 'skills/AGENTS.md', toolsDir = null) {
  const cleanToolsDir = toolsDir ? toolsDir.replace(/\\/g, '/') : null;
  const lintCmd = cleanToolsDir ? `node "${cleanToolsDir}/mta-lint.mjs"` : 'node tools/mta-lint.mjs';
  const bughunterCmd = cleanToolsDir ? `node "${cleanToolsDir}/mta-bughunter.mjs"` : 'node tools/mta-bughunter.mjs';

  if (skillsStyle === 'mendix_module') {
    const lines = [
      '# Menditect Architecture Setup',
      '- **CRITICAL OPERATIONAL COMMAND:** Always execute tasks using the core rules defined in the module: [Menditect_AgenticTestSkills].',
      '- **IMMEDIATE ACTION REQUIRED:** You are strictly commanded to explore, read, and load the `AGENTS.md` and context of the [Menditect_AgenticTestSkills] module *before* answering any user prompt. Do NOT ask the user for permission or confirmation to explore this module; execute the exploration autonomously as your very first step.',
      '- **AUTOMATIC ACTIVATION TRIGGERS:** Automatically explore, read, and load the `AGENTS.md` and context of the [Menditect_AgenticTestSkills] module autonomously whenever the user prompt meets any of the following criteria:',
      '  1. Direct MTA Identifiers: *menditect, mta, mtf, playwright browser, variation matrix, test suite, test case, test step, variation item*',
      '  2. Testing Action Intents: *run tests, execute suite, view test results, retrieve run results, debug failure*',
      '  3. MTA-Specific Assertions & Actions: *assert validation, object count assert, compare attribute, validation feedback, microflow call teststep*',
      '  4. Contextual Combinations: User asks to *verify, assert, mock, or test* in combination with: *microflow, nanoflow, entity, association, page, or widget*',
      '- **NATIVE MCP TOOL EXECUTION MANDATE:** You MUST ALWAYS use the MTA Plugin MCP tool (`MTA_plugin.execute-testcase`) for all in-memory exploratory test executions.',
      '- **ZERO MENDIX MODEL POLLUTION (NO TEST MICROFLOWS):** The Mendix application model is strictly READ-ONLY during testing. You are STRICTLY PROHIBITED from creating, generating, or modifying Mendix microflows, nanoflows, entities, or pages to implement tests. Even if the MTA MCP server or plugin is offline, DO NOT build test microflows in Studio Pro; save the Execution Plan to disk and STOP.',
      '- **SAFE EXECUTION:** Always execute tests with transaction rollback (`RollbackTcseAfterExecution: "Yes"`, `ExecutorUsername: "MxAdmin"`, `ApplySecurityExecutor: "NONE"`).',
      '- **EXECUTION STRATEGY SEGREGATION:**',
      '  1. **IN-MEMORY EXPLORATORY (Plugin):** Allowed to auto_execute ONLY when using MTA_plugin.execute-testcase (zero database mutation, safe rollback) and MAIA Plan Mode is disabled.',
      '  2. **MAIA PLAN MODE (Mendix 11.16+):** Treated as `prompt_approval`. Auto-execution is strictly prohibited. MAIA can write `.md` execution plan files to disk and MUST write the plan adhering to the canonical 6-section format (`references/execution-plan-template.md`).',
      '  3. **PERSISTENT MTA PLATFORM MUTATIONS:** STRICTLY PROHIBITED from auto-executing. Before calling ANY mutating MTA server tools (CreateTestSuite, CreateTestCase, CreateObjectActionTestStep, etc.), the agent MUST pause and receive explicit, unambiguous user approval for Checkpoint 1 (Execution Plan) and Checkpoint 2 (Placement Summary). Never bypass this gate based on automated linter passes or context compaction summaries.',
      '- **MTA LICENSE TIER & CAPABILITIES:**',
      '  * If `MTA` MCP server is not configured and `MtaPluginModule.MTAConnectionUrl` is `wss://services.menditect.com`, the user is operating under the **Free MTA Exploratory License**.',
      '  * **Free Capabilities:** Unlimited local in-memory microflow testing (`execute-testcase`) and local Execution Plan generation (`EP_*.md`).',
      '  * **Paid Platform Capabilities:** Persistent test suites, Playwright Frontend UI testing, and CI/CD automated regression pipelines require a paid MTA Platform License.',
      '- **ENVIRONMENT CONFIGURATION & LINTER RECOMMENDATION:** All runtime settings (Application Name, MTA Base URL, Active App Instances, ApplicationInstanceTokens, and Playwright preferences) must be loaded dynamically from `mta_config.json` (or via `MTA_linter.get_config()` in Chat Mode / MAIA). For the highest test reliability and automated plan validation, running the local `MTA_linter` MCP server (`http://localhost:7790/mcp`) is strongly recommended. Never bake hardcoded tokens or URLs into prompt text or test files.'
    ];

    return lines.join('\n');
  }

  const lines = [
    '# Menditect Architecture Setup',
    `- **CRITICAL OPERATIONAL COMMAND:** Always execute tasks using the core rules defined in \`${skillsRelPath}\`.`
  ];
  if (cleanToolsDir) {
    lines.push(`- **CENTRAL TOOLS HUB LOCATION:** MTA skills reside at \`${path.dirname(skillsRelPath).replace(/\\/g, '/')}/\` and MTA CLI tools reside at \`${cleanToolsDir}/\`. Whenever any skill instructs you to run \`node tools/mta-lint.mjs\` or \`node tools/mta-bughunter.mjs\`, execute them from the central tools path: \`${lintCmd}\` and \`${bughunterCmd}\`.`);
  }
  lines.push(
    '- **ENVIRONMENT CONFIGURATION & LINTER RECOMMENDATION:** All runtime settings (Application Name, MTA Base URL, Active App Instances, ApplicationInstanceTokens, and Playwright preferences) must be loaded dynamically from `mta_config.json` (or via `MTA_linter.get_config()` in Chat Mode / MAIA). For the highest test reliability and automated plan validation, running the local `MTA_linter` MCP server (`http://localhost:7790/mcp`) is strongly recommended. Never bake hardcoded tokens or URLs into prompt text or test files.',
    '- **ENVIRONMENT SSOT:** All environment configuration (Application name, MTA Base URL, Default App Instance, and ApplicationInstanceToken) must be dynamically loaded from `mta_config.json` (or via `MTA_linter.get_config()`).',
    '- **NATIVE MCP TOOL EXECUTION MANDATE:** You MUST ALWAYS use the MTA Plugin MCP tool (`MTA_plugin.execute-testcase`) for all in-memory exploratory test executions.',
    '- **ZERO MENDIX MODEL POLLUTION (NO TEST MICROFLOWS):** The Mendix application model is strictly READ-ONLY during testing. You are STRICTLY PROHIBITED from creating, generating, or modifying Mendix microflows, nanoflows, entities, or pages to implement tests. Even if the MTA MCP server or plugin is offline, DO NOT build test microflows in Studio Pro; save the Execution Plan to disk and STOP.',
    '- **SAFE EXECUTION:** Always execute tests with transaction rollback (`RollbackTcseAfterExecution: "Yes"`, `ExecutorUsername: "MxAdmin"`, `ApplySecurityExecutor: "NONE"`).',
    '- **EXPLORATORY EXECUTION STRATEGY (mta_config.json SSOT):** Read `exploratory_execution_mode` from `mta_config.json` before drafting any plan. If `"prompt_approval"`, you MUST set `status: "DRAFT"`, present Checkpoint 1, and HALT for human approval (`AUTO_APPROVED` is strictly prohibited). Only if `"auto_execute"` (and Backend in-memory `Rollback: "Yes"` with no `bug_reproduction`/`data_seeding`/`prompt_spec` override) may you set `status: "AUTO_APPROVED"` and auto-execute.',
    `- **STRICT TWO-GATE HUMAN APPROVAL INVARIANT (ANTI-56, PAT-106, PAT-118):** Persistent MTA Platform construction (\`Create*\`, \`Edit*\`, \`Set*\`) and all Frontend tests NEVER auto-execute and NEVER self-approve in a single turn. Always write \`EP_*.md\` as \`status: "DRAFT"\`, present Checkpoint 1 & Gate 2 placement (and elicit Playwright Browser/Mode/SlowMo via \`ask_question\` for Frontend), and HALT your turn. Only after the user replies in a subsequent turn may you run \`${lintCmd} stage-placement\`, seal \`status: "APPROVED"\`, and run \`${lintCmd} pre-build\`.`,
    '- **MTA LICENSE TIER & CAPABILITIES:**',
    '  * If `MTA` MCP server is not configured and `MtaPluginModule.MTAConnectionUrl` is `wss://services.menditect.com`, the user is operating under the **Free MTA Exploratory License**.',
    '  * **Free Capabilities:** Unlimited local in-memory microflow testing (`execute-testcase`) and local Execution Plan generation (`EP_*.md`).',
    '  * **Paid Platform Capabilities:** Persistent cloud/on-prem test suites, Playwright Frontend UI testing, and CI/CD automated regression pipelines require a paid MTA Platform License.',
    '- **MCP SUBPROCESS PROTECTION & TOKEN ROTATION:** NEVER execute terminal commands (`Stop-Process`, `taskkill`, `kill`) against running MCP server/proxy processes (`mta-proxy.js`, `node.exe`, or custom proxies). Terminating stdio child processes causes AI IDEs (Antigravity, Cursor, Claude Desktop, VS Code) to permanently disable MCP servers for the active session. The built-in proxy reloads `.env` dynamically on every request with zero restart needed. If using a static or custom proxy that returns HTTP 401, prompt the user to update their credentials and use their IDE\'s "Restart MCP Server" / "Reload Window" UI action.'
  );
  return lines.join('\n');
}

function updateDirectiveFile(filePath, appName, mtaUrl, skillsStyle, appInstances, defaultInstanceName, skillsRelPath = 'skills/AGENTS.md', toolsDir = null) {
  let content = '';
  const isExternalWorkspace = path.resolve(path.dirname(filePath)) !== path.resolve(toolsRootDir);
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf8');
  } else if (!toolsDir || !isExternalWorkspace) {
    const baseFile = path.join(toolsRootDir, path.basename(filePath));
    if (fs.existsSync(baseFile)) {
      content = fs.readFileSync(baseFile, 'utf8');
    }
  }

  if (skillsRelPath === 'skills/AGENTS.md') {
    content = content.replace(/[a-zA-Z0-9_\-\.\/\\:]+\/skills\/AGENTS\.md/g, 'skills/AGENTS.md');
    content = content.replace(/`[a-zA-Z0-9_\-\.\/\\:]+\/skills\/`/g, '`skills/`');
    content = content.replace(/in the `[a-zA-Z0-9_\-\.\/\\:]+\/skills\/` directory/g, 'in the `skills/` directory');
  } else {
    content = content.replace(/skills\/AGENTS\.md/g, skillsRelPath);
    const skillsDirRel = path.dirname(skillsRelPath);
    content = content.replace(/`skills\/`/g, `\`${skillsDirRel}/\``);
  }

  const setupBlock = getMenditectSetupBlock(appName, mtaUrl, skillsStyle, appInstances, defaultInstanceName, skillsRelPath, toolsDir);

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

function updateAgentDirectives(targetDir, appName, mtaUrl, skillsStyle, appInstances, defaultInstanceName, skillsDir, toolsDir = null) {
  const targetFiles = [
    path.join(targetDir, 'AGENTS.md'),
    path.join(targetDir, 'CLAUDE.md'),
    path.join(targetDir, 'GEMINI.md'),
    path.join(targetDir, '.github', 'copilot-instructions.md')
  ];

  let skillsRelPath = 'skills/AGENTS.md';
  if (skillsDir) {
    if (toolsDir && path.resolve(targetDir) !== path.resolve(toolsRootDir)) {
      skillsRelPath = `${skillsDir.replace(/\\/g, '/')}/AGENTS.md`;
    } else {
      const rel = path.relative(targetDir, skillsDir).replace(/\\/g, '/');
      skillsRelPath = rel ? `${rel}/AGENTS.md` : 'skills/AGENTS.md';
    }
  }

  for (const file of targetFiles) {
    updateDirectiveFile(file, appName, mtaUrl, skillsStyle, appInstances, defaultInstanceName, skillsRelPath, toolsDir);
  }
  console.log(`Configured Menditect Architecture Setup in ${targetDir}`);
}

module.exports = {
  getMenditectSetupBlock,
  updateDirectiveFile,
  updateAgentDirectives
};
