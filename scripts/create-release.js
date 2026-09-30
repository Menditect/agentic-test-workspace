const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const releasesDir = path.join(rootDir, 'releases');
const releasesIndexFile = path.join(rootDir, 'RELEASES.md');
const packageJsonFile = path.join(rootDir, 'package.json');

if (!fs.existsSync(releasesDir)) {
  fs.mkdirSync(releasesDir, { recursive: true });
}

function prompt(question, defaultValue) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    const q = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(q, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function getLatestGitCommits() {
  try {
    const latestTag = execSync('git describe --tags --abbrev=0', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    return execSync(`git log ${latestTag}..HEAD --oneline`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
  } catch (e) {
    try {
      return execSync('git log -n 10 --oneline', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    } catch (err) {
      return '';
    }
  }
}

function checkBoundaryPreflight() {
  const forbiddenPatterns = ['mta-ai-assistant', 'mta_ai_assistant'];
  const targetScanDirs = ['releases', 'docs'];
  const targetScanFiles = ['README.md', 'mta_config.schema.json', 'package.json'];
  const violations = [];

  for (const dirName of targetScanDirs) {
    const dirPath = path.join(rootDir, dirName);
    if (!fs.existsSync(dirPath)) continue;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const filePath = path.join(dirPath, entry.name);
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const lines = content.split(/\r?\n/);
          lines.forEach((line, idx) => {
            for (const term of forbiddenPatterns) {
              if (line.toLowerCase().includes(term)) {
                violations.push({ file: path.relative(rootDir, filePath), line: idx + 1, term, snippet: line.trim() });
              }
            }
          });
        } catch (e) {}
      }
    }
  }

  for (const fileName of targetScanFiles) {
    const filePath = path.join(rootDir, fileName);
    if (!fs.existsSync(filePath)) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split(/\r?\n/);
      lines.forEach((line, idx) => {
        for (const term of forbiddenPatterns) {
          if (line.toLowerCase().includes(term)) {
            violations.push({ file: fileName, line: idx + 1, term, snippet: line.trim() });
          }
        }
      });
    } catch (e) {}
  }

  return violations;
}

async function run() {
  const boundaryViolations = checkBoundaryPreflight();
  if (boundaryViolations.length > 0) {
    console.error('\n[RELEASE ABORTED] Public boundary violations detected:');
    boundaryViolations.forEach(v => console.error(`  - ${v.file}:${v.line} -> "${v.snippet}"`));
    console.error('All files, contracts, and skills must refer to official public repository "agentic-test-skills".');
    console.error('Please fix the above references before publishing a release.\n');
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(packageJsonFile, 'utf8'));
  const currentVersion = pkg.version || '1.0.0';

  const parts = currentVersion.split('.').map(Number);
  const defaultNextVersion = `${parts[0]}.${parts[1]}.${(parts[2] || 0) + 1}`;

  const argVersion = process.argv[2];
  const argSummary = process.argv[3];

  const versionInput = argVersion || await prompt('Release version (without "v")', defaultNextVersion);
  const version = versionInput.startsWith('v') ? versionInput : `v${versionInput}`;
  const rawVersion = version.replace(/^v/, '');

  const summary = argSummary || await prompt('Key highlights / summary of this release', 'Maintenance and feature updates');

  const today = new Date().toISOString().split('T')[0];
  const releaseFile = path.join(releasesDir, `${version}.md`);

  const commits = getLatestGitCommits();
  const commitSection = commits
    ? `\n### Recent Changes\n\n\`\`\`\n${commits}\n\`\`\`\n`
    : '';

  const releaseContent = `# Menditect Agent Workspace Template - Release Notes

## Version ${version}

> Released on: ${today}

### Release Summary
${summary}

---

### Detailed Changes
- Document changes here.
${commitSection}
---

### Upgrading / Migration Notes
No breaking changes. Run \`npm run update:skills\` and \`npm run update:mxcli\` to ensure dependencies are current.
`;

  fs.writeFileSync(releaseFile, releaseContent, 'utf8');
  console.log(`Created ${path.relative(rootDir, releaseFile)}`);

  // Update RELEASES.md table
  if (fs.existsSync(releasesIndexFile)) {
    let indexContent = fs.readFileSync(releasesIndexFile, 'utf8');
    const tableHeaderRegex = /(\| Release Version \| Date \| Key Highlights \/ Release Message \|\r?\n\| :--- \| :--- \| :--- \|\r?\n)/;
    const eol = indexContent.includes('\r\n') ? '\r\n' : '\n';
    const newRow = `| [${version}](releases/${version}.md) | ${today} | ${summary} |${eol}`;

    if (tableHeaderRegex.test(indexContent)) {
      indexContent = indexContent.replace(tableHeaderRegex, `$1${newRow}`);
      fs.writeFileSync(releasesIndexFile, indexContent, 'utf8');
      console.log(`Updated ${path.relative(rootDir, releasesIndexFile)}`);
    }
  }

  // Bump package.json version
  pkg.version = rawVersion;
  fs.writeFileSync(packageJsonFile, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`Updated package.json version to ${rawVersion}`);

  // Display mta_config contract independence guardrail
  const schemaPath = path.join(rootDir, 'mta_config.schema.json');
  let schemaVersion = 'unknown';
  if (fs.existsSync(schemaPath)) {
    try {
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
      schemaVersion = schema.version || 'unknown';
    } catch (e) {}
  }
  console.log(`\n[CONTRACT GUARDRAIL]`);
  console.log(`  The mta_config contract version is currently v${schemaVersion}.`);
  console.log(`  This contract is governed independently by agentic-test-skills (Menditect/agentic-test-skills).`);
  console.log(`  DO NOT modify mta_config.schema.json or the contract sections in README.md`);
  console.log(`  during template releases. Only package.json, RELEASES.md, and releases/${version}.md apply.`);

  console.log(`\nRelease ${version} prepared successfully.`);
  console.log('Next steps:');
  console.log(`  1. Review and edit releases/${version}.md`);
  console.log(`  2. Commit on development: git commit -am "chore(release): ${version}"`);
  console.log('  3. Push development: git push origin development');
  console.log('  4. Merge to main and push (triggers automated GitHub Release):');
  console.log('     git checkout main && git pull origin main && git merge development --no-edit && git push origin main && git checkout development');
  console.log('  5. ALWAYS ensure you are back on development: git checkout development');
}

run();
