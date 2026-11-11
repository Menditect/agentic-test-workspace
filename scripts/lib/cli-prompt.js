const fs = require('fs');
const path = require('path');
const readline = require('readline');

let rl = null;

function getReadline() {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }
  return rl;
}

function closeReadline() {
  if (rl) {
    rl.close();
    rl = null;
  }
}

const toolsRootDir = path.join(__dirname, '..', '..');
let scriptVersion = '';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(toolsRootDir, 'package.json'), 'utf8'));
  if (pkg.version) scriptVersion = ` (v${pkg.version})`;
} catch (e) {}

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  orange: '\x1b[38;5;208m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

const PASS = `${colors.green}[PASS]${colors.reset}`;
const FAIL = `${colors.red}[FAIL]${colors.reset}`;
const WARN = `${colors.yellow}[WARN]${colors.reset}`;
const NOTICE = `${colors.orange}[NOTICE]${colors.reset}`;
const INFO = `${colors.cyan}[INFO]${colors.reset}`;
const FOUND = `${colors.green}[FOUND]${colors.reset}`;
const ERROR = `${colors.red}[ERROR]${colors.reset}`;
const RESTORE = `${colors.cyan}[RESTORE]${colors.reset}`;

const BACK_ACTION = '__MTA_BACK__';

function isBack(val) {
  if (val === BACK_ACTION) return true;
  if (typeof val === 'string') {
    const trimmed = val.trim().toLowerCase();
    return trimmed === 'b' || trimmed === 'back';
  }
  return false;
}

function ask(question, defaultVal, options = {}) {
  const allowBack = options.allowBack !== false;
  return new Promise(resolve => {
    const activeRl = getReadline();
    if (activeRl.closed) {
      return resolve(defaultVal !== undefined ? String(defaultVal) : '');
    }
    const hasDefault = defaultVal !== undefined && defaultVal !== '';
    let promptStr;
    if (allowBack) {
      promptStr = hasDefault
        ? `${question} [${defaultVal}] (Press Enter to accept, or 'b' to go back): `
        : `${question} (or 'b' to go back): `;
    } else {
      promptStr = hasDefault
        ? `${question} [${defaultVal}] (Press Enter to accept): `
        : `${question}: `;
    }
    activeRl.question(promptStr, answer => {
      const trimmed = answer.trim();
      if (allowBack && (trimmed.toLowerCase() === 'b' || trimmed.toLowerCase() === 'back')) {
        console.log('  ◀ Going back to previous question...\n');
        return resolve(BACK_ACTION);
      }
      const chosen = trimmed || (hasDefault ? String(defaultVal) : '');
      if (!trimmed && hasDefault) {
        console.log(`  -> Selected: ${chosen}`);
      }
      resolve(chosen);
    });
  });
}

module.exports = {
  toolsRootDir,
  scriptVersion,
  colors,
  PASS,
  FAIL,
  WARN,
  NOTICE,
  INFO,
  FOUND,
  ERROR,
  RESTORE,
  BACK_ACTION,
  getReadline,
  closeReadline,
  isBack,
  ask
};
