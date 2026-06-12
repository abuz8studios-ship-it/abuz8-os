// backends.js - optional connector probes for ABUZ8 OS.
// The bundled portable core owns the required local API on :8900. This module
// only reports/adopts optional services when the buyer machine already has them.

const http = require('http');
const { execFile } = require('child_process');

const BACKENDS = [
  { name: 'portable-core', healthUrl: 'http://127.0.0.1:8900/health', required: true },
  { name: 'ollama', healthUrl: 'http://127.0.0.1:11434/api/tags', required: false, manual: true },
  { name: 'lm-studio', healthUrl: 'http://127.0.0.1:1234/v1/models', required: false, manual: true },
  { name: 'comfyui', healthUrl: 'http://127.0.0.1:8188/system_stats', required: false, manual: true },
  { name: 'docker-mcp', healthUrl: null, required: false, command: 'docker', args: ['mcp', '--help'], manual: true },
];

let logFn = (m) => console.log('[connectors] ' + m);

function probe(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    if (!url) return resolve(false);
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function commandOk(command, args = []) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: 5000 }, (err) => resolve(!err));
  });
}

async function startBackend(b) {
  if (b.manual && !b.required) {
    logFn(`${b.name}: manual connector`);
    return;
  }
  const ok = b.healthUrl ? await probe(b.healthUrl) : await commandOk(b.command, b.args || []);
  logFn(`${b.name}: ${ok ? 'available' : b.required ? 'starting via portable core' : 'not detected'}`);
}

async function startAll(log) {
  if (log) logFn = log;
  await Promise.all(BACKENDS.map(startBackend));
  logFn('connector probe complete.');
}

function stopAll() {
  // Optional connectors are adopted, not spawned. Nothing to stop here.
}

module.exports = { startAll, stopAll, probe, BACKENDS };
