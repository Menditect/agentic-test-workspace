const {
  isBack
} = require('./lib/cli-prompt');

const {
  normalizeConfigAliases,
  registerWorkspaceInHub,
  discoverWorkspaceConfigCandidates,
  formatAuthHeader,
  formatBearerToken,
  parseInstanceSelection,
  ensureExecutionPlanFolders
} = require('./lib/workspace-registry');

const {
  getMenditectSetupBlock,
  updateAgentDirectives
} = require('./lib/directives');

const {
  findMxcliBinary,
  initializeMxcli,
  buildProjectCatalog,
  getOrDownloadMxcli
} = require('./lib/mxcli-manager');

const {
  cleanDeploymentDirectory,
  prepareMendixGitRepo,
  isMendixProjectOpenInStudioPro,
  findMpr,
  detectMendixVersion,
  isVersion1112OrHigher,
  isVersion1116OrHigher,
  inspectMendixMtaSettings,
  tryCreateConfigurationInMpr,
  configureMtaPluginInMpr,
  removeSourceModuleFromMpr
} = require('./lib/mendix-model');

const {
  MENDITECT_MARKETPLACE_MODULES,
  extractPlaywrightDriverVersion,
  inspectInstalledMarketplaceModules,
  isPaidMtaServerUrl,
  checkMxcliAuthStatus,
  ensureMxcliAuth,
  resolveCompatibleModuleVersion,
  ensurePlaywrightDriverBundle,
  installMxModuleFromMarketplace,
  syncAndVerifyMaiaSkills
} = require('./lib/marketplace');

const {
  applyWorkspaceConfiguration,
  runDirectivesOnly
} = require('./lib/post-setup');

const {
  showDisclaimerAndPreflight,
  createInitialWizardState,
  runWizardLoop
} = require('./lib/wizard-steps');

async function run(options = {}) {
  const skipSkills = options.skipSkills || process.argv.includes('--skip-skills') || process.argv.includes('--no-skills') || process.argv.includes('--skip-skills-sync');

  await showDisclaimerAndPreflight();

  const state = createInitialWizardState();

  await runWizardLoop(state);

  await applyWorkspaceConfiguration(state, { skipSkills });
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
    MENDITECT_MARKETPLACE_MODULES,
    inspectInstalledMarketplaceModules,
    isPaidMtaServerUrl,
    checkMxcliAuthStatus,
    ensureMxcliAuth,
    resolveCompatibleModuleVersion,
    extractPlaywrightDriverVersion,
    ensurePlaywrightDriverBundle,
    installMxModuleFromMarketplace,
    syncAndVerifyMaiaSkills,
    tryCreateConfigurationInMpr,
    configureMtaPluginInMpr,
    removeSourceModuleFromMpr,
    getOrDownloadMxcli,
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
    isVersion1116OrHigher,
    isBack,
    normalizeConfigAliases,
    ensureExecutionPlanFolders,
    registerWorkspaceInHub,
    discoverWorkspaceConfigCandidates,
    cleanDeploymentDirectory,
    prepareMendixGitRepo,
    isMendixProjectOpenInStudioPro,
    runDirectivesOnly,
    run
  };
}
