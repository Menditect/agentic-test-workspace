const fs = require('fs');
const path = require('path');
const {
  toolsRootDir,
  scriptVersion,
  PASS,
  WARN,
  NOTICE,
  INFO,
  FOUND,
  ERROR,
  isBack,
  ask
} = require('./cli-prompt');
const {
  normalizeConfigAliases,
  loadEnvFile,
  discoverWorkspaceConfigCandidates,
  formatBearerToken
} = require('./workspace-registry');
const { getOrDownloadMxcli } = require('./mxcli-manager');
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
  inspectInstalledMarketplaceModules,
  isPaidMtaServerUrl,
  syncProjectMarketplaceModules
} = require('./marketplace');
const {
  requestFreeLicenseInteractive,
  generateFreeExploratoryToken,
  validateBusinessEmail
} = require('./free-license-request');
const {
  resolveGatewayProtocolDefaults,
  hydrateStateFromWorkspaceDir,
  createInitialWizardState,
  applyMendixPluginConfigToState
} = require('./setup-core');

let vibeDisclaimerAcknowledged = false;

function setVibeDisclaimerAcknowledged(val = true) {
  vibeDisclaimerAcknowledged = Boolean(val);
}

async function showVibeCodingDisclaimer() {
  if (vibeDisclaimerAcknowledged) {
    return true;
  }

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
  vibeDisclaimerAcknowledged = true;
  console.log('');
  return true;
}

async function showDisclaimerAndPreflight() {
  await showVibeCodingDisclaimer();

  console.log('======================================================');
  console.log(' NAVIGATION TIPS:');
  console.log(' • Press [Enter] to accept the detected [default value in brackets]');
  console.log(" • Type 'b' or 'back' at any question to return to the previous step");
  console.log(' • You can review and edit all answers before any files are saved');
  console.log('======================================================');
  console.log('\n┌──────────────────────────────────────────────────────────────────────────────┐');
  console.log('│ 📋 PRE-FLIGHT CHECKLIST: DATA REQUIRED FOR SETUP                             │');
  console.log('├──────────────────────────────────────────────────────────────────────────────┤');
  console.log('│ Before proceeding, have the following items ready:                           │');
  console.log('│                                                                              │');
  console.log('│ 1. Mendix Project Path:                                                      │');
  console.log('│    Local directory of your app (e.g. C:\\Users\\...\\Mendix\\MyApp).           │');
  console.log('│                                                                              │');
  console.log('│ 2. Mendix Personal Access Token (PAT):                                       │');
  console.log('│    Used by mxcli to download Marketplace modules (MtaPluginModule, etc.).    │');
  console.log('│    Create at: https://user-settings.mendix.com/ -> Personal Access Tokens    │');
  console.log('│    Required scope: mx:marketplace-content:read (Marketplace read access).    │');
  console.log('│    (Optional: can be skipped if you download modules manually in Studio Pro) │');
  console.log('│                                                                              │');
  console.log('│ 3. Application Instance Token (UUID):                                        │');
  console.log('│    • Free Exploratory: Personal license token (or request one during setup). │');
  console.log('│    • Paid MTA: Portal > Applications > Application Instances > Token.        │');
  console.log('│                                                                              │');
  console.log('│ 4. MTA Connection Credentials (Username & Password):                         │');
  console.log('│    • Free Exploratory: Provided in your Menditect welcome email.             │');
  console.log('│    • Paid MTA: Portal > Applications > Instances > Details (with token).     │');
  console.log('│                                                                              │');
  console.log('│ 5. Plugin Runtime Port & MCP Token:                                          │');
  console.log('│    • Port: Runtime port (default: 8081).                                     │');
  console.log('│    • Token: Shared secret token for /plugin/mcp (sets both Mendix constant   │');
  console.log('│      and workspace .env; "1" for local testing or a secure passphrase).      │');
  console.log('│                                                                              │');
  console.log('│ 6. Optional / Advanced:                                                      │');
  console.log('│    • Studio Pro MCP Port: Default 7782 (required if using Studio Pro Live MCP)│');
  console.log('│    • MTA Cloud Service Account Token: Leave blank for Free Exploratory.      │');
  console.log('└──────────────────────────────────────────────────────────────────────────────┘\n');
}

async function runWizardLoop(state) {
  let currentStep = 'setup_mode';
  const stepHistory = [];
  let editingSingleSetting = null;

  while (currentStep !== 'DONE') {
    const existingConfig = state.existingConfig || {};
    let nextStep = null;
    let goBack = false;

    if (currentStep === 'setup_mode') {
      console.log('\n--- Setup Mode ---');
      console.log('Select what you would like to do:\n');
      console.log('  [1] Create a new workspace (clean slate, no pre-filled values)');
      console.log('  [2] Update or reconfigure an existing workspace\n');

      let ans = '';
      while (ans !== '1' && ans !== '2' && !isBack(ans)) {
        ans = await ask('Select option (1/2)', state.setupMode);
      }
      if (isBack(ans)) {
        goBack = true;
      } else {
        state.setupMode = ans;
        if (ans === '2') {
          nextStep = 'select_existing_workspace';
        } else {
          nextStep = 'license_choice';
        }
      }
    } else if (currentStep === 'select_existing_workspace') {
      console.log('\n--- Select Existing Workspace ---');
      const candidateInitConfigs = discoverWorkspaceConfigCandidates();
      const existingCandidateDirs = [];
      for (const cfgPath of candidateInitConfigs) {
        if (fs.existsSync(cfgPath)) {
          const dir = path.dirname(path.resolve(cfgPath));
          if (!existingCandidateDirs.includes(dir) && dir !== path.resolve(toolsRootDir)) {
            existingCandidateDirs.push(dir);
          }
        }
      }

      let selectedWsDir = '';
      while (!selectedWsDir && !goBack) {
        if (existingCandidateDirs.length > 0) {
          console.log(`Discovered ${existingCandidateDirs.length} existing workspace(s):`);
          existingCandidateDirs.forEach((d, idx) => {
            console.log(`  [${idx + 1}] ${d}`);
          });
          console.log(`  [${existingCandidateDirs.length + 1}] Enter custom workspace folder path...`);

          const choiceAns = await ask(`Select workspace to update (1-${existingCandidateDirs.length + 1})`, '1');
          if (isBack(choiceAns)) {
            goBack = true;
            break;
          }
          const parsed = parseInt(choiceAns, 10);
          if (!isNaN(parsed) && parsed >= 1 && parsed <= existingCandidateDirs.length) {
            selectedWsDir = existingCandidateDirs[parsed - 1];
          } else {
            const manualAns = await ask('Enter path to existing workspace directory', path.resolve(toolsRootDir, '..'));
            if (isBack(manualAns)) {
              // Return to choiceAns prompt
              continue;
            }
            selectedWsDir = path.resolve(manualAns.trim());
          }
        } else {
          const manualAns = await ask('Enter path to existing workspace directory', path.resolve(toolsRootDir, '..'));
          if (isBack(manualAns)) {
            goBack = true;
            break;
          }
          selectedWsDir = path.resolve(manualAns.trim());
        }
      }

      if (!goBack && selectedWsDir) {
        const hasCfg = hydrateStateFromWorkspaceDir(selectedWsDir, state);
        if (hasCfg) {
          state.customWorkspaceDir = selectedWsDir;
          console.log(`${PASS} Successfully loaded existing workspace settings from ${selectedWsDir}.`);
        } else {
          console.log(`\n${NOTICE} No mta_config.json found in "${selectedWsDir}".`);
          console.log('         Treating this as a new workspace setup with clean default values.\n');
          state.customWorkspaceDir = selectedWsDir;
        }
        nextStep = 'license_choice';
      }
    } else if (currentStep === 'license_choice') {
      console.log('\n--- Menditect Test Automation (MTA) License ---');
      console.log('Required modules are downloaded, configured and automatically kept up-to-date.');
      console.log('The configuration can be modified later. Choose an option below:\n');
      console.log('  [1] I have a token for exploratory testing (Free Exploratory):');
      console.log('      • You can use exploratory testing after you fill in the token');
      console.log('      • Uses Menditect free license server (https://services.menditect.com)');
      console.log('  [2] I have an MTA license (Paid MTA Server / Platform):');
      console.log('      • You can use both exploratory testing and create tests in MTA');
      console.log('      • Full access to Frontend TestKit, Playwright Connector, and cloud test suites');
      console.log('  [3] I want to request a token for exploratory testing:');
      console.log('      • Enter your information to register for a free exploratory license right now in the CLI');
      console.log('      • Contact Menditect Sales (https://menditect.com/contact/) for an MTA license\n');

      let defaultChoice = '1';
      if (state.licenseTier === 'paid_enterprise') {
        defaultChoice = '2';
      } else if (!state.defaultInstanceToken && (!state.discoveredMta?.instances || !state.discoveredMta.instances.length)) {
        defaultChoice = '3';
      } else {
        defaultChoice = '1';
      }

      let ans = '';
      while (ans !== '1' && ans !== '2' && ans !== '3' && !isBack(ans)) {
        ans = await ask('Select option: [1] Exploratory token, [2] MTA license, [3] Request exploratory token', defaultChoice);
      }

      if (isBack(ans)) {
        goBack = true;
      } else {
        const prevTier = state.licenseTier;
        const targetTier = ans === '2' ? 'paid_enterprise' : 'free_exploratory';
        const tierSwitched = Boolean(prevTier && prevTier !== targetTier);
        if (tierSwitched) {
          state.tierSwitched = true;
          state.defaultInstanceToken = '';
          state.mtaUrl = targetTier === 'free_exploratory' ? 'https://services.menditect.com' : '';
          state.appInstances = [];
          state.activeConfig = null;
        }
        state.licenseChoice = ans;
        if (ans === '1') {
          state.licenseTier = 'free_exploratory';
          state.mtaUrl = 'https://services.menditect.com';
          console.log(`\n${PASS} Free Exploratory License selected.`);
          if (state.defaultInstanceToken) {
            console.log(`       Active ApplicationInstanceToken: ${state.defaultInstanceToken}`);
          }
          nextStep = 'project_dir';
        } else if (ans === '2') {
          state.licenseTier = 'paid_enterprise';
          if (state.mtaUrl && !isPaidMtaServerUrl(state.mtaUrl)) {
            state.mtaUrl = '';
            state.defaultInstanceToken = '';
          }
          console.log(`\n${PASS} Paid MTA Server / Platform selected.`);
          nextStep = 'project_dir';
        } else if (ans === '3') {
          const reqRes = await requestFreeLicenseInteractive(ask);
          if (reqRes.aborted) {
            continue;
          } else if (reqRes.success) {
            state.licenseTier = 'free_exploratory';
            state.mtaUrl = 'https://services.menditect.com';
            nextStep = 'project_dir';
          } else {
            console.log('\nOptions:');
            console.log(`  [1] Proceed anyway using generated token (${reqRes.token || 'auto'})`);
            console.log('  [2] Try registration again');
            console.log('  [3] Return to license selection');
            const failChoice = await ask('Select option (1-3)', '1');
            if (failChoice.trim() === '2') {
              continue;
            } else if (failChoice.trim() === '3' || isBack(failChoice)) {
              continue;
            } else {
              state.licenseTier = 'free_exploratory';
              state.mtaUrl = 'https://services.menditect.com';
              nextStep = 'project_dir';
            }
          }
        }
      }
    } else if (currentStep === 'project_dir') {
      console.log('\n--- Mendix Project Location ---');
      const defaultDir = state.projectDir || '';
      const ans = await ask('Local Mendix App to test (project folder containing .mpr)', defaultDir);
      if (isBack(ans)) {
        goBack = true;
      } else {
        state.projectDir = ans.trim();
        state.mprPath = '';
        state.detectedVersion = '';
        state.isMendix1112Plus = false;
        state.isMendix1116Plus = false;

        if (state.projectDir && fs.existsSync(state.projectDir)) {
          const found = findMpr(state.projectDir);
          if (found) {
            console.log(`Found Mendix .mpr file: ${found}`);
            state.mprPath = found;
            state.detectedVersion = detectMendixVersion(found);
            if (state.detectedVersion) {
              console.log(`Detected Mendix Studio Pro version: ${state.detectedVersion}`);
              state.isMendix1112Plus = isVersion1112OrHigher(state.detectedVersion);
              state.isMendix1116Plus = isVersion1116OrHigher(state.detectedVersion);
            }
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
          } else {
            console.log('Warning: No .mpr file found in directory.');
          }
        }
        state.workspaceChoice = '1';
        state.workspaceType = 'custom';
        nextStep = 'workspace_dir';
      }
    } else if (currentStep === 'workspace_dir') {
      console.log('\n--- Target External Workspace Directory ---');
      console.log('Specify the external folder (outside your Mendix project) where this app\'s');
      console.log('workspace files (mta_config.json, .env, and menditect-output/ test plans) should live.');
      console.log(`(Skills and CLI tools will remain in the Central Hub: ${toolsRootDir})`);
      console.log('*(Note: For in-Studio Pro MAIA usage on Mendix 11.12+, configure MTA directly inside');
      console.log('  Studio Pro via Extensions > Menditect MTA instead of running this external setup script.)*\n');
      const defaultWsDir = state.customWorkspaceDir || path.resolve(toolsRootDir, '..');
      let selectedDir = '';
      while (!selectedDir && !goBack) {
        const ans = await ask('Target External Workspace Folder', defaultWsDir);
        if (isBack(ans)) {
          goBack = true;
          break;
        }
        const candidateDir = path.resolve(ans.trim());
        if (state.projectDir && candidateDir.toLowerCase() === path.resolve(state.projectDir).toLowerCase()) {
          console.log(`\n${ERROR} The external workspace folder cannot be your Mendix project directory itself.`);
          console.log('        Please choose a separate directory outside your Mendix project (or use the');
          console.log('        Menditect MTA extension inside Studio Pro for Mendix MAIA).\n');
          continue;
        }
        selectedDir = candidateDir;
      }
      if (!goBack && selectedDir) {
        state.workspaceChoice = '1';
        state.workspaceType = 'custom';
        state.customWorkspaceDir = selectedDir;
        nextStep = 'mta_plugin_setup';
      }
    } else if (currentStep === 'mta_plugin_setup') {
      if (!state.projectDir || !fs.existsSync(state.projectDir) || !state.mprPath || !fs.existsSync(state.mprPath)) {
        nextStep = 'model_source';
      } else {
        console.log('\n--- Menditect Marketplace Modules & MTA Plugin Setup ---');
        const mxcliBin = await getOrDownloadMxcli(state.mprPath);
        const installedInfo = inspectInstalledMarketplaceModules(state.projectDir);
        const pluginModInfo = installedInfo.modules.MtaPluginModule;
        const isPluginPresent = Boolean(pluginModInfo && pluginModInfo.installed);
        const isPluginConfigured = Boolean(state.discoveredMta && state.discoveredMta.isPluginConfigured);
        const mxVer = state.detectedVersion || '11.0.0';

        let stepSubBack = false;
        let modulesUpdatedCount = 0;

        // Check if Studio Pro has the project open before downloading modules or modifying .mpr
        let studioProCheck = isMendixProjectOpenInStudioPro(state.mprPath, state.projectDir);
        let skipModuleOpsDueToStudioPro = false;

        let subStep = (studioProCheck.isOpen) ? 'studio_check' : 'config_select';
        const subStepHistory = [];

        let targetConfigName = '';
        let isNewConfig = false;
        let skipMprConfigWrite = false;
        let shouldConfigureConstants = true;
        let isPaidServer = false;
        let rawMtaConnectionUrl = 'wss://services.menditect.com';
        let httpMtaUrl = 'https://services.menditect.com';
        let appInstanceToken = '';
        let connectionUsername = '';
        let connectionPassword = '';
        let enableMcpServer = 'True';
        let mcpServerAccessToken = '';

        while (subStep !== 'DONE' && !stepSubBack) {
          let nextSubStep = null;
          let subGoBack = false;

          if (subStep === 'studio_check') {
            console.log('\n┌──────────────────────────────────────────────────────────────────────────────┐');
            console.log('│ ⚠️  WARNING: MENDIX STUDIO PRO HAS THIS PROJECT OPEN                         │');
            console.log('├──────────────────────────────────────────────────────────────────────────────┤');
            console.log(`│ Active Studio Pro session detected (Process ID: ${String(studioProCheck.pid).padEnd(28)}) │`);
            console.log(`│ Project: ${path.basename(state.mprPath).padEnd(67)} │`);
            console.log('│                                                                              │');
            console.log('│ Adding/updating modules or configuring constants while open in Studio Pro:   │');
            console.log('│   1. File Lock Errors: Studio Pro or the JVM lock .mpr, userlib/*.jar,      │');
            console.log('│      and deployment/ folders, causing downloads or cleanup to fail.          │');
            console.log('│   2. Cache Overwrite Risk: Studio Pro holds an in-memory model cache. When   │');
            console.log('│      you save in Studio Pro, it will overwrite the .mpr on disk and ERADICATE│');
            console.log('│      the newly configured MTA settings and constants!                        │');
            console.log('│   3. Desynchronization: Studio Pro will not reload updated .mxmodule files   │');
            console.log('│      from disk until the project is closed and re-opened.                    │');
            console.log('│                                                                              │');
            console.log('│ RECOMMENDED ACTION: Close Studio Pro (or close this project in Studio Pro)   │');
            console.log('│ before continuing.                                                           │');
            console.log('└──────────────────────────────────────────────────────────────────────────────┘\n');

            console.log('Options:');
            console.log('  [1] I have closed Studio Pro — Re-check and proceed (Recommended)');
            console.log('  [2] Continue anyway (Proceed with risk — do NOT save in Studio Pro, reload after setup)');
            console.log('  [3] Skip module download and constant configuration for now');
            const studioChoice = await ask('Select option: [1] Re-check (recommended), [2] Continue anyway, [3] Skip', '1');
            if (isBack(studioChoice)) {
              subGoBack = true;
            } else {
              const trimmedChoice = studioChoice.trim();
              if (trimmedChoice === '1') {
                studioProCheck = isMendixProjectOpenInStudioPro(state.mprPath, state.projectDir);
                if (!studioProCheck.isOpen) {
                  console.log(`\n${PASS} Studio Pro closed. Safe to proceed with module installation and configuration.\n`);
                  nextSubStep = 'config_select';
                } else {
                  console.log(`\n${WARN} Studio Pro is still detected holding this project (PID: ${studioProCheck.pid}).`);
                  console.log('       Please save your work, close Studio Pro or the project, and try again.\n');
                }
              } else if (trimmedChoice === '2') {
                console.log(`\n${WARN} Continuing with Studio Pro open. CAUTION: Do NOT save in Studio Pro! Reload the project immediately after setup.\n`);
                nextSubStep = 'config_select';
              } else if (trimmedChoice === '3') {
                console.log(`\n${INFO} Skipping module downloads and configuration. You can run 'npm run update:modules' anytime after closing Studio Pro.\n`);
                skipModuleOpsDueToStudioPro = true;
                nextSubStep = 'config_select';
              }
            }
          } else if (subStep === 'config_select') {
            console.log('\n--- MTA Plugin & Runtime Configuration Selection ---');
            if (mxcliBin) {
              state.discoveredMta = inspectMendixMtaSettings(state.mprPath, mxcliBin);
            }
            const currentConfigs = (state.discoveredMta && Array.isArray(state.discoveredMta.configurationNames) && state.discoveredMta.configurationNames.length > 0)
              ? state.discoveredMta.configurationNames
              : (state.appInstances && state.appInstances.length > 0 ? state.appInstances.map(x => x.name) : []);

            if (currentConfigs.length > 0) {
              console.log(`Discovered ${currentConfigs.length} configuration(s) in Mendix project:`);
              currentConfigs.forEach((cName, idx) => {
                const matchInst = state.appInstances?.find(x => x.name.toLowerCase() === cName.toLowerCase())
                  || state.discoveredMta?.instances?.find(x => x.name.toLowerCase() === cName.toLowerCase());
                const instTok = matchInst?.token ? (matchInst.token.length > 10 ? `${matchInst.token.slice(0, 6)}...` : matchInst.token) : '';
                console.log(`  [${idx + 1}] ${cName}${instTok ? ` (Token: ${instTok})` : ''}`);
              });
              console.log(`  [${currentConfigs.length + 1}] Duplicate an Existing Configuration...`);

              const configChoice = await ask(`Select a configuration to use/update (1-${currentConfigs.length + 1})`, '1');
              if (isBack(configChoice)) {
                subGoBack = true;
              } else {
                const parsed = parseInt(configChoice, 10);
                if (parsed === currentConfigs.length + 1) {
                  let newCfgCreated = false;
                  while (!newCfgCreated && !subGoBack) {
                    let sourceConfig = currentConfigs[0] || 'Default';
                    if (currentConfigs.length > 1) {
                      console.log('\nSelect source configuration to duplicate:');
                      currentConfigs.forEach((cName, idx) => console.log(`  [${idx + 1}] ${cName}`));
                      const srcAns = await ask(`Select source configuration (1-${currentConfigs.length})`, '1');
                      if (isBack(srcAns)) break;
                      const srcIdx = parseInt(srcAns, 10) - 1;
                      if (srcIdx >= 0 && srcIdx < currentConfigs.length) {
                        sourceConfig = currentConfigs[srcIdx];
                      }
                    }

                    const defaultNewName = `${sourceConfig}_MTA`;
                    const newNameAns = await ask(`Enter new configuration name (duplicating '${sourceConfig}')`, defaultNewName);
                    if (isBack(newNameAns)) {
                      break;
                    }
                    const candidateName = newNameAns.trim();
                    if (!candidateName) {
                      console.log(`${ERROR} Configuration name cannot be empty.`);
                      continue;
                    }
                    const alreadyExists = currentConfigs.find(c => c.toLowerCase() === candidateName.toLowerCase());
                    if (alreadyExists) {
                      console.log(`${WARN} Configuration '${candidateName}' already exists in project. Using '${alreadyExists}'.`);
                      targetConfigName = alreadyExists;
                      isNewConfig = false;
                      newCfgCreated = true;
                      break;
                    }

                    console.log(`Attempting to duplicate configuration '${sourceConfig}' to '${candidateName}' in .mpr...`);
                    const createRes = tryDuplicateConfigurationInMpr(state.mprPath, mxcliBin, sourceConfig, candidateName, 8081);
                    if (createRes.success) {
                      console.log(`${PASS} Successfully duplicated configuration '${sourceConfig}' to '${candidateName}' (with all database and server settings).`);
                      targetConfigName = candidateName;
                      isNewConfig = true;
                      state.discoveredMta = inspectMendixMtaSettings(state.mprPath, mxcliBin);
                      newCfgCreated = true;
                      break;
                    }

                    const isProjectOpenInStudioPro = createRes.error && /Studio Pro has this project open/i.test(createRes.error);
                    console.log('\n┌──────────────────────────────────────────────────────────────────────────────┐');
                    if (isProjectOpenInStudioPro) {
                      console.log('│ ⚠️  Cannot Auto-Duplicate Configuration (.mpr Locked by Studio Pro)            │');
                      console.log('├──────────────────────────────────────────────────────────────────────────────┤');
                      console.log(`│ mxcli refused to write to the project because Mendix Studio Pro has this     │`);
                      console.log(`│ project open.                                                                │`);
                    } else {
                      console.log('│ ⚠️  Cannot Auto-Duplicate Configuration in .mpr                                │');
                      console.log('├──────────────────────────────────────────────────────────────────────────────┤');
                      console.log(`│ mxcli could not automatically duplicate configuration '${sourceConfig}'.     │`);
                    }
                    console.log('│   1. In Studio Pro: App Explorer > App > Settings > Configurations tab       │');
                    console.log(`│   2. Select '${sourceConfig}', click 'Duplicate', enter name '${candidateName}'  │`);
                    console.log('│   3. Save the project in Studio Pro and return here                          │');
                    console.log('└──────────────────────────────────────────────────────────────────────────────┘\n');

                    let resolvedChoice = false;
                    while (!resolvedChoice) {
                      console.log('Options:');
                      console.log(`  [1] I created '${candidateName}' in Studio Pro — Verify and proceed (Recommended)`);
                      console.log(`  [2] Select an existing configuration instead (${currentConfigs.join(', ')})`);
                      console.log(`  [3] Save '${candidateName}' to mta_config.json only (skip writing constants to .mpr for now)`);

                      const optAns = await ask('Select option (1-3)', '1');
                      if (isBack(optAns)) {
                        break;
                      }
                      const optChoice = optAns.trim();
                      if (optChoice === '1') {
                        const refreshed = inspectMendixMtaSettings(state.mprPath, mxcliBin);
                        const foundCfg = refreshed?.configurationNames?.find(c => c.toLowerCase() === candidateName.toLowerCase());
                        if (foundCfg) {
                          console.log(`\n${PASS} Found configuration '${foundCfg}' in Mendix project!\n`);
                          targetConfigName = foundCfg;
                          state.discoveredMta = refreshed;
                          isNewConfig = false;
                          resolvedChoice = true;
                          newCfgCreated = true;
                        } else {
                          console.log(`\n${WARN} Configuration '${candidateName}' was not found in project configurations.`);
                          console.log('       Please ensure you clicked OK, saved the project in Studio Pro, and try again.\n');
                        }
                      } else if (optChoice === '2') {
                        console.log('Available configurations:');
                        currentConfigs.forEach((cn, i) => console.log(`  [${i + 1}] ${cn}`));
                        const selAns = await ask(`Select configuration (1-${currentConfigs.length})`, '1');
                        if (isBack(selAns)) {
                          continue;
                        }
                        const selIdx = parseInt(selAns, 10);
                        if (!isNaN(selIdx) && selIdx >= 1 && selIdx <= currentConfigs.length) {
                          targetConfigName = currentConfigs[selIdx - 1];
                        } else {
                          targetConfigName = currentConfigs[0];
                        }
                        isNewConfig = false;
                        console.log(`${INFO} Using existing configuration '${targetConfigName}'.`);
                        resolvedChoice = true;
                        newCfgCreated = true;
                      } else if (optChoice === '3') {
                        targetConfigName = candidateName;
                        skipMprConfigWrite = true;
                        isNewConfig = true;
                        console.log(`${INFO} Selected '${targetConfigName}'. Constants will be saved to mta_config.json only.`);
                        resolvedChoice = true;
                        newCfgCreated = true;
                      }
                    }
                  }

                  function routeNextAfterConfigSelection() {
                    shouldConfigureConstants = true;
                    if (state.licenseTier === 'paid_enterprise') {
                      isPaidServer = true;
                      return 'paid_url';
                    }
                    isPaidServer = false;
                    rawMtaConnectionUrl = 'wss://services.menditect.com';
                    httpMtaUrl = 'https://services.menditect.com';
                    console.log('\n--- Configure MTA Plugin Constants & AfterStartup ---');
                    console.log(`  ${INFO} Free Exploratory License (configured upfront):`);
                    console.log('         • MTA URL:                          https://services.menditect.com');
                    console.log('         • MtaPluginModule.MTAConnectionUrl: wss://services.menditect.com');
                    return 'instance_token';
                  }

                  if (newCfgCreated) {
                    nextSubStep = routeNextAfterConfigSelection();
                  }
                } else if (!isNaN(parsed) && parsed >= 1 && parsed <= currentConfigs.length) {
                  targetConfigName = currentConfigs[parsed - 1];
                  isNewConfig = false;
                  const matchedDiscovered = state.discoveredMta?.instances?.find(
                    x => x.name.toLowerCase() === targetConfigName.toLowerCase()
                  );
                  const discoveredUrl = matchedDiscovered?.mtaUrl || state.discoveredMta?.globalMtaUrl || '';
                  const discoveredTierMatches = discoveredUrl
                    ? (state.licenseTier === 'paid_enterprise') === isPaidMtaServerUrl(discoveredUrl)
                    : false;
                  const currentlyHasConfiguredConstants = Boolean(
                    !state.tierSwitched &&
                    discoveredTierMatches &&
                    state.discoveredMta &&
                    state.discoveredMta.isPluginConfigured
                  );
                  if (currentlyHasConfiguredConstants) {
                    nextSubStep = 'reconfig_prompt';
                  } else {
                    nextSubStep = routeNextAfterConfigSelection();
                  }
                }
              }
            } else {
              const newNameAns = await ask('Enter name for initial project configuration', 'Default');
              if (isBack(newNameAns)) {
                subGoBack = true;
              } else {
                targetConfigName = newNameAns.trim() || 'Default';
                isNewConfig = true;
                shouldConfigureConstants = true;
                if (state.licenseTier === 'paid_enterprise') {
                  isPaidServer = true;
                  nextSubStep = 'paid_url';
                } else {
                  isPaidServer = false;
                  rawMtaConnectionUrl = 'wss://services.menditect.com';
                  httpMtaUrl = 'https://services.menditect.com';
                  console.log('\n--- Configure MTA Plugin Constants & AfterStartup ---');
                  console.log(`  ${INFO} Free Exploratory License (configured upfront):`);
                  console.log('         • MTA URL:                          https://services.menditect.com');
                  console.log('         • MtaPluginModule.MTAConnectionUrl: wss://services.menditect.com');
                  nextSubStep = 'instance_token';
                }
              }
            }
          } else if (subStep === 'reconfig_prompt') {
            const reconfigAns = await ask(`Update/reconfigure MTA constants for configuration '${targetConfigName}'? (y/n)`, 'n');
            if (isBack(reconfigAns)) {
              subGoBack = true;
            } else {
              shouldConfigureConstants = reconfigAns.toLowerCase().startsWith('y');
              if (shouldConfigureConstants) {
                if (state.licenseTier === 'paid_enterprise') {
                  isPaidServer = true;
                  nextSubStep = 'paid_url';
                } else {
                  isPaidServer = false;
                  rawMtaConnectionUrl = 'wss://services.menditect.com';
                  httpMtaUrl = 'https://services.menditect.com';
                  console.log('\n--- Configure MTA Plugin Constants & AfterStartup ---');
                  console.log(`  ${INFO} Free Exploratory License (configured upfront):`);
                  console.log('         • MTA URL:                          https://services.menditect.com');
                  console.log('         • MtaPluginModule.MTAConnectionUrl: wss://services.menditect.com');
                  nextSubStep = 'instance_token';
                }
              } else {
                nextSubStep = 'DONE';
              }
            }
          } else if (subStep === 'paid_url') {
            isPaidServer = true;
            console.log('\n--- Configure MTA Plugin Constants & AfterStartup ---');
            const existingUrl = !state.tierSwitched
              ? (state.mtaUrl || state.discoveredMta?.globalMtaUrl || existingConfig.mta_base_url || '')
              : (state.mtaUrl || '');
            const defaultPaidWsUrl = (existingUrl && isPaidMtaServerUrl(existingUrl))
              ? existingUrl.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://')
              : '';
            let enteredPaidUrl = '';
            while (!enteredPaidUrl && !subGoBack) {
              const wsAns = await ask('MtaPluginModule.MTAConnectionUrl (wss:// or https:// URL of your Paid MTA Server)', defaultPaidWsUrl);
              if (isBack(wsAns)) {
                subGoBack = true;
                break;
              }
              const cleanedUrl = wsAns.trim();
              if (!cleanedUrl || cleanedUrl.toLowerCase().includes('services.menditect.com')) {
                console.log(`${ERROR} Please enter a valid Paid MTA Server URL (for example https://mta.menditect.com).`);
                continue;
              }
              enteredPaidUrl = cleanedUrl;
            }
            if (!subGoBack && enteredPaidUrl) {
              rawMtaConnectionUrl = enteredPaidUrl.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://');
              if (!/^wss?:\/\//i.test(rawMtaConnectionUrl)) {
                rawMtaConnectionUrl = `wss://${rawMtaConnectionUrl}`;
              }
              httpMtaUrl = rawMtaConnectionUrl.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
              state.mtaUrl = httpMtaUrl;
              nextSubStep = 'instance_token';
            }
          } else if (subStep === 'instance_token') {
            const matchedDiscoveredInst = state.discoveredMta?.instances?.find(
              x => x.name.toLowerCase() === targetConfigName.toLowerCase()
            ) || (state.discoveredMta?.instances && state.discoveredMta.instances[0]);
            const discoveredInstUrl = matchedDiscoveredInst?.mtaUrl || state.discoveredMta?.globalMtaUrl || '';
            const discoveredInstMatchesTier = discoveredInstUrl
              ? isPaidServer === isPaidMtaServerUrl(discoveredInstUrl)
              : false;
            const existingCfgMatchesTier = existingConfig.mta_base_url
              ? isPaidServer === isPaidMtaServerUrl(existingConfig.mta_base_url)
              : false;
            const defaultInstToken = appInstanceToken
              || state.defaultInstanceToken
              || (!state.tierSwitched && discoveredInstMatchesTier ? matchedDiscoveredInst?.token : '')
              || (!state.tierSwitched && existingCfgMatchesTier ? existingConfig.default_app_instance_token : '')
              || '';
            const tokenLabel = isPaidServer
              ? 'MtaPluginModule.ApplicationInstanceToken (from MTA Portal > Application Instances)'
              : 'MtaPluginModule.ApplicationInstanceToken (Menditect exploratory license key)';
            let enteredTok = '';
            while (!enteredTok && !subGoBack) {
              const tokAns = await ask(tokenLabel, defaultInstToken);
              if (isBack(tokAns)) {
                subGoBack = true;
                break;
              }
              enteredTok = tokAns.trim();
              if (!enteredTok) {
                console.log(`${ERROR} ApplicationInstanceToken cannot be empty.`);
              }
            }
            if (!subGoBack && enteredTok) {
              appInstanceToken = enteredTok;
              const gwDefaults = resolveGatewayProtocolDefaults();
              connectionUsername = gwDefaults.idValue;
              enableMcpServer = 'True';
              if (!isPaidServer) {
                connectionPassword = gwDefaults.keyValue;
                nextSubStep = 'mcp_token';
              } else {
                nextSubStep = 'connection_pass';
              }
            }
          } else if (subStep === 'connection_pass') {
            const gwDefaults = resolveGatewayProtocolDefaults();
            const existingPass = connectionPassword
              || state.discoveredMta?.instances?.find(i => i.name.toLowerCase() === targetConfigName.toLowerCase())?.connectionPassword
              || state.discoveredMta?.globalConnectionPassword
              || gwDefaults.keyValue;
            console.log('\n  • MTA Connection Password:');
            console.log('    Password used by the MTA plugin to authenticate with the MTA connection gateway.');
            console.log('    Press Enter to accept the default, or enter your custom password from App > Instances > Details in MTA.');
            const passAns = await ask('MtaPluginModule.MTAConnectionPassword', existingPass);
            if (isBack(passAns)) {
              subGoBack = true;
            } else {
              connectionPassword = passAns.trim() || gwDefaults.keyValue;
              enableMcpServer = 'True';
              nextSubStep = 'mcp_token';
            }
          } else if (subStep === 'mcp_token') {
            const existingRawPluginTok = (mcpServerAccessToken || state.rawPluginToken || state.discoveredMta?.globalRawMcpServerAccessToken || '').replace(/^Bearer\s+/i, '').trim();
            console.log('\n┌──────────────────────────────────────────────────────────────────────────────┐');
            console.log('│ 🔑 MTA PLUGIN MCP ACCESS TOKEN (CHOOSE YOUR OWN SECRET VALUE)                │');
            console.log('├──────────────────────────────────────────────────────────────────────────────┤');
            console.log('│ IMPORTANT: This token is a secret value that YOU choose/invent yourself      │');
            console.log('│            (it does NOT come from Menditect!).                               │');
            console.log('│                                                                              │');
            console.log('│ The MTA Plugin exposes an embedded MCP server at /plugin/mcp in your running │');
            console.log('│ Mendix runtime. To secure this endpoint against unauthorized access:         │');
            console.log('│                                                                              │');
            console.log('│ 1. EXPECTED VALUE (Mendix app): Saved as constant McpServerAccessToken in    │');
            console.log('│    MtaPluginModule (written to your .mpr project configuration).             │');
            console.log('│ 2. CLIENT VALUE (AI workspace): Saved in mta_config.json / .env as           │');
            console.log('│    PLUGIN_MCP_TOKEN. Sent in the HTTP Authorization header by the AI agent.  │');
            console.log('│                                                                              │');
            console.log('│ With this single prompt, setup configures BOTH sides to the exact same value!│');
            console.log('│ • Quick local testing: You can simply enter "1" or "dev-secret".             │');
            console.log('│ • Shared networks or cloud slots: Use a strong random passphrase.            │');
            console.log('└──────────────────────────────────────────────────────────────────────────────┘\n');
            let enteredMcpTok = '';
            while (!enteredMcpTok && !subGoBack) {
              const mcpTokAns = await ask('MtaPluginModule.McpServerAccessToken (choose your own secret value, not from Menditect)', existingRawPluginTok || '1');
              if (isBack(mcpTokAns)) {
                subGoBack = true;
                break;
              }
              const cleaned = (mcpTokAns.trim()).replace(/^Bearer\s+/i, '').trim();
              if (!cleaned) {
                console.log(`${ERROR} McpServerAccessToken cannot be empty. Enter a secret token (e.g. "1" for local testing or a secure passphrase).`);
                continue;
              }
              enteredMcpTok = cleaned;
            }
            if (!subGoBack && enteredMcpTok) {
              mcpServerAccessToken = enteredMcpTok;
              nextSubStep = 'DONE';
            }
          }

          if (subGoBack) {
            if (subStepHistory.length > 0) {
              subStep = subStepHistory.pop();
            } else {
              stepSubBack = true;
            }
          } else if (nextSubStep) {
            subStepHistory.push(subStep);
            subStep = nextSubStep;
          }
        }

        if (!stepSubBack) {
          applyMendixPluginConfigToState(state, mxcliBin, {
            targetConfigName,
            shouldConfigureConstants,
            skipMprConfigWrite,
            appInstanceToken,
            rawMtaConnectionUrl,
            httpMtaUrl,
            connectionUsername,
            connectionPassword,
            enableMcpServer,
            mcpServerAccessToken
          });

          // Automated Marketplace Modules Sync (MtaPluginModule, Menditect_AgenticTestSkills if Mendix project, Paid add-ons if Paid server)
          if (!skipModuleOpsDueToStudioPro && mxcliBin) {
            const syncRes = await syncProjectMarketplaceModules(state, ask, mxcliBin);
            if (syncRes.success && syncRes.updatedCount > 0) {
              modulesUpdatedCount += syncRes.updatedCount;
            }
          }
        }

        if (stepSubBack) {
          goBack = true;
        } else {
          if (modulesUpdatedCount > 0) {
            cleanDeploymentDirectory(state.projectDir);
          }
          prepareMendixGitRepo(state.projectDir);
          nextStep = 'model_source';
        }
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
        const hasConfiguredInstance = Boolean(state.appInstances?.length && state.defaultInstanceName);
        if (state.modelSource === '2') {
          nextStep = 'studiopro_url';
        } else if (state.mprPath && fs.existsSync(state.mprPath)) {
          nextStep = 'catalog_index';
        } else {
          nextStep = hasConfiguredInstance ? 'app_name' : 'mta_instances';
        }
      }
    } else if (currentStep === 'studiopro_url') {
      const existingUrl = state.studioproMcpUrl || existingConfig.studiopro_mcp_url || process.env.STUDIOPRO_MCP_URL || 'http://localhost:7782/mcp';
      let defaultPort = '7782';
      try {
        const m = existingUrl.match(/:(\d+)\/mcp/i) || existingUrl.match(/:(\d+)/);
        if (m && m[1]) defaultPort = m[1];
      } catch (e) {}

      let validPort = false;
      while (!validPort && !goBack) {
        const portAns = await ask('Studio Pro MCP Port (as configured in Studio Pro > Preferences)', defaultPort);
        if (isBack(portAns)) {
          goBack = true;
          break;
        }
        const cleanedPort = portAns.trim().replace(/^\[|\]$/g, '').trim();
        const parsedPort = parseInt(cleanedPort, 10);
        if (isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
          console.log(`${ERROR} Invalid port number "${cleanedPort}". Please enter a valid port between 1 and 65535.`);
          continue;
        }
        validPort = true;
        state.studioproMcpUrl = `http://localhost:${parsedPort}/mcp`;
      }

      if (!goBack) {
        console.log('\n┌──────────────────────────────────────────────────────────────────────────┐');
        console.log('│ ACTION REQUIRED IN MENDIX STUDIO PRO:                                    │');
        console.log('│ 1. Open this project in Mendix Studio Pro (version 11.12+ required).     │');
        console.log('│ 2. In Studio Pro, go to Edit > Preferences and enable the MCP Server.    │');
        console.log(`│ 3. Confirm the port matches: ${(state.studioproMcpUrl || 'http://localhost:7782/mcp').padEnd(43)} │`);
        console.log('│ 4. Keep Studio Pro running with this project while using your AI agent.  │');
        console.log('└──────────────────────────────────────────────────────────────────────────┘\n');
        console.log(`${INFO} Studio Pro MCP configured for your IDE AI assistant (${state.studioproMcpUrl}).`);
        console.log(`  ${INFO} Note: The setup wizard will continue using mxcli in the background to inspect`);
        console.log('       project configurations, discover MTA settings, and prepare workspace scaffolding.');
        state.catalogChoice = 'skip';
        if (state.licenseTier === 'free_exploratory') {
          nextStep = 'app_name';
        } else {
          const hasConfiguredInstance = Boolean(state.appInstances?.length && state.defaultInstanceName);
          nextStep = hasConfiguredInstance ? 'app_name' : 'mta_instances';
        }
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
        if (state.licenseTier === 'free_exploratory') {
          nextStep = 'app_name';
        } else {
          const hasConfiguredInstance = Boolean(state.appInstances?.length && state.defaultInstanceName);
          nextStep = hasConfiguredInstance ? 'app_name' : 'mta_instances';
        }
      }
    } else if (currentStep === 'mta_instances') {
      const knownInstances = (state.appInstances && state.appInstances.length > 0)
        ? state.appInstances
        : (state.discoveredMta?.instances && state.discoveredMta.instances.length > 0)
          ? state.discoveredMta.instances
          : (existingConfig.app_instances || []);

      if (!editingSingleSetting && knownInstances.length > 0 && state.defaultInstanceName) {
        state.appInstances = knownInstances;
        const active = state.appInstances.find(x => x.name.toLowerCase() === state.defaultInstanceName.toLowerCase()) || state.appInstances[0];
        state.defaultInstanceName = active.name;
        state.defaultInstanceToken = active.token || state.defaultInstanceToken;
        state.activeConfig = active;
        console.log(`\n${PASS} MTA App Instance: [${state.defaultInstanceName}] (from configuration '${state.defaultInstanceName}')`);
        nextStep = 'app_name';
      } else {
        console.log('\n--- MTA Connection & Application Instances ---');
        let stepSubBack = false;

        if (knownInstances.length > 0) {
          state.appInstances = knownInstances;
          console.log(`\n${FOUND} Discovered ${state.appInstances.length} App Instance Token(s) across Mendix project configurations:`);
          state.appInstances.forEach((inst, idx) => {
            const isDef = inst.name.toLowerCase() === (state.defaultInstanceName || '').toLowerCase();
            const previewToken = inst.token ? (inst.token.length > 12 ? `${inst.token.slice(0, 8)}...${inst.token.slice(-4)}` : inst.token) : '(none)';
            const urlInfo = inst.mtaUrl ? ` -> MTA: ${inst.mtaUrl}` : '';
            console.log(`  [${idx + 1}] ${inst.name.padEnd(25)} (Token: ${previewToken})${urlInfo}${isDef ? ' <-- Default' : ''}`);
          });

          if (state.appInstances.length === 1 && !editingSingleSetting) {
            state.defaultInstanceName = state.appInstances[0].name;
            state.defaultInstanceToken = state.appInstances[0].token;
            state.activeConfig = state.appInstances[0];
            console.log(`\nDefault instance: [${state.defaultInstanceName}]`);
          } else {
            let defaultIdx = 1;
            if (state.defaultInstanceName) {
              const foundIdx = state.appInstances.findIndex(x => x.name.toLowerCase() === state.defaultInstanceName.toLowerCase());
              if (foundIdx >= 0) defaultIdx = foundIdx + 1;
            }
            console.log(`\n*(Note: The selected instance must be running and connected to MTA when you execute tests)*`);
            const choice = await ask(`Select default instance for ExecuteTest (1-${state.appInstances.length})`, String(defaultIdx));
            if (isBack(choice)) {
              stepSubBack = true;
            } else {
              const parsed = parseInt(choice, 10);
              let selIdx = defaultIdx;
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

          let instSubStep = 'has_instances';
          const instSubHistory = [];
          let instCount = 1;
          const newInstances = [];
          const defaultHasInst = existingInstances.length ? 'y' : state.hasInstancesManual;

          while (instSubStep !== 'DONE' && !stepSubBack) {
            let nextInstSub = null;
            let instSubGoBack = false;

            if (instSubStep === 'has_instances') {
              const hasInstancesAns = await ask('Do you have an MTA Application Instance to configure? (y/n)', defaultHasInst);
              if (isBack(hasInstancesAns)) {
                instSubGoBack = true;
              } else {
                state.hasInstancesManual = hasInstancesAns.toLowerCase().startsWith('y') ? 'y' : 'n';
                if (state.hasInstancesManual === 'y') {
                  nextInstSub = 'instance_count';
                } else {
                  state.appInstances = [];
                  state.defaultInstanceName = '';
                  state.defaultInstanceToken = '';
                  console.log(`${INFO} Skipped. Automated cloud test execution (ExecuteTest) is inactive.`);
                  console.log('       Local exploratory testing remains fully available via the runtime plugin below.');
                  nextInstSub = 'DONE';
                }
              }
            } else if (instSubStep === 'instance_count') {
              const defaultCount = existingInstances.length ? String(existingInstances.length) : '1';
              const rawCount = await ask('How many MTA application instances do you have?', defaultCount);
              if (isBack(rawCount)) {
                instSubGoBack = true;
              } else {
                instCount = Math.max(1, parseInt(rawCount, 10) || 1);
                nextInstSub = 'inst_name_1';
              }
            } else if (instSubStep.startsWith('inst_name_')) {
              const i = parseInt(instSubStep.replace('inst_name_', ''), 10);
              const existingInst = existingInstances[i - 1];
              const defaultName = newInstances[i - 1]?.name || (existingInst ? existingInst.name : (i === 1 ? 'local' : (i === 2 ? 'test' : `instance-${i}`)));
              const instName = await ask(`Instance #${i} name (e.g. local, test)`, defaultName);
              if (isBack(instName)) {
                instSubGoBack = true;
              } else {
                if (!newInstances[i - 1]) newInstances[i - 1] = {};
                newInstances[i - 1].name = instName.trim();
                nextInstSub = `inst_token_${i}`;
              }
            } else if (instSubStep.startsWith('inst_token_')) {
              const i = parseInt(instSubStep.replace('inst_token_', ''), 10);
              const existingInst = existingInstances[i - 1];
              const defaultToken = newInstances[i - 1]?.token || (existingInst ? existingInst.token : (i === 1 ? (state.defaultInstanceToken || '') : ''));
              let token = '';
              while (!token && !instSubGoBack) {
                token = await ask(`Instance #${i} token (from MTA Portal > Application > Application Instances)`, defaultToken);
                if (isBack(token)) {
                  instSubGoBack = true;
                  break;
                }
                token = token.trim();
                if (!token) {
                  console.log(`${ERROR} Application instance token cannot be empty.`);
                }
              }
              if (!instSubGoBack && token) {
                if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
                  console.log(`${NOTICE} Token does not match standard UUID format, but will be used as entered.`);
                }
                newInstances[i - 1].token = token;
                if (i < instCount) {
                  nextInstSub = `inst_name_${i + 1}`;
                } else if (instCount > 1) {
                  nextInstSub = 'select_default';
                } else {
                  nextInstSub = 'DONE';
                }
              }
            } else if (instSubStep === 'select_default') {
              const defaultSel = state.defaultInstanceName
                ? String(newInstances.findIndex(x => x.name === state.defaultInstanceName) + 1 || 1)
                : '1';
              console.log(`\n*(Note: The selected instance must be running and connected to MTA when you execute tests)*`);
              const choice = await ask(`Select default instance for ExecuteTest (1-${newInstances.length})`, defaultSel);
              if (isBack(choice)) {
                instSubGoBack = true;
              } else {
                const parsed = parseInt(choice, 10);
                let selIdx = 1;
                if (!isNaN(parsed) && parsed >= 1 && parsed <= newInstances.length) {
                  selIdx = parsed;
                }
                state.defaultInstanceName = newInstances[selIdx - 1].name;
                state.defaultInstanceToken = newInstances[selIdx - 1].token;
                state.activeConfig = newInstances[selIdx - 1];
                nextInstSub = 'DONE';
              }
            }

            if (instSubGoBack) {
              if (instSubHistory.length > 0) {
                instSubStep = instSubHistory.pop();
              } else {
                stepSubBack = true;
              }
            } else if (nextInstSub) {
              instSubHistory.push(instSubStep);
              instSubStep = nextInstSub;
            }
          }

          if (!stepSubBack && newInstances.length > 0) {
            state.appInstances = newInstances;
            if (!state.defaultInstanceName) {
              state.defaultInstanceName = state.appInstances[0].name;
              state.defaultInstanceToken = state.appInstances[0].token;
              state.activeConfig = state.appInstances[0];
            }
            console.log(`Default instance: [${state.defaultInstanceName}]`);
          }
        }

        if (stepSubBack) {
          goBack = true;
        } else {
          nextStep = 'app_name';
        }
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
        if (state.licenseTier === 'free_exploratory') {
          state.mtaUrl = 'https://services.menditect.com';
          if (!editingSingleSetting && state.pluginUrl && state.rawPluginToken) {
            nextStep = 'exploratory_mode';
          } else if (!editingSingleSetting && state.pluginUrl) {
            nextStep = 'plugin_token';
          } else {
            nextStep = 'plugin_url';
          }
        } else {
          if (!editingSingleSetting && state.mtaUrl) {
            nextStep = 'mta_token';
          } else {
            nextStep = 'mta_url';
          }
        }
      }
    } else if (currentStep === 'mta_url') {
      console.log('\n--- Paid MTA Server URL ---');
      const candidateUrl = !state.tierSwitched
        ? (state.mtaUrl || state.activeConfig?.mtaUrl || state.discoveredMta?.globalMtaUrl || existingConfig.mta_base_url || '')
        : (state.mtaUrl || '');
      const defaultMtaUrl = (candidateUrl && isPaidMtaServerUrl(candidateUrl)) ? candidateUrl : '';
      let validMtaUrl = '';
      while (!validMtaUrl && !goBack) {
        const ans = await ask('Paid MTA Server URL (e.g. https://mta.menditect.com)', defaultMtaUrl);
        if (isBack(ans)) {
          goBack = true;
          break;
        }
        const cleaned = ans.trim();
        if (!cleaned || cleaned.toLowerCase().includes('services.menditect.com')) {
          console.log(`${ERROR} Please enter a valid Paid MTA Server URL (for example https://mta.menditect.com).`);
          continue;
        }
        validMtaUrl = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned.replace(/^wss?:\/\//i, '')}`;
      }
      if (!goBack && validMtaUrl) {
        state.mtaUrl = validMtaUrl;
        nextStep = 'mta_token';
      }
    } else if (currentStep === 'mta_token') {
      console.log('\n--- Identification Token for a Service Account (MTA Bearer Token) ---');
      console.log('Press Enter to SKIP (leave blank if doing local exploratory testing).\n');
      console.log('  • Purpose:');
      console.log('    Required ONLY for cloud test authoring (creating/updating persistent test suites in MTA Cloud)');
      console.log('    and storing test results in the MTA Cloud Portal. NOT needed for local exploratory testing.');
      console.log('  • How to obtain:');
      console.log('    In the MTA Portal as ServiceAccountManager: go to Service account overview, create a ServiceAccount,');
      console.log('    and ensure "Call MCP primitive tools = Enabled" is checked.');
      console.log('  • 🔒 Where it is saved:');
      console.log('    Stored exclusively in your workspace local .env file as:');
      console.log('      MTA_MCP_AUTH_HEADER="Bearer <token>" (with restricted 0600 file permissions).');
      console.log('    It is git-ignored and NEVER written to mta_config.json, keeping your credentials safe from Git commits.');
      console.log('    The built-in proxy (scripts/mta-proxy.js) reads it from .env dynamically on every Cloud MCP call.\n');
      const defaultMtaToken = state.rawMtaToken || process.env.MTA_MCP_AUTH_HEADER || existingConfig.mta_auth_header || '';
      const ans = await ask('Identification token for a service account (Press Enter to skip / leave blank)', defaultMtaToken);
      if (isBack(ans)) {
        goBack = true;
      } else {
        state.rawMtaToken = ans;
        if (!state.rawMtaToken.trim()) {
          console.log(`${INFO} Identification token for a service account skipped. Cloud authoring tools will remain inactive.`);
        }
        if (!editingSingleSetting && state.pluginUrl && state.rawPluginToken) {
          console.log(`\n${INFO} App Under Test Plugin already configured:`);
          console.log(`  • Plugin MCP URL:   ${state.pluginUrl}`);
          console.log(`  • Plugin Token:     Configured`);
          nextStep = 'exploratory_mode';
        } else if (!editingSingleSetting && state.pluginUrl) {
          nextStep = 'plugin_token';
        } else {
          nextStep = 'plugin_url';
        }
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
        if (!editingSingleSetting && state.rawPluginToken) {
          nextStep = 'exploratory_mode';
        } else {
          nextStep = 'plugin_token';
        }
      }
    } else if (currentStep === 'plugin_token') {
      console.log('\n--- App Under Test Plugin Token (Choose Your Own Secret Value) ---');
      console.log('  • IMPORTANT: This token is a secret value that YOU choose/invent yourself');
      console.log('    (it does NOT come from Menditect!).');
      console.log('  • Purpose: Security token protecting the MtaPluginModule MCP endpoint in your running app.');
      console.log('    Configured in Studio Pro via constant MtaPluginModule.McpServerAccessToken.');
      console.log('  • Security Guideline:');
      console.log('    - For short exploratory test runs on localhost, a simple value (e.g. "1") is acceptable.');
      console.log('    - For cloud or shared runtime environments, a more complex secret token (e.g. a UUID or SHA256 token) is recommended.');
      console.log('  • 🔒 Where it is saved:');
      console.log('    Stored exclusively in your workspace local .env file as:');
      console.log('      PLUGIN_MCP_TOKEN="<token>" (with restricted 0600 file permissions).');
      console.log('    It is git-ignored and NEVER written to mta_config.json.\n');
      const defaultPluginToken = state.rawPluginToken
        || process.env.PLUGIN_MCP_TOKEN
        || state.activeConfig?.pluginToken
        || state.discoveredMta?.globalPluginToken
        || existingConfig.plugin_mcp_token
        || '';
      let enteredToken = '';
      while (!enteredToken && !goBack) {
        const ans = await ask('App under test Plugin Token (choose your own secret value, e.g. "Bearer 1" — not from Menditect)', defaultPluginToken);
        if (isBack(ans)) {
          goBack = true;
          break;
        }
        const cleaned = ans.trim();
        if (!cleaned) {
          console.log(`${ERROR} Plugin token cannot be empty. Please enter your secret token (e.g. "Bearer 1" for local testing or a secure token).`);
          continue;
        }
        enteredToken = cleaned.startsWith('Bearer ') ? cleaned : `Bearer ${cleaned}`;
        state.rawPluginToken = enteredToken;
        nextStep = 'exploratory_mode';
      }
    } else if (currentStep === 'exploratory_mode') {
      console.log('\n================================================================================');
      console.log(' EXPLORATORY TESTING STRATEGY (MTA Runtime Plugin)');
      console.log('================================================================================');
      console.log(' When you ask your AI assistant to test a microflow locally via the MTA Plugin');
      console.log(' (in-memory execution with JVM database transaction rollback):');
      console.log('');
      console.log(' [1] auto_execute (Default / Recommended):');
      console.log('     • High Velocity: The AI writes the full Execution Plan (EP_*.md) to disk');
      console.log('       and dispatches the test in a single turn (< 3 seconds total feedback).');
      console.log('     • Safe by Design: Runs entirely inside the local Mendix JVM and rolls back');
      console.log('       automatically; 0 database rows are modified or left behind.');
      console.log('     • Fully Promotable: The plan is already on disk, so you can promote it');
      console.log('       to a permanent MTA test suite at any time without re-planning.');
      console.log('');
      console.log(' [2] prompt_approval:');
      console.log('     • Strict Governance: The AI writes the Execution Plan and pauses at');
      console.log('       Checkpoint 1, waiting for your explicit approval before executing.');
      console.log('     • Traditional 2-turn conversational flow.');
      console.log('================================================================================\n');

      const defaultModeChoice = state.exploratoryMode === 'prompt_approval' ? '2' : '1';
      const ans = await ask('Select exploratory execution mode: [1] auto_execute (recommended), [2] prompt_approval', defaultModeChoice);
      if (isBack(ans)) {
        goBack = true;
      } else {
        state.exploratoryMode = ans.trim() === '2' ? 'prompt_approval' : 'auto_execute';
        nextStep = 'summary_review';
      }
    } else if (currentStep === 'summary_review') {
      const mcpSource = state.modelSource === '2' ? 'studiopro' : 'mxcli';
      const workspaceType = 'custom';
      const resolvedWorkspaceDir = path.resolve(state.customWorkspaceDir || path.resolve(toolsRootDir, '..'));
      const workspaceLabel = 'External Workspace (Central Tools Hub)';
      const licenseSummary = state.licenseTier === 'paid_enterprise'
        ? 'Paid MTA Server (Enterprise Cloud/On-Premises)'
        : 'Free Exploratory License (wss://services.menditect.com)';
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
      console.log(` [1] Workspace Setup:    ${workspaceLabel} (${resolvedWorkspaceDir})`);
      console.log(` [2] License Tier:       ${licenseSummary}`);
      console.log(` [3] Mendix App Path:    ${state.projectDir || '(none)'}${state.detectedVersion ? ` (Mendix v${state.detectedVersion})` : ''}`);
      console.log(` [4] Model Source:       ${modelSourceSummary}`);
      console.log(` [5] MTA Server & App:   ${state.mtaUrl || '(none)'} (App: ${state.appName || 'MyApp'})`);
      console.log(` [6] Service Token:      ${mtaTokenPreview}`);
      console.log(` [7] App Instances:      ${instanceSummary}`);
      console.log(` [8] Plugin MCP URL:     ${state.pluginUrl || '(none)'}`);
      console.log(` [9] Plugin Token:       ${pluginTokenPreview}`);
      console.log(` [10] Exploratory Mode:  ${state.exploratoryMode === 'auto_execute' ? 'Auto-Execute (1-turn fast local testing)' : 'Prompt Approval (halt at Checkpoint 1)'}`);
      console.log('================================================================================\n');

      console.log('Options:');
      console.log('  • Press [Enter] or type "y" to confirm and save this configuration');
      console.log('  • Type a number [1-10] to jump directly to and edit that setting');
      console.log("  • Type 'b' to go back to the previous question");
      console.log('  • Type "n" or "abort" to exit without saving\n');

      const reviewAns = await ask('Confirm and apply configuration? [Y/n/1-10]', 'y', { allowBack: false });
      const trimmed = reviewAns.trim().toLowerCase();

      if (trimmed === 'b' || trimmed === 'back') {
        goBack = true;
      } else if (trimmed === 'n' || trimmed === 'no' || trimmed === 'abort' || trimmed === 'exit') {
        console.log('\nSetup aborted by user. Exiting without modifying any files.');
        process.exit(0);
      } else if (['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].includes(trimmed)) {
        editingSingleSetting = true;
        if (trimmed === '1') currentStep = 'workspace_dir';
        else if (trimmed === '2') currentStep = 'license_choice';
        else if (trimmed === '3') currentStep = 'project_dir';
        else if (trimmed === '4') currentStep = 'model_source';
        else if (trimmed === '5') currentStep = 'app_name';
        else if (trimmed === '6') currentStep = 'mta_token';
        else if (trimmed === '7') currentStep = 'mta_instances';
        else if (trimmed === '8') currentStep = 'plugin_url';
        else if (trimmed === '9') currentStep = 'plugin_token';
        else if (trimmed === '10') currentStep = 'exploratory_mode';
        continue;
      } else {
        currentStep = 'DONE';
        continue;
      }
    }

    if (goBack) {
      if (editingSingleSetting) {
        if (currentStep === 'catalog_index' || currentStep === 'studiopro_url') {
          currentStep = 'model_source';
        } else if (currentStep === 'mta_url') {
          currentStep = 'app_name';
        } else {
          editingSingleSetting = null;
          currentStep = 'summary_review';
        }
      } else if (stepHistory.length > 0) {
        currentStep = stepHistory.pop();
      } else {
        console.log(`${INFO} Already at the first step.\n`);
      }
    } else if (nextStep) {
      if (editingSingleSetting) {
        if (currentStep === 'project_dir' && nextStep === 'workspace_dir') {
          currentStep = 'mta_plugin_setup';
        } else if (currentStep === 'model_source' && nextStep === 'studiopro_url') {
          currentStep = 'studiopro_url';
        } else if (currentStep === 'model_source' && nextStep === 'catalog_index') {
          currentStep = 'catalog_index';
        } else if (currentStep === 'app_name' && nextStep === 'mta_url') {
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
}

module.exports = {
  showVibeCodingDisclaimer,
  setVibeDisclaimerAcknowledged,
  showDisclaimerAndPreflight,
  hydrateStateFromWorkspaceDir,
  createInitialWizardState,
  runWizardLoop
};
