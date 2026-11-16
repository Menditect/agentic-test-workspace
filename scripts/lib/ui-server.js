const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');
const {
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
 * Opens a native OS folder selection dialog and returns the selected directory path.
 */
function pickFolderNativeDialog(promptTitle = 'Select Folder', initialDir = '') {
  const cleanTitle = String(promptTitle || 'Select Folder').replace(/["'`$]/g, '');
  const cleanInit = initialDir && fs.existsSync(initialDir) ? path.resolve(initialDir) : '';

  if (process.platform === 'win32') {
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
      const out = execSync(`powershell -NoProfile -Sta -Command "${psScript}"`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 120000
      }).trim();
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
      const out = execSync(`osascript -e 'POSIX path of (choose folder with prompt "${cleanTitle}")'`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 120000
      }).trim();
      if (out) {
        return { cancelled: false, folderPath: out };
      }
      return { cancelled: true, folderPath: '' };
    } catch (err) {
      return { cancelled: true, folderPath: '' };
    }
  }

  try {
    const out = execSync(`zenity --file-selection --directory --title="${cleanTitle}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 120000
    }).trim();
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
 * Opens the given URL in the user's default desktop browser.
 */
function openBrowserUrl(url) {
  try {
    if (process.platform === 'win32') {
      exec(`start "" "${url}"`);
    } else if (process.platform === 'darwin') {
      exec(`open "${url}"`);
    } else {
      exec(`xdg-open "${url}"`);
    }
  } catch (e) {}
}

/**
 * Reads JSON request body from an IncomingMessage.
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
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
 * Sends a JSON HTTP response.
 */
function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
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

    const server = http.createServer(async (req, res) => {
      try {
        const parsedUrl = new URL(req.url, 'http://127.0.0.1');
        const pathname = parsedUrl.pathname;

        if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
          const html = fs.readFileSync(htmlPath, 'utf8');
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store'
          });
          return res.end(html);
        }

        if (req.method === 'GET' && pathname === '/api/init') {
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
          const pickRes = pickFolderNativeDialog(body.title || 'Select Folder', body.initialDir || '');
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
            token,
            email: valRes.email
          });
        }

        if (req.method === 'POST' && pathname === '/api/apply-setup') {
          const body = await readJsonBody(req);
          res.writeHead(200, {
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-store',
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
          }
          return res.end();
        }

        if (req.method === 'POST' && pathname === '/api/shutdown') {
          sendJson(res, 200, { ok: true });
          setTimeout(() => {
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

    const tryListen = port => {
      server.once('error', err => {
        if (err.code === 'EADDRINUSE' && port < 3490) {
          tryListen(port + 1);
        } else {
          reject(err);
        }
      });
      server.listen(port, '127.0.0.1', () => {
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
  pickFolderNativeDialog
};
