const https = require('https');
const http = require('http');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const rawArg = (process.argv[2] || 'mta').trim();
const isUrlArg = rawArg.startsWith('http://') || rawArg.startsWith('https://');
const mode = isUrlArg
  ? (rawArg.includes('plugin') ? 'plugin' : (rawArg.includes('7782') ? 'studiopro' : 'mta'))
  : rawArg.toLowerCase();

function loadEnvFile(filePath, overwrite = true) {
  if (!filePath || !fs.existsSync(filePath)) return;
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let val = match[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (overwrite || !process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  } catch (e) {
    // Ignore unreadable .env file
  }
}

function findCandidateDirs() {
  const dirs = [];
  
  // 1. Tool repo directory (lowest priority)
  dirs.push(__dirname);
  dirs.push(path.join(__dirname, '..'));
  
  // 2. Ancestor working directories
  let curr = process.cwd();
  const parents = [];
  for (let i = 0; i < 4; i++) {
    parents.unshift(curr);
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  dirs.push(...parents);
  
  // 3. Explicit MTA_CONFIG_PATH directory (highest priority)
  if (process.env.MTA_CONFIG_PATH) {
    dirs.push(path.dirname(process.env.MTA_CONFIG_PATH));
  }
  
  // Deduplicate preserving last occurrence (highest priority)
  const uniqueDirs = [];
  for (const d of dirs) {
    const resolved = path.resolve(d);
    const idx = uniqueDirs.findIndex(u => u === resolved);
    if (idx !== -1) uniqueDirs.splice(idx, 1);
    if (fs.existsSync(resolved)) {
      uniqueDirs.push(resolved);
    }
  }
  
  return uniqueDirs;
}

let config = {};
let TARGET_URL = '';
let AUTH_HEADER = null;

function refreshConfigAndEnv() {
  const candidateDirs = findCandidateDirs();
  
  for (const dir of candidateDirs) {
    loadEnvFile(path.join(dir, '.env'), true);
    loadEnvFile(path.join(dir, '.env.local'), true);
  }
  
  config = {};
  const possibleConfigPaths = [
    process.env.MTA_CONFIG_PATH,
    ...candidateDirs.map(d => path.join(d, 'mta_config.json'))
  ].filter(Boolean);

  for (const p of possibleConfigPaths) {
    if (fs.existsSync(p)) {
      try {
        config = JSON.parse(fs.readFileSync(p, 'utf8'));
        break;
      } catch (e) {}
    }
  }

  if (mode === 'mta') {
    const baseMtaUrl = config.mta_base_url || config.mta_url || config.mtaUrl || null;
    const derivedMcp = baseMtaUrl ? baseMtaUrl.replace(/\/+$/, '') + '/primitivetools/mcp' : null;
    TARGET_URL = config.mcp_endpoint || derivedMcp || process.env.MTA_MCP_ENDPOINT || (isUrlArg ? rawArg : null) || 'https://mta-trial.mendixcloud.com/primitivetools/mcp';
    AUTH_HEADER = process.env.MTA_MCP_AUTH_HEADER || (process.env.MTA_MCP_TOKEN ? `Bearer ${process.env.MTA_MCP_TOKEN}` : null) || config.mta_auth_header || (process.argv[3] && !process.argv[3].startsWith('-') ? process.argv[3] : null) || null;
  } else if (mode === 'plugin') {
    TARGET_URL = config.plugin_mcp_url || config.plugin_url || config.pluginUrl || process.env.PLUGIN_MCP_URL || (isUrlArg ? rawArg : null) || 'http://localhost:8081/plugin/mcp';
    AUTH_HEADER = process.env.PLUGIN_MCP_TOKEN || config.plugin_mcp_token || config.plugin_token || config.pluginToken || (process.argv[3] && !process.argv[3].startsWith('-') ? process.argv[3] : null) || null;
  } else if (mode === 'studiopro') {
    TARGET_URL = config.studiopro_mcp_url || process.env.STUDIOPRO_MCP_URL || (isUrlArg ? rawArg : null) || 'http://localhost:7782/mcp';
    AUTH_HEADER = null;
  }
}

// Initial configuration and environment evaluation
refreshConfigAndEnv();

let sessionId = null;
let reinitPromise = null;
let cachedTools = null;
let cachedInitParams = {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: `mta-proxy-${mode}`, version: '1.2.0' }
};

const CORE_TOOLS = new Set([
  'AddTestCaseVariationItem', 'AddTestSuiteVariationItem', 'CreateAssertAttributeValueCompare',
  'CreateAssertException', 'CreateAssertMicroflowReturnValue', 'CreateAssertObjectCount',
  'CreateAssertValidationFeedbackMessageCompare', 'CreateAssertValidationFeedbackMessageCount',
  'CreateExecutionUser', 'CreateMicroflowCallTestStep', 'CreateObjectActionTestStep',
  'CreateSelectObjectForAssociation', 'CreateTestCase', 'CreateTestCaseVariation',
  'CreateTestSuite', 'CreateTestSuiteVariation', 'EditAssertAttributeValueCompare',
  'EditAssertException', 'EditAssertMicroflowReturnValueCompare', 'EditAssertObjectCount',
  'EditAssertValidationFeedbackMessageCompare', 'EditAssertValidationFeedbackMessageCount',
  'EditAttributeValue', 'EditAttributeValueFilter', 'EditExecutionUser',
  'EditMicroflowObjectParameter', 'EditMicroflowParameterValue', 'EditTestCase',
  'EditTestCaseVariation', 'EditTestStep', 'EditTestStepAssociation', 'EditTestStepRetrieve',
  'EditTestSuite', 'EditTestSuiteVariation', 'ExecuteTest', 'GenerateMicroflowCallTestStepLocatePage',
  'GenerateMicroflowCallTestStepLocateWidget', 'GetApplicationDetails', 'GetAppModelData',
  'GetExecutionUsers', 'GetTestCaseDetails', 'GetTestConfigurationDetails',
  'GetTestRunResults', 'GetTeststepDetails', 'GetTestSuiteDetails', 'MoveTestStepToOtherTestCase',
  'SetSequenceOfTestCase', 'SetSequenceOfTestStep', 'SetSequenceOfTestSuite',
  'SetTestStepOutputForSelectObjectForChange', 'SetTestStepOutputForSelectObjectForDelete'
]);

const FALLBACK_PLUGIN_SCHEMA = {
  jsonrpc: '2.0',
  result: {
    tools: [
      {
        name: 'execute-testcase',
        description: 'Execute a test case locally in the Mendix application under test.',
        inputSchema: {
          type: 'object',
          properties: {
            testCaseId: { type: 'string', description: 'The unique identifier of the test case.' }
          },
          required: ['testCaseId']
        }
      }
    ]
  }
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function sendHttp(payloadString, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    refreshConfigAndEnv();
    const payload = Buffer.from(payloadString, 'utf-8');
    const urlObj = new URL(TARGET_URL);
    const transport = urlObj.protocol === 'https:' ? https : http;

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Content-Length': payload.length,
      ...customHeaders
    };

    if (AUTH_HEADER) {
      let authVal = AUTH_HEADER.trim();
      if (!authVal.startsWith('Bearer ') && !authVal.startsWith('Basic ')) {
        authVal = `Bearer ${authVal}`;
      }
      headers['Authorization'] = authVal;
    }

    if (sessionId && !headers['mcp-session-id']) {
      headers['mcp-session-id'] = sessionId;
    }

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: headers,
      timeout: mode === 'mta' ? 45000 : 10000
    };

    const req = transport.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.headers['mcp-session-id']) {
          sessionId = res.headers['mcp-session-id'];
        }
        resolve({ statusCode: res.statusCode, statusMessage: res.statusMessage, headers: res.headers, body });
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Connection timeout'));
    });

    req.write(payload);
    req.end();
  });
}

async function ensureUpstreamInitialized() {
  if (reinitPromise) {
    return reinitPromise;
  }

  reinitPromise = (async () => {
    refreshConfigAndEnv();
    sessionId = null;
    const initPayload = JSON.stringify({
      jsonrpc: '2.0',
      id: '__proxy_init__' + Date.now(),
      method: 'initialize',
      params: cachedInitParams
    });

    try {
      const res = await sendHttp(initPayload);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        if (res.headers['mcp-session-id']) {
          sessionId = res.headers['mcp-session-id'];
        }
        // Send notifications/initialized
        const notifyPayload = JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {}
        });
        await sendHttp(notifyPayload).catch(() => {});
        return true;
      }
    } catch (e) {
      // Re-init failed (e.g. server still offline)
    } finally {
      reinitPromise = null;
    }
    return false;
  })();

  return reinitPromise;
}

function isSessionError(statusCode, body) {
  if (statusCode === 400 || statusCode === 404) return true;
  const lower = (body || '').toLowerCase();
  return lower.includes('session') || lower.includes('uninitialized') || lower.includes('not found');
}

async function makeRequest(payloadString, requestId, retryCount = 0) {
  refreshConfigAndEnv();
  let parsedReq = null;
  try {
    parsedReq = JSON.parse(payloadString);
  } catch (e) {
    return;
  }

  // Update cached initialize parameters if received from client
  if (parsedReq && parsedReq.method === 'initialize' && parsedReq.params) {
    cachedInitParams = parsedReq.params;
  }

  // If receiving a downstream request without an active session (e.g. tools/list during verify or tools/call), initialize first
  if (mode === 'mta' && parsedReq && parsedReq.method !== 'initialize' && !sessionId && retryCount === 0) {
    await ensureUpstreamInitialized();
  }

  try {
    const res = await sendHttp(payloadString);

    if (res.headers && res.headers['mcp-session-id']) {
      sessionId = res.headers['mcp-session-id'];
    }

    // Detect stale or broken session and auto-heal
    if (res.statusCode >= 400 && isSessionError(res.statusCode, res.body) && retryCount < 2) {
      sessionId = null;
      const reinitialized = await ensureUpstreamInitialized();
      if (reinitialized) {
        return makeRequest(payloadString, requestId, retryCount + 1);
      }
    }

    // Handle authentication or generic HTTP error
    if (res.statusCode >= 400) {
      sessionId = null;
      if (requestId !== null) {
        let errorMsg = `HTTP ${res.statusCode} ${res.statusMessage || ''}: ${res.body.trim() || 'Internal Server Error'}`;
        const isMtaAuthError = mode === 'mta' && (res.statusCode === 401 || res.statusCode === 403 || res.body.includes('MCP_server_authorize_user') || res.body.includes('substring($TokenWithPrefix'));
        if (isMtaAuthError) {
          errorMsg = `HTTP ${res.statusCode} Authentication failed: The MTA server rejected the identification token. Please verify MTA_MCP_AUTH_HEADER in your .env file. The proxy will pick up new tokens automatically on the next request without needing to restart the IDE.`;
        } else if (res.statusCode === 401 || res.statusCode === 403) {
          const tokenLabel = mode === 'mta' ? 'identification token for a service account' : `${mode.toUpperCase()} Bearer token`;
          errorMsg = `HTTP ${res.statusCode} ${res.statusMessage || ''}: Authentication failed. Please verify your ${tokenLabel} in .env or mta_config.json. The proxy will pick up updates automatically on the next request.`;
        }
        const errResponse = JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: errorMsg.trim() },
          id: requestId
        });
        process.stdout.write(errResponse + '\n');
      }
      return;
    }

    if (!res.body.trim() && requestId !== null) {
      const errResponse = JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Empty response received from MCP endpoint' },
        id: requestId
      });
      process.stdout.write(errResponse + '\n');
      return;
    }

    const isToolsList = parsedReq && parsedReq.method === 'tools/list';

    function processJsonObject(obj) {
      if (isToolsList && obj && obj.result && Array.isArray(obj.result.tools)) {
        if (process.env.FILTER_TOOLS === 'true') {
          obj.result.tools = obj.result.tools.filter(t => CORE_TOOLS.has(t.name));
        }
        obj.result.tools.sort((a, b) => {
          const aPriority = CORE_TOOLS.has(a.name) ? 0 : 1;
          const bPriority = CORE_TOOLS.has(b.name) ? 0 : 1;
          return aPriority - bPriority;
        });
        cachedTools = obj.result.tools;
      }
      return obj;
    }

    // 1. If whole response body is a valid JSON object, output as a single clean line
    const trimmedBody = res.body.trim();
    if (trimmedBody.startsWith('{') || trimmedBody.startsWith('[')) {
      try {
        const obj = JSON.parse(trimmedBody);
        const processed = processJsonObject(obj);
        process.stdout.write(JSON.stringify(processed) + '\n');
        return;
      } catch (e) {
        // If not valid single JSON, proceed to SSE / line-by-line parsing
      }
    }

    // 2. Handle SSE streams or line-delimited events
    const lines = res.body.split('\n');
    for (let l of lines) {
      l = l.trim();
      if (l.startsWith('data:')) {
        l = l.substring(5).trim();
      } else if (l.startsWith('id:') || l.startsWith('event:') || l.startsWith(':') || !l) {
        continue;
      }
      if (l) {
        try {
          const respObj = JSON.parse(l);
          const processed = processJsonObject(respObj);
          process.stdout.write(JSON.stringify(processed) + '\n');
        } catch (e) {
          process.stdout.write(l + '\n');
        }
      }
    }
  } catch (err) {
    handleConnectionError(payloadString, requestId, err, retryCount);
  }
}

async function handleConnectionError(payloadString, requestId, err, retryCount) {
  if (requestId === null) return;
  sessionId = null;

  let parsedReq = null;
  try {
    parsedReq = JSON.parse(payloadString);
  } catch (e) {
    return;
  }

  const isLocalServer = (mode === 'plugin' || mode === 'studiopro');
  const isToolsList = parsedReq && parsedReq.method === 'tools/list';
  const isToolsCall = parsedReq && parsedReq.method === 'tools/call';

  // If server is offline during tools/list, return fallback or cached schema without crashing (disabled in verification mode)
  if (isLocalServer && isToolsList && process.env.MCP_VERIFY_MODE !== 'true') {
    if (mode === 'plugin') {
      const fallbackResponse = JSON.parse(JSON.stringify(FALLBACK_PLUGIN_SCHEMA));
      fallbackResponse.id = requestId;
      process.stdout.write(JSON.stringify(fallbackResponse) + '\n');
      return;
    } else if (mode === 'studiopro') {
      const fallbackTools = cachedTools || [];
      const fallbackResponse = {
        jsonrpc: '2.0',
        id: requestId,
        result: { tools: fallbackTools }
      };
      process.stdout.write(JSON.stringify(fallbackResponse) + '\n');
      return;
    }
  }

  // If server is restarting during tools/call, retry up to 18 times (~27 seconds window)
  const maxRetries = isLocalServer ? 18 : 3;
  if (isLocalServer && (isToolsCall || parsedReq.method === 'initialize') && retryCount < maxRetries) {
    setTimeout(async () => {
      // Prior to replaying tools/call after connection restored, reinitialize upstream
      if (isToolsCall && !sessionId) {
        await ensureUpstreamInitialized();
      }
      makeRequest(payloadString, requestId, retryCount + 1);
    }, 1500);
    return;
  }

  let serverName = mode === 'studiopro' ? 'Mendix Studio Pro' : (mode === 'plugin' ? 'Mendix application' : 'MTA');
  let errMsg = err.message;
  if (err.code === 'ECONNREFUSED' || err.message.includes('timeout') || err.code === 'ECONNRESET') {
    errMsg = `${serverName} at ${TARGET_URL} is currently offline or restarting. Please ensure ${serverName} is running and try again.`;
  }

  const errResponse = JSON.stringify({
    jsonrpc: '2.0',
    error: { code: -32603, message: errMsg },
    id: requestId
  });
  process.stdout.write(errResponse + '\n');
}

rl.on('line', (line) => {
  const trimmedLine = line.trim();
  if (!trimmedLine) return;

  let requestId = null;
  let payloadString = trimmedLine;
  try {
    const parsedReq = JSON.parse(trimmedLine);
    if (parsedReq && parsedReq.id !== undefined) {
      requestId = parsedReq.id;
    }
    if (parsedReq && parsedReq.method === 'tools/call' && parsedReq.params && parsedReq.params.arguments) {
      let argsStr = JSON.stringify(parsedReq.params.arguments);
      argsStr = argsStr.replace(/"AssociationOwner"\s*:\s*"Default"/g, '"AssociationOwner":"_Default"');
      argsStr = argsStr.replace(/"AssociationOwner"\s*:\s*"Both"/g, '"AssociationOwner":"_Both"');
      parsedReq.params.arguments = JSON.parse(argsStr);
      payloadString = JSON.stringify(parsedReq);
    }
  } catch (e) {
    return;
  }

  makeRequest(payloadString, requestId);
});
