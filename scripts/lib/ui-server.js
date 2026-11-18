/**
 * Visual Workspace Setup Local HTTP Server
 *
 * Security Invariants:
 * - Binds strictly to `127.0.0.1` (loopback only).
 * - Generates a 256-bit cryptographic per-session CSRF token (`X-MTA-Setup-Token`)
 *   injected into `setup-ui.html` and required on all `/api/*` endpoints (SEC-01).
 * - Enforces `Host` header validation (`127.0.0.1` / `localhost`) to block DNS rebinding.
 * - Enforces `Origin` and `Content-Type: application/json` on all POST requests.
 * - Uses `execFileSync` / `execFile` with argument arrays (`shell: false`) for OS dialogs
 *   and browser launching to eliminate shell command injection (SEC-02).
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, execFile, spawn } = require('child_process');
const {
  toolsRootDir,
  PASS,
  INFO,
  WARN,
  ERROR
} = require('./cli-prompt');
const {
  createInitialWizardState,
  hydrateStateFromWorkspaceDir,
  inspectMendixProjectFolder,
  executeVisualSetupPayload,
  getInitialUiBootstrapPayload,
  validateFreeLicenseFields,
  generateFreeExploratoryToken,
  submitToHubSpot
} = require('./setup-core');

/**
 * Walks up parent directories until an existing directory is found (cross-platform).
 * Never returns "" — if `initialDir` is empty or does not exist, falls back to a fast,
 * concrete local folder (`~/Mendix`, `~/Documents/Mendix`, parent of workspace, or `~`)
 * so Windows `IFileOpenDialog` never opens at the virtual Shell root (which stalls
 * enumerating Desktop, OneDrive, Quick Access, and network shares).
 */
function resolveInitialBrowseDir(initialDir) {
  if (initialDir && typeof initialDir === 'string' && initialDir.trim()) {
    let candidate = path.resolve(initialDir.trim().replace(/^["']|["']$/g, ''));
    for (let depth = 0; depth < 12 && candidate; depth++) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
          return candidate;
        }
      } catch (e) {}
      const parent = path.dirname(candidate);
      if (!parent || parent === candidate) break;
      candidate = parent;
    }
  }

  const home = os.homedir();
  const fallbacks = [
    home ? path.join(home, 'Mendix') : '',
    home ? path.join(home, 'Documents', 'Mendix') : '',
    toolsRootDir ? path.dirname(toolsRootDir) : '',
    toolsRootDir || '',
    home || ''
  ];
  for (const fb of fallbacks) {
    if (!fb) continue;
    try {
      if (fs.existsSync(fb) && fs.statSync(fb).isDirectory()) {
        return fb;
      }
    } catch (e) {}
  }
  return '';
}

// Persistent pre-warmed Windows STA Folder Picker worker (cached DLL + pre-warmed ExplorerFrame COM)
let winFolderPickerWorker = null;
let winFolderPickerReady = false;
let winFolderPickerReadyWaiters = [];
let winFolderPickerPending = null;
let winFolderPickerStdoutBuf = '';

function notifyWinFolderPickerReady(ready) {
  const waiters = winFolderPickerReadyWaiters;
  winFolderPickerReadyWaiters = [];
  for (const w of waiters) {
    try {
      w(ready);
    } catch (e) {}
  }
}

function stopWinFolderPickerWorker() {
  notifyWinFolderPickerReady(false);
  if (winFolderPickerPending) {
    const pending = winFolderPickerPending;
    winFolderPickerPending = null;
    pending.resolve(null);
  }
  if (winFolderPickerWorker) {
    try {
      winFolderPickerWorker.kill();
    } catch (e) {}
    winFolderPickerWorker = null;
  }
  winFolderPickerReady = false;
  winFolderPickerStdoutBuf = '';
}

function ensureWinFolderPickerWorker() {
  if (process.platform !== 'win32') return null;
  if (winFolderPickerWorker && !winFolderPickerWorker.killed) {
    return winFolderPickerWorker;
  }
  const psScriptPath = path.join(__dirname, 'modern-folder-picker.ps1');
  if (!fs.existsSync(psScriptPath)) return null;

  try {
    winFolderPickerStdoutBuf = '';
    winFolderPickerReady = false;
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Sta',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        psScriptPath,
        '-ServerMode'
      ],
      {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true
      }
    );

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      winFolderPickerStdoutBuf += chunk;
      let nlIndex;
      while ((nlIndex = winFolderPickerStdoutBuf.indexOf('\n')) !== -1) {
        const line = winFolderPickerStdoutBuf.slice(0, nlIndex).trim();
        winFolderPickerStdoutBuf = winFolderPickerStdoutBuf.slice(nlIndex + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg && msg.ready) {
            winFolderPickerReady = true;
            notifyWinFolderPickerReady(true);
            continue;
          }
          if (winFolderPickerPending) {
            const pending = winFolderPickerPending;
            winFolderPickerPending = null;
            pending.resolve({
              cancelled: Boolean(msg.cancelled || !msg.folderPath),
              folderPath: msg.folderPath ? String(msg.folderPath) : ''
            });
          }
        } catch (e) {}
      }
    });

    child.on('error', () => {
      stopWinFolderPickerWorker();
    });
    child.on('exit', () => {
      stopWinFolderPickerWorker();
    });

    winFolderPickerWorker = child;
    return child;
  } catch (e) {
    return null;
  }
}

function waitForWinFolderPickerReady(timeoutMs = 3500) {
  if (winFolderPickerReady) return Promise.resolve(true);
  const worker = ensureWinFolderPickerWorker();
  if (!worker) return Promise.resolve(false);
  if (winFolderPickerReady) return Promise.resolve(true);
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      const idx = winFolderPickerReadyWaiters.indexOf(onReady);
      if (idx !== -1) winFolderPickerReadyWaiters.splice(idx, 1);
      resolve(winFolderPickerReady);
    }, timeoutMs);
    function onReady(ready) {
      clearTimeout(timer);
      resolve(Boolean(ready));
    }
    winFolderPickerReadyWaiters.push(onReady);
  });
}

function execFileAsync(cmd, args, options) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, options, (err, stdout) => {
      if (err) return reject(err);
      resolve(String(stdout || ''));
    });
  });
}

/**
 * Opens a native OS folder selection dialog and returns the selected directory path.
 * Uses `spawn` / `execFile` (`shell: false`) so paths containing spaces, `&`, `$`, or quotes
 * are never interpreted by a command shell (SEC-02).
 */
async function pickFolderNativeDialog(promptTitle = 'Select Folder', initialDir = '') {
  const cleanTitle = String(promptTitle || 'Select Folder').replace(/["'`$\r\n\t]/g, '');
  const cleanInit = resolveInitialBrowseDir(initialDir).replace(/[\r\n\t]/g, '');

  if (process.platform === 'win32') {
    const worker = ensureWinFolderPickerWorker();
    if (worker && !winFolderPickerReady) {
      await waitForWinFolderPickerReady(3500);
    }
    if (worker && worker.stdin && !worker.stdin.destroyed && !winFolderPickerPending) {
      const workerResult = await new Promise(resolve => {
        const timer = setTimeout(() => {
          if (winFolderPickerPending && winFolderPickerPending.resolve === resolve) {
            winFolderPickerPending = null;
          }
          resolve(null);
        }, 120000);
        winFolderPickerPending = {
          resolve: res => {
            clearTimeout(timer);
            resolve(res);
          }
        };
        try {
          worker.stdin.write(`REQ\t${cleanTitle}\t${cleanInit}\n`);
        } catch (e) {
          clearTimeout(timer);
          winFolderPickerPending = null;
          resolve(null);
        }
      });
      if (workerResult) {
        return workerResult;
      }
    }

    const psScriptPath = path.join(__dirname, 'modern-folder-picker.ps1');
    if (fs.existsSync(psScriptPath)) {
      try {
        const rawOut = await execFileAsync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Sta',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            psScriptPath,
            '-Title',
            cleanTitle,
            '-InitialFolder',
            cleanInit
          ],
          {
            encoding: 'utf8',
            timeout: 120000,
            windowsHide: true
          }
        );
        const out = rawOut.trim();
        if (out) {
          const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          const selected = lines.length ? lines[lines.length - 1] : '';
          if (selected) {
            return { cancelled: false, folderPath: selected };
          }
        }
        return { cancelled: true, folderPath: '' };
      } catch (err) {
        return { cancelled: true, folderPath: '', error: err.message };
      }
    }

    const psScript = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      '[System.Windows.Forms.Application]::EnableVisualStyles();',
      '$owner = New-Object System.Windows.Forms.Form;',
      '$owner.TopMost = $true;',
      '$owner.Width = 0; $owner.Height = 0;',
      '$owner.WindowState = [System.Windows.Forms.FormWindowState]::Minimized;',
      '$owner.Show(); $owner.Hide();',
      '$dlg = New-Object System.Windows.Forms.FolderBrowserDialog;',
      `$dlg.Description = '${cleanTitle.replace(/'/g, "''")}';`,
      '$dlg.ShowNewFolderButton = $true;',
      cleanInit ? `$dlg.SelectedPath = '${cleanInit.replace(/'/g, "''")}';` : '',
      'if ($dlg.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dlg.SelectedPath }'
    ].filter(Boolean).join(' ');

    try {
      const out = (await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-Sta', '-Command', psScript],
        {
          encoding: 'utf8',
          timeout: 120000,
          windowsHide: true
        }
      )).trim();
      if (out) {
        return { cancelled: false, folderPath: out };
      }
      return { cancelled: true, folderPath: '' };
    } catch (err) {
      return { cancelled: true, folderPath: '', error: err.message };
    }
  }

  if (process.platform === 'darwin') {
    try {
      const osaArgs = cleanInit
        ? [
            '-e',
            'on run argv',
            '-e',
            'POSIX path of (choose folder with prompt (item 1 of argv) default location (POSIX file (item 2 of argv)))',
            '-e',
            'end run',
            cleanTitle,
            cleanInit
          ]
        : [
            '-e',
            'on run argv',
            '-e',
            'POSIX path of (choose folder with prompt (item 1 of argv))',
            '-e',
            'end run',
            cleanTitle
          ];
      const out = (await execFileAsync('osascript', osaArgs, {
        encoding: 'utf8',
        timeout: 120000
      })).trim();
      if (out) {
        return { cancelled: false, folderPath: out };
      }
      return { cancelled: true, folderPath: '' };
    } catch (err) {
      return { cancelled: true, folderPath: '' };
    }
  }

  try {
    const zenityArgs = ['--file-selection', '--directory', `--title=${cleanTitle}`];
    if (cleanInit) {
      zenityArgs.push(`--filename=${cleanInit.replace(/\/?$/, '/')}`);
    }
    const out = (await execFileAsync('zenity', zenityArgs, {
      encoding: 'utf8',
      timeout: 120000
    })).trim();
    if (out) {
      return { cancelled: false, folderPath: out };
    }
  } catch (e) {}

  try {
    const kdialogArgs = ['--getexistingdirectory', cleanInit || process.cwd(), '--title', cleanTitle];
    const out = (await execFileAsync('kdialog', kdialogArgs, {
      encoding: 'utf8',
      timeout: 120000
    })).trim();
    if (out) {
      return { cancelled: false, folderPath: out };
    }
  } catch (e) {}

  return {
    cancelled: true,
    folderPath: '',
    error: 'Native folder picker is not available on this OS environment. Please paste the folder path directly.'
  };
}

/**
 * Opens the given localhost URL in the user's default desktop browser without shell interpolation.
 */
function openBrowserUrl(url) {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(String(url || ''))) {
    return;
  }
  try {
    if (process.platform === 'win32') {
      execFile('cmd.exe', ['/c', 'start', '', url], { windowsHide: true });
    } else if (process.platform === 'darwin') {
      execFile('open', [url]);
    } else {
      execFile('xdg-open', [url]);
    }
  } catch (e) {}
}

/**
 * Reads JSON request body from an IncomingMessage and enforces Content-Type: application/json.
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (contentType && !contentType.includes('application/json')) {
      return reject(new Error('Unsupported Content-Type (expected application/json)'));
    }
    let raw = '';
    req.on('data', chunk => {
      raw += chunk.toString('utf8');
      if (raw.length > 2 * 1024 * 1024) {
        reject(new Error('Request payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Sends a JSON HTTP response with security headers.
 */
function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  });
  res.end(body);
}

/**
 * Validates that the HTTP request originates from the local browser session and not
 * from a cross-origin website or DNS-rebinding attack (SEC-01).
 */
function verifyLocalRequestSecurity(req, sessionToken) {
  const hostHeader = String(req.headers.host || '').trim().toLowerCase();
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(hostHeader)) {
    return { valid: false, status: 403, error: 'Forbidden Host header (DNS rebinding protection).' };
  }

  const originHeader = String(req.headers.origin || '').trim().toLowerCase();
  if (originHeader && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(originHeader)) {
    return { valid: false, status: 403, error: 'Forbidden cross-origin request.' };
  }

  const secFetchSite = String(req.headers['sec-fetch-site'] || '').trim().toLowerCase();
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
    return { valid: false, status: 403, error: 'Cross-site requests are prohibited.' };
  }

  const providedToken = String(req.headers['x-mta-setup-token'] || '').trim();
  if (!providedToken || !sessionToken) {
    return { valid: false, status: 403, error: 'Missing setup session CSRF token.' };
  }
  const bufA = Buffer.from(providedToken, 'utf8');
  const bufB = Buffer.from(sessionToken, 'utf8');
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return { valid: false, status: 403, error: 'Invalid setup session CSRF token.' };
  }

  return { valid: true };
}

/**
 * Starts the local Visual Setup Web Server on 127.0.0.1 and opens the browser.
 */
function startVisualSetupServer(options = {}) {
  return new Promise((resolve, reject) => {
    const htmlPath = path.join(__dirname, '..', 'ui', 'setup-ui.html');
    if (!fs.existsSync(htmlPath)) {
      return reject(new Error(`Visual UI template not found at ${htmlPath}`));
    }

    const sessionToken = crypto.randomBytes(32).toString('hex');
    let isApplyingSetup = false;

    const server = http.createServer(async (req, res) => {
      try {
        const hostHeader = String(req.headers.host || '').trim().toLowerCase();
        if (hostHeader && !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(hostHeader)) {
          return sendJson(res, 403, { ok: false, error: 'Forbidden Host header' });
        }

        const parsedUrl = new URL(req.url, 'http://127.0.0.1');
        const pathname = parsedUrl.pathname;

        if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
          const rawHtml = fs.readFileSync(htmlPath, 'utf8');
          const injectedHtml = rawHtml.replace(
            '<head>',
            `<head>\n  <meta name="mta-csrf-token" content="${sessionToken}" />`
          );
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
          });
          return res.end(injectedHtml);
        }

        if (pathname.startsWith('/api/')) {
          const secCheck = verifyLocalRequestSecurity(req, sessionToken);
          if (!secCheck.valid) {
            return sendJson(res, secCheck.status, { ok: false, error: secCheck.error });
          }
        }

        if (req.method === 'GET' && pathname === '/api/init') {
          ensureWinFolderPickerWorker();
          const bootstrap = getInitialUiBootstrapPayload();
          return sendJson(res, 200, { ok: true, ...bootstrap });
        }

        if (req.method === 'POST' && pathname === '/api/hydrate-workspace') {
          const body = await readJsonBody(req);
          const st = createInitialWizardState();
          const hydrated = hydrateStateFromWorkspaceDir(body.workspaceDir, st, { silent: true });
          const projectInspection = st.projectDir ? inspectMendixProjectFolder(st.projectDir) : null;
          return sendJson(res, 200, {
            ok: hydrated,
            state: st,
            projectInspection
          });
        }

        if (req.method === 'POST' && pathname === '/api/pick-folder') {
          const body = await readJsonBody(req);
          const pickRes = await pickFolderNativeDialog(body.title || 'Select Folder', body.initialDir || '');
          return sendJson(res, 200, { ok: true, ...pickRes });
        }

        if (req.method === 'POST' && pathname === '/api/inspect-project') {
          const body = await readJsonBody(req);
          const inspection = inspectMendixProjectFolder(body.projectDir);
          return sendJson(res, 200, { ok: true, inspection });
        }

        if (req.method === 'POST' && pathname === '/api/request-free-license') {
          const body = await readJsonBody(req);
          const valRes = validateFreeLicenseFields(body);
          if (!valRes.valid) {
            return sendJson(res, 400, { ok: false, field: valRes.field, error: valRes.error });
          }

          const token = generateFreeExploratoryToken();
          const hsRes = await submitToHubSpot(
            {
              firstname: valRes.firstname,
              lastname: valRes.lastname,
              email: valRes.email,
              company: valRes.company,
              country: valRes.country
            },
            token
          );

          if (!hsRes.success) {
            return sendJson(res, 502, { ok: false, error: hsRes.error || 'HubSpot submission failed.' });
          }

          return sendJson(res, 200, {
            ok: true,
            email: valRes.email,
            message: 'Thank you for requesting the MTA Exploratory Free Edition. Your license request was received and further instructions will be sent to you by email.'
          });
        }

        if (req.method === 'POST' && pathname === '/api/apply-setup') {
          if (isApplyingSetup) {
            return sendJson(res, 409, { ok: false, error: 'A setup operation is already in progress.' });
          }
          isApplyingSetup = true;
          let body;
          try {
            body = await readJsonBody(req);
          } catch (parseErr) {
            isApplyingSetup = false;
            throw parseErr;
          }

          res.writeHead(200, {
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Transfer-Encoding': 'chunked'
          });

          const writeEvent = obj => {
            try {
              res.write(JSON.stringify(obj) + '\n');
            } catch (e) {}
          };

          try {
            const result = await executeVisualSetupPayload(
              { ...body, skipSkills: options.skipSkills || body.skipSkills },
              (level, message) => {
                writeEvent({ type: 'log', level, message });
              }
            );
            writeEvent({ type: 'result', ok: true, result });
          } catch (err) {
            writeEvent({ type: 'result', ok: false, error: err.message || String(err) });
          } finally {
            isApplyingSetup = false;
          }
          return res.end();
        }

        if (req.method === 'POST' && pathname === '/api/shutdown') {
          sendJson(res, 200, { ok: true });
          setTimeout(() => {
            stopWinFolderPickerWorker();
            server.close(() => process.exit(0));
          }, 250);
          return;
        }

        sendJson(res, 404, { ok: false, error: 'Not found' });
      } catch (err) {
        if (!res.headersSent) {
          sendJson(res, 500, { ok: false, error: err.message || 'Internal server error' });
        } else {
          res.end();
        }
      }
    });

    server.on('close', () => {
      stopWinFolderPickerWorker();
    });
    process.once('exit', () => {
      stopWinFolderPickerWorker();
    });

    const tryListen = port => {
      server.once('error', err => {
        if (err.code === 'EADDRINUSE' && port < 3490) {
          tryListen(port + 1);
        } else {
          reject(err);
        }
      });
      server.listen(port, '127.0.0.1', () => {
        ensureWinFolderPickerWorker();
        const url = `http://127.0.0.1:${port}`;
        console.log('\n======================================================================');
        console.log(` ${PASS} Menditect Visual Workspace Setup is running at:`);
        console.log(`   ${url}`);
        console.log('======================================================================');
        console.log(` ${INFO} Opening your default web browser...`);
        console.log('       (Keep this terminal window open until you finish saving your setup)');
        console.log('       Press Ctrl+C at any time to stop the local setup server.\n');
        if (!options.noOpenBrowser) {
          openBrowserUrl(url);
        }
      });
    };

    tryListen(options.port || 3456);
  });
}

module.exports = {
  startVisualSetupServer,
  pickFolderNativeDialog,
  verifyLocalRequestSecurity
};
