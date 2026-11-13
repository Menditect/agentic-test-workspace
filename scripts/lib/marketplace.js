const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const zlib = require('zlib');
const { execSync } = require('child_process');
const { toolsRootDir, PASS, WARN, NOTICE, INFO, ask, isBack } = require('./cli-prompt');
const { findMpr, removeSourceModuleFromMpr } = require('./mendix-model');

const MENDITECT_MARKETPLACE_MODULES = {
  MtaPluginModule: {
    id: '214717',
    moduleName: 'MtaPluginModule',
    displayName: 'MTA App under test Plugin',
    fileName: 'MtaPluginModule.mxmodule',
    infoFileName: 'MtaPluginModule_AppStoreInfo.json',
    requiredFor: 'all',
    role: 'MTAPluginUser'
  },
  MenditectMxFrontendTestKit: {
    id: '206637',
    moduleName: 'MenditectMxFrontendTestKit',
    displayName: 'Menditect Mx Frontend TestKit',
    fileName: 'MenditectMxFrontendTestKit.mxmodule',
    infoFileName: 'MenditectMxFrontendTestKit_AppStoreInfo.json',
    requiredFor: 'paid',
    role: 'MxFrontendTestKitUser'
  },
  MenditectPlaywrightConnector: {
    id: '214764',
    moduleName: 'MenditectPlaywrightConnector',
    displayName: 'Menditect Playwright Connector',
    fileName: 'MenditectPlaywrightConnector.mxmodule',
    infoFileName: 'MenditectPlaywrightConnector_AppStoreInfo.json',
    requiredFor: 'paid',
    role: 'PlaywrightConnectorUser',
    hasDriverBundle: true
  },
  MenditectMtaCommons: {
    id: '254123',
    moduleName: 'MenditectMtaCommons',
    displayName: 'Menditect MTA Commons',
    fileName: 'MenditectMtaCommons.mxmodule',
    infoFileName: 'MenditectMtaCommons_AppStoreInfo.json',
    requiredFor: 'paid',
    role: 'MtaCommonsUser'
  },
  Menditect_AgenticTestSkills: {
    id: '305457',
    moduleName: 'Menditect_AgenticTestSkills',
    displayName: 'Menditect Agentic Test Skills',
    fileName: 'Menditect_AgenticTestSkills.mxmodule',
    infoFileName: 'Menditect_AgenticTestSkills_AppStoreInfo.json',
    requiredFor: 'mendix_project',
    role: null
  }
};

function isPaidMtaServerUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const cleaned = url.trim().toLowerCase();
  if (!cleaned) return false;
  if (cleaned.includes('services.menditect.com')) return false;
  return true;
}

function readZipEntriesFromBuffer(buf) {
  const entries = new Map();
  if (!buf || buf.length < 22) return entries;
  try {
    let eocdPos = -1;
    const minPos = Math.max(0, buf.length - 65557);
    for (let i = buf.length - 22; i >= minPos; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocdPos = i;
        break;
      }
    }
    if (eocdPos < 0) return entries;
    const cdCount = buf.readUInt16LE(eocdPos + 10);
    const cdOffset = buf.readUInt32LE(eocdPos + 16);
    let pos = cdOffset;
    for (let i = 0; i < cdCount && pos + 46 <= buf.length; i++) {
      if (buf.readUInt32LE(pos) !== 0x02014b50) break;
      const method = buf.readUInt16LE(pos + 10);
      const compSize = buf.readUInt32LE(pos + 20);
      const nameLen = buf.readUInt16LE(pos + 28);
      const extraLen = buf.readUInt16LE(pos + 30);
      const commentLen = buf.readUInt16LE(pos + 32);
      const localHeaderOffset = buf.readUInt32LE(pos + 42);
      const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
      entries.set(name, { method, compSize, localHeaderOffset });
      pos += 46 + nameLen + extraLen + commentLen;
    }
  } catch (e) {}
  return entries;
}

function extractZipEntryFromBuffer(buf, entry) {
  if (!entry || entry.localHeaderOffset + 30 > buf.length) return null;
  try {
    const lho = entry.localHeaderOffset;
    if (buf.readUInt32LE(lho) !== 0x04034b50) return null;
    const nameLen = buf.readUInt16LE(lho + 26);
    const extraLen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + nameLen + extraLen;
    const compData = buf.subarray(dataStart, dataStart + entry.compSize);
    if (entry.method === 0) {
      return Buffer.from(compData);
    } else if (entry.method === 8) {
      return zlib.inflateRawSync(compData);
    }
  } catch (e) {}
  return null;
}

function extractVersionFromMxModule(mxmodulePath) {
  if (!mxmodulePath || !fs.existsSync(mxmodulePath)) return null;
  try {
    const buf = fs.readFileSync(mxmodulePath);
    const entries = readZipEntriesFromBuffer(buf);
    const manifestEntry = entries.get('manifest.json');
    if (manifestEntry) {
      const manifestBuf = extractZipEntryFromBuffer(buf, manifestEntry);
      if (manifestBuf) {
        try {
          const manifestJson = JSON.parse(manifestBuf.toString('utf8'));
          if (manifestJson && manifestJson.package && manifestJson.package.version) {
            return String(manifestJson.package.version).trim();
          }
        } catch (e) {}
      }
    }
    for (const [name] of entries.entries()) {
      const m = name.match(/^userlib\/(?:mta-plugin|menditect-[a-z-]+)-([0-9]+\.[0-9]+\.[0-9]+)\.jar$/i);
      if (m) return m[1];
    }
  } catch (e) {}
  return null;
}

function syncAndVerifyMaiaSkills(projectDir, mxmodulePath = '', fallbackSkillsDir = '') {
  if (!projectDir || !fs.existsSync(projectDir)) {
    return { success: false, error: 'Project directory does not exist' };
  }
  const targetSkillsDir = path.join(projectDir, 'skillssource', '_modules', 'menditect_agentictestskills');
  if (!fs.existsSync(targetSkillsDir)) {
    fs.mkdirSync(targetSkillsDir, { recursive: true });
  }

  const effectiveMxModule = mxmodulePath || path.join(projectDir, 'modules', 'Menditect_AgenticTestSkills.mxmodule');
  let extractedCount = 0;

  if (fs.existsSync(effectiveMxModule)) {
    try {
      const buf = fs.readFileSync(effectiveMxModule);
      const entries = readZipEntriesFromBuffer(buf);
      const prefix = 'skillssource/_modules/menditect_agentictestskills/';
      for (const [entryName, entryMeta] of entries.entries()) {
        const normalized = entryName.replace(/\\/g, '/');
        if (normalized.startsWith(prefix) && !normalized.endsWith('/')) {
          const relPath = normalized.slice(prefix.length);
          if (!relPath) continue;
          const fileBuf = extractZipEntryFromBuffer(buf, entryMeta);
          if (fileBuf) {
            const destPath = path.join(targetSkillsDir, relPath);
            const destDir = path.dirname(destPath);
            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
            fs.writeFileSync(destPath, fileBuf);
            extractedCount++;
          }
        }
      }
    } catch (e) {}
  }

  const effectiveFallback = fallbackSkillsDir || path.join(toolsRootDir, 'skills');
  if (extractedCount === 0 && fs.existsSync(effectiveFallback)) {
    try {
      fs.cpSync(effectiveFallback, targetSkillsDir, { recursive: true });
      extractedCount = 1;
    } catch (e) {}
  }

  const expectedSkills = [
    'menditecttestabilityframework',
    'mta-build',
    'mta-install-config',
    'mta-run-analyze',
    'mta-test-design'
  ];
  const hasAgentsMd = fs.existsSync(path.join(targetSkillsDir, 'AGENTS.md'));
  const verifiedSkills = expectedSkills.filter(skill =>
    fs.existsSync(path.join(targetSkillsDir, skill, 'SKILL.md'))
  );

  // Also ensure project-level skillssource/AGENTS.md exists so Studio Pro MAIA's ModuleInstructionsApi loads the orchestrator
  const moduleAgentsPath = path.join(targetSkillsDir, 'AGENTS.md');
  const rootSkillsSourceAgentsPath = path.join(projectDir, 'skillssource', 'AGENTS.md');
  if (hasAgentsMd && !fs.existsSync(rootSkillsSourceAgentsPath)) {
    try {
      fs.copyFileSync(moduleAgentsPath, rootSkillsSourceAgentsPath);
    } catch (e) {}
  }

  return {
    success: hasAgentsMd && verifiedSkills.length === expectedSkills.length,
    targetSkillsDir,
    hasAgentsMd,
    verifiedCount: verifiedSkills.length,
    expectedCount: expectedSkills.length
  };
}

function extractPlaywrightDriverVersion(releaseNotes, mxmodulePath) {
  if (releaseNotes && typeof releaseNotes === 'string') {
    const urlMatch = releaseNotes.match(/driver-bundle\/([0-9]+\.[0-9]+\.[0-9]+)\/driver-bundle-\1\.jar/i);
    if (urlMatch && urlMatch[1]) return urlMatch[1];
    const textMatch = releaseNotes.match(/Playwright\s+Driver\s+Bundle(?:\s+Jar)?[\s\S]{0,80}?\b([0-9]+\.[0-9]+\.[0-9]+)\b/i);
    if (textMatch && textMatch[1]) return textMatch[1];
  }

  if (mxmodulePath && fs.existsSync(mxmodulePath)) {
    try {
      const outerBuf = fs.readFileSync(mxmodulePath);
      const outerEntries = readZipEntriesFromBuffer(outerBuf);
      for (const [name, entry] of outerEntries.entries()) {
        if (/^userlib\/menditect-playwright-connector-.*\.jar$/i.test(name)) {
          const innerJarBuf = extractZipEntryFromBuffer(outerBuf, entry);
          if (innerJarBuf) {
            const innerEntries = readZipEntriesFromBuffer(innerJarBuf);
            const pomEntry = innerEntries.get('META-INF/maven/com.microsoft.playwright/driver/pom.properties');
            if (pomEntry) {
              const pomBuf = extractZipEntryFromBuffer(innerJarBuf, pomEntry);
              if (pomBuf) {
                const pomText = pomBuf.toString('utf8');
                const verMatch = pomText.match(/^\s*version\s*=\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$/m);
                if (verMatch && verMatch[1]) return verMatch[1].trim();
              }
            }
          }
        }
      }
    } catch (e) {}
  }

  return null;
}

function inspectInstalledMarketplaceModules(projectDir) {
  const result = {
    modulesDir: projectDir ? path.join(projectDir, 'modules') : '',
    userlibDir: projectDir ? path.join(projectDir, 'userlib') : '',
    modules: {},
    driverBundle: {
      installed: false,
      version: null,
      fileName: null,
      filePath: null
    }
  };

  if (!projectDir || !fs.existsSync(projectDir)) return result;

  const modulesDir = path.join(projectDir, 'modules');
  for (const [key, spec] of Object.entries(MENDITECT_MARKETPLACE_MODULES)) {
    const mxmodulePath = path.join(modulesDir, spec.fileName);
    const infoPath = path.join(modulesDir, spec.infoFileName);
    const installed = fs.existsSync(mxmodulePath);
    let version = null;
    let appStoreInfo = null;

    if (fs.existsSync(infoPath)) {
      try {
        appStoreInfo = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
        if (appStoreInfo && appStoreInfo.AppStoreVersion) {
          version = String(appStoreInfo.AppStoreVersion).trim();
        }
      } catch (e) {}
    }
    if (installed && !version) {
      version = extractVersionFromMxModule(mxmodulePath) || 'Installed';
    }

    result.modules[key] = {
      ...spec,
      installed,
      version,
      mxmodulePath,
      infoPath,
      appStoreInfo
    };
  }

  const userlibDir = path.join(projectDir, 'userlib');
  if (fs.existsSync(userlibDir)) {
    try {
      const files = fs.readdirSync(userlibDir);
      for (const f of files) {
        const m = f.match(/^driver-bundle-([0-9]+\.[0-9]+\.[0-9]+)\.jar$/i);
        if (m) {
          result.driverBundle = {
            installed: true,
            version: m[1],
            fileName: f,
            filePath: path.join(userlibDir, f)
          };
          break;
        }
      }
    } catch (e) {}
  }

  return result;
}

function compareSemverDesc(a, b) {
  const pa = String(a || '0.0.0').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0.0.0').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] || 0) - (pa[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function isMendixVersionCompatible(minSupported, projectMendixVersion) {
  if (!minSupported || !projectMendixVersion) return true;
  const pMin = String(minSupported).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const pProj = String(projectMendixVersion).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  if (pMin[0] !== pProj[0]) return false;
  for (let i = 0; i < Math.max(pMin.length, pProj.length); i++) {
    const a = pProj[i] || 0;
    const b = pMin[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

function checkMxcliAuthStatus(mxcliBin) {
  if (!mxcliBin) return false;
  try {
    execSync(`"${mxcliBin}" auth status`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10000,
      env: { ...process.env }
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function ensureMxcliAuth(mxcliBin, askFn = null) {
  if (!mxcliBin) return false;
  if (checkMxcliAuthStatus(mxcliBin)) return true;

  const envPat = process.env.MENDIX_PAT || process.env.MXCLI_PAT || '';
  if (envPat) {
    try {
      execSync(`"${mxcliBin}" auth login --token "${envPat.trim()}"`, {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 15000
      });
      if (checkMxcliAuthStatus(mxcliBin)) return true;
    } catch (e) {}
  }

  if (!askFn && !process.stdin.isTTY) {
    return false;
  }

  console.log(`\n${NOTICE} Mendix Marketplace Authentication (PAT):`);
  console.log('  • What token this is: A Mendix Developer Portal Personal Access Token (PAT).');
  console.log('    (NOTE: This is your Mendix account token, NOT a Menditect MTA token).');
  console.log('  • How to create: Go to https://user-settings.mendix.com/ -> Personal Access Tokens');
  console.log('    Create a token and check scope: mx:marketplace-content:read (Marketplace read access).');
  console.log('  • Why this is needed: Studio Pro uses interactive desktop browser SSO which standalone');
  console.log('    CLI tools cannot access. mxcli uses this PAT to query version compatibility');
  console.log('    and download required .mxmodule packages (MtaPluginModule, Menditect_AgenticTestSkills,');
  console.log('    Frontend TestKit, and Playwright Connector) directly into your app\'s modules/ folder.');
  console.log('  • 🔒 Where it is saved:');
  console.log('    - Global CLI credential store: ~/.mxcli/auth.json (mode 0600, user-only permissions)');
  console.log('    - Workspace configuration: .env (MENDIX_PAT=...)');
  console.log('    Once provided, you will not be asked again on this machine.');
  console.log('  • Optional / Manual Alternative: Press Enter to SKIP.');
  console.log('    If skipped, you can download the modules directly in Studio Pro using the Marketplace pane.\n');

  const promptFunc = askFn || ((q, def) => ask(q, def, { allowBack: false }));
  const pat = await promptFunc('Enter your Mendix Personal Access Token (PAT) (or press Enter to skip Marketplace download)', '');
  if (!pat || isBack(pat) || !pat.trim()) {
    return false;
  }

  try {
    execSync(`"${mxcliBin}" auth login --token "${pat.trim()}"`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000
    });
    process.env.MENDIX_PAT = pat.trim();
    console.log(`${PASS} Authenticated mxcli with Mendix Marketplace (stored in ~/.mxcli/auth.json and .env).`);
    return true;
  } catch (err) {
    console.warn(`${WARN} Failed to authenticate mxcli with provided PAT: ${err.message}`);
    return false;
  }
}

function resolveCompatibleModuleVersion(packageId, mendixVersion, mxcliBin) {
  if (!mxcliBin || !packageId) return null;
  const cleanMxVer = (mendixVersion || '11.0.0').trim();
  const major = cleanMxVer.split('.')[0] || '11';

  try {
    const out = execSync(`"${mxcliBin}" marketplace versions ${packageId} --json`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 25000,
      env: { ...process.env }
    });
    const parsed = JSON.parse(out);
    const list = Array.isArray(parsed) ? parsed : (parsed.versions || parsed.items || parsed.data || []);
    if (!Array.isArray(list) || list.length === 0) return null;

    const normalized = list.map(item => {
      const ver = String(item.version || item.Version || item.versionNumber || item.number || '').trim();
      const minMx = String(item.minSupportedMendixVersion || item.MinSupportedMendixVersion || item.mendixVersion || item.frameworkVersion || '').trim();
      const releaseNotes = item.releaseNotes || item.ReleaseNotes || item.notes || '';
      const versionGuid = item.guid || item.Guid || item.versionGuid || item.VersionGuid || item.id || item.uuid || '';
      const appStoreGuid = item.appStoreGuid || item.AppStoreGuid || item.packageGuid || versionGuid;
      return {
        version: ver,
        minSupportedMendixVersion: minMx,
        releaseNotes,
        versionGuid,
        appStoreGuid,
        raw: item
      };
    }).filter(v => v.version);

    let candidates = normalized.filter(v => {
      const verMajor = v.version.split('.')[0];
      if (verMajor !== major) return false;
      if (v.minSupportedMendixVersion && !isMendixVersionCompatible(v.minSupportedMendixVersion, cleanMxVer)) {
        return false;
      }
      return true;
    });

    if (candidates.length === 0) {
      candidates = normalized.filter(v => v.version.split('.')[0] === major);
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => compareSemverDesc(a.version, b.version));
    return candidates[0];
  } catch (e) {
    return null;
  }
}

function downloadBinaryFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const options = { headers: { 'User-Agent': 'Menditect-Workspace-Setup' } };
    https.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadBinaryFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode >= 400) {
        return reject(new Error(`HTTP ${res.statusCode} when downloading ${url}`));
      }
      const dir = path.dirname(destPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve(destPath));
      });
    }).on('error', (err) => {
      try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (e) {}
      reject(err);
    });
  });
}

async function ensurePlaywrightDriverBundle(projectDir, releaseNotes = '', mxmodulePath = '') {
  if (!projectDir || !fs.existsSync(projectDir)) {
    return { success: false, error: 'Project directory does not exist' };
  }

  const effectiveMxModule = mxmodulePath || path.join(projectDir, 'modules', 'MenditectPlaywrightConnector.mxmodule');
  const requiredVersion = extractPlaywrightDriverVersion(releaseNotes, effectiveMxModule);
  if (!requiredVersion) {
    return { success: false, error: 'Could not determine required Playwright driver-bundle version' };
  }

  const userlibDir = path.join(projectDir, 'userlib');
  if (!fs.existsSync(userlibDir)) {
    fs.mkdirSync(userlibDir, { recursive: true });
  }

  const targetFileName = `driver-bundle-${requiredVersion}.jar`;
  const targetFilePath = path.join(userlibDir, targetFileName);

  try {
    const existingFiles = fs.readdirSync(userlibDir);
    for (const f of existingFiles) {
      if (/^driver-bundle-.*\.jar/i.test(f) && f !== targetFileName) {
        try {
          fs.unlinkSync(path.join(userlibDir, f));
          console.log(`  Removed outdated Playwright driver bundle: userlib/${f}`);
        } catch (e) {}
      }
    }
  } catch (e) {}

  if (fs.existsSync(targetFilePath)) {
    return { success: true, version: requiredVersion, filePath: targetFilePath, alreadyInstalled: true };
  }

  const mavenUrl = `https://repo1.maven.org/maven2/com/microsoft/playwright/driver-bundle/${requiredVersion}/${targetFileName}`;
  console.log(`  Downloading Playwright Driver Bundle (${targetFileName}) from Maven Central...`);
  try {
    await downloadBinaryFile(mavenUrl, targetFilePath);
    console.log(`  ${PASS} Installed Playwright Driver Bundle at userlib/${targetFileName}`);
    return { success: true, version: requiredVersion, filePath: targetFilePath, alreadyInstalled: false };
  } catch (err) {
    console.warn(`  ${WARN} Failed to download ${mavenUrl}: ${err.message}`);
    return { success: false, version: requiredVersion, error: err.message };
  }
}

async function installMxModuleFromMarketplace(modSpec, projectDir, mendixVersion, mxcliBin, options = {}) {
  if (!modSpec || !projectDir || !mxcliBin) {
    return { success: false, error: 'Missing required arguments' };
  }

  const resolved = options.resolvedVersion || resolveCompatibleModuleVersion(modSpec.id, mendixVersion, mxcliBin);
  if (!resolved || !resolved.version) {
    return {
      success: false,
      error: `Could not resolve a compatible version of ${modSpec.moduleName} (${modSpec.id}) for Mendix ${mendixVersion}`
    };
  }

  const modulesDir = path.join(projectDir, 'modules');
  if (!fs.existsSync(modulesDir)) {
    fs.mkdirSync(modulesDir, { recursive: true });
  }

  if (modSpec.moduleName === 'Menditect_AgenticTestSkills') {
    const mprPath = options.mprPath || findMpr(projectDir);
    if (mprPath && fs.existsSync(mprPath)) {
      removeSourceModuleFromMpr(mprPath, 'Menditect_AgenticTestSkills', mxcliBin);
    }
  }

  const tmpDownloadPath = path.join(os.tmpdir(), `${modSpec.moduleName}-${resolved.version}-${Date.now()}.mpk`);
  try {
    console.log(`  Downloading ${modSpec.moduleName} v${resolved.version} (Marketplace ID ${modSpec.id})...`);
    execSync(`"${mxcliBin}" marketplace download ${modSpec.id} --version "${resolved.version}" -o "${tmpDownloadPath}"`, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
      env: { ...process.env }
    });

    if (!fs.existsSync(tmpDownloadPath)) {
      throw new Error('Download command completed but output file was not created');
    }

    const targetMxModulePath = path.join(modulesDir, modSpec.fileName);
    const downloadedBuf = fs.readFileSync(tmpDownloadPath);
    const zipEntries = readZipEntriesFromBuffer(downloadedBuf);

    let innerMxModuleEntry = null;
    let innerAppStoreInfoEntry = null;
    for (const [entryName, entryMeta] of zipEntries.entries()) {
      if (entryName.toLowerCase().endsWith('.mxmodule')) {
        innerMxModuleEntry = entryMeta;
      } else if (entryName.toLowerCase().endsWith('_appstoreinfo.json')) {
        innerAppStoreInfoEntry = entryMeta;
      }
    }

    if (innerMxModuleEntry) {
      const extractedMxModule = extractZipEntryFromBuffer(downloadedBuf, innerMxModuleEntry);
      if (!extractedMxModule) {
        throw new Error(`Failed to extract ${modSpec.fileName} from downloaded package`);
      }
      fs.writeFileSync(targetMxModulePath, extractedMxModule);
    } else {
      fs.copyFileSync(tmpDownloadPath, targetMxModulePath);
    }

    const targetInfoPath = path.join(modulesDir, modSpec.infoFileName);
    let infoObj = {
      AppStoreGuid: resolved.appStoreGuid || resolved.versionGuid || '',
      AppStoreVersionGuid: resolved.versionGuid || resolved.appStoreGuid || '',
      AppStoreVersion: resolved.version,
      AppStorePackageId: String(modSpec.id)
    };

    if (innerAppStoreInfoEntry) {
      const extractedInfo = extractZipEntryFromBuffer(downloadedBuf, innerAppStoreInfoEntry);
      if (extractedInfo) {
        try {
          const parsedInfo = JSON.parse(extractedInfo.toString('utf8'));
          infoObj = { ...infoObj, ...parsedInfo, AppStoreVersion: resolved.version, AppStorePackageId: String(modSpec.id) };
        } catch (e) {}
      }
    } else if (fs.existsSync(targetInfoPath)) {
      try {
        const existingInfo = JSON.parse(fs.readFileSync(targetInfoPath, 'utf8'));
        infoObj = {
          AppStoreGuid: resolved.appStoreGuid || existingInfo.AppStoreGuid || '',
          AppStoreVersionGuid: resolved.versionGuid || existingInfo.AppStoreVersionGuid || '',
          AppStoreVersion: resolved.version,
          AppStorePackageId: String(modSpec.id)
        };
      } catch (e) {}
    }

    fs.writeFileSync(targetInfoPath, JSON.stringify(infoObj), 'utf8');

    if (modSpec.moduleName === 'MtaPluginModule') {
      const userlibDir = path.join(projectDir, 'userlib');
      if (fs.existsSync(userlibDir)) {
        try {
          for (const f of fs.readdirSync(userlibDir)) {
            if (/^mta-plugin-.*\.jar/i.test(f)) {
              try { fs.unlinkSync(path.join(userlibDir, f)); } catch (e) {}
            }
          }
        } catch (e) {}
      }
    }

    console.log(`  ${PASS} Installed ${modSpec.fileName} (v${resolved.version}) in modules/`);

    if (modSpec.moduleName === 'Menditect_AgenticTestSkills') {
      const syncRes = syncAndVerifyMaiaSkills(projectDir, targetMxModulePath, path.join(toolsRootDir, 'skills'));
      if (syncRes.success) {
        console.log(`  ${PASS} Synchronized & verified MAIA skills in ${path.relative(projectDir, syncRes.targetSkillsDir)} (${syncRes.verifiedCount}/${syncRes.expectedCount} skills + AGENTS.md)`);
      }
    }

    let driverBundleResult = null;
    if (modSpec.hasDriverBundle) {
      driverBundleResult = await ensurePlaywrightDriverBundle(projectDir, resolved.releaseNotes, targetMxModulePath);
    }

    return {
      success: true,
      version: resolved.version,
      releaseNotes: resolved.releaseNotes,
      mxmodulePath: targetMxModulePath,
      driverBundleResult
    };
  } catch (err) {
    console.warn(`  ${WARN} Failed to install ${modSpec.moduleName}: ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    try {
      if (fs.existsSync(tmpDownloadPath)) fs.unlinkSync(tmpDownloadPath);
    } catch (e) {}
  }
}

async function syncProjectMarketplaceModules(state, askFn, mxcliBin, options = {}) {
  if (!state.projectDir || !fs.existsSync(state.projectDir) || !state.mprPath || !fs.existsSync(state.mprPath)) {
    return { success: false, updatedCount: 0 };
  }
  const installedInfo = inspectInstalledMarketplaceModules(state.projectDir);
  const mxVer = state.detectedVersion || '11.0.0';
  let modulesUpdatedCount = 0;

  const authed = await ensureMxcliAuth(mxcliBin, askFn || ask);
  if (!authed) {
    console.warn(`  ${WARN} Skipping automated module updates from Mendix Marketplace (PAT not provided). Run "npm run update:modules" anytime.`);
    return { success: false, updatedCount: 0 };
  }

  const isPaid = (state.licenseTier === 'paid_enterprise') || isPaidMtaServerUrl(state.mtaUrl);
  const isMendixProjectWorkspace = (state.workspaceChoice === '2' || state.workspaceChoice === '3' || state.workspaceType === 'mendix_project');

  const modsToCheck = [MENDITECT_MARKETPLACE_MODULES.MtaPluginModule];

  if (isMendixProjectWorkspace) {
    modsToCheck.push(MENDITECT_MARKETPLACE_MODULES.Menditect_AgenticTestSkills);
  }

  if (isPaid || installedInfo.modules.MenditectMxFrontendTestKit?.installed || installedInfo.modules.MenditectPlaywrightConnector?.installed || installedInfo.modules.MenditectMtaCommons?.installed) {
    modsToCheck.push(
      MENDITECT_MARKETPLACE_MODULES.MenditectMxFrontendTestKit,
      MENDITECT_MARKETPLACE_MODULES.MenditectPlaywrightConnector,
      MENDITECT_MARKETPLACE_MODULES.MenditectMtaCommons
    );
  }

  console.log(`\nChecking Menditect Marketplace module versions for Mendix ${mxVer}...`);
  let playwrightReleaseNotes = '';
  for (const spec of modsToCheck) {
    const locInfo = installedInfo.modules[spec.moduleName] || {};
    const resolvedRemote = resolveCompatibleModuleVersion(spec.id, mxVer, mxcliBin);
    if (!resolvedRemote || !resolvedRemote.version) continue;
    if (spec.hasDriverBundle && resolvedRemote.releaseNotes) {
      playwrightReleaseNotes = resolvedRemote.releaseNotes;
    }
    const isOutdated = !locInfo.installed || locInfo.version !== resolvedRemote.version;
    if (isOutdated) {
      const actionLabel = !locInfo.installed ? 'Installing missing' : `Updating ${locInfo.version ? `v${locInfo.version}` : 'installed'} -> v${resolvedRemote.version} for`;
      console.log(`  ${INFO} ${actionLabel} ${spec.displayName} (${spec.fileName})...`);
      await installMxModuleFromMarketplace(spec, state.projectDir, mxVer, mxcliBin, { resolvedVersion: resolvedRemote });
      modulesUpdatedCount++;
    } else {
      console.log(`  ${PASS} ${spec.fileName} is up to date (v${locInfo.version}).`);
    }
  }

  const refreshedAfterSync = inspectInstalledMarketplaceModules(state.projectDir);
  if (modsToCheck.some(m => m.hasDriverBundle) || refreshedAfterSync.modules.MenditectPlaywrightConnector?.installed) {
    const connectorPath = refreshedAfterSync.modules.MenditectPlaywrightConnector?.mxmodulePath || '';
    const bundleRes = await ensurePlaywrightDriverBundle(state.projectDir, playwrightReleaseNotes, connectorPath);
    if (bundleRes.success && bundleRes.alreadyInstalled) {
      console.log(`  ${PASS} Playwright Driver Bundle (driver-bundle-${bundleRes.version}.jar) is up to date in userlib/.`);
    } else if (bundleRes.success && !bundleRes.alreadyInstalled) {
      modulesUpdatedCount++;
    }
  }

  return { success: true, updatedCount: modulesUpdatedCount };
}

module.exports = {
  MENDITECT_MARKETPLACE_MODULES,
  readZipEntriesFromBuffer,
  extractZipEntryFromBuffer,
  extractVersionFromMxModule,
  extractPlaywrightDriverVersion,
  inspectInstalledMarketplaceModules,
  isPaidMtaServerUrl,
  compareSemverDesc,
  isMendixVersionCompatible,
  checkMxcliAuthStatus,
  ensureMxcliAuth,
  resolveCompatibleModuleVersion,
  downloadBinaryFile,
  ensurePlaywrightDriverBundle,
  installMxModuleFromMarketplace,
  syncProjectMarketplaceModules,
  syncAndVerifyMaiaSkills
};
