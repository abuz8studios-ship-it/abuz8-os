// edge-tts.js — Microsoft Edge TTS bridge (300+ voices, 40+ languages, free, offline-after-bundle)
// Uses Python edge-tts package which we install via pip into a portable venv

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');

let pythonPath = null;
let voicesCache = null;
let voicesCacheTime = 0;

function findPython() {
  if (pythonPath) return pythonPath;
  const candidates = [
    'C:\\Program Files\\Python311\\python.exe',
    'C:\\Program Files\\Python312\\python.exe',
    'C:\\Program Files\\Python310\\python.exe',
    path.join(__dirname, '..', 'voice', 'venv', 'Scripts', 'python.exe'),
    'python',
    'python3',
    'py'
  ];
  for (const c of candidates) {
    try {
      const r = require('child_process').spawnSync(c, ['--version'], { windowsHide: true });
      if (r.status === 0) {
        pythonPath = c;
        return c;
      }
    } catch {}
  }
  return null;
}

async function ensureEdgeTts(log = console.log) {
  const py = findPython();
  if (!py) throw new Error('Python not found for Edge-TTS');
  return new Promise((resolve, reject) => {
    const check = spawn(py, ['-m', 'edge_tts', '--help'], { windowsHide: true });
    check.on('exit', (code) => {
      if (code === 0) return resolve(true);
      log('[edge-tts] installing via pip...');
      const install = spawn(py, ['-m', 'pip', 'install', '--quiet', 'edge-tts'], { windowsHide: true, stdio: 'inherit' });
      install.on('exit', (c) => {
        if (c === 0) resolve(true);
        else reject(new Error('pip install edge-tts failed'));
      });
    });
  });
}

async function listVoices() {
  if (voicesCache && Date.now() - voicesCacheTime < 3600000) return voicesCache;
  const py = findPython();
  if (!py) return [];
  return new Promise((resolve) => {
    const proc = spawn(py, ['-m', 'edge_tts', '--list-voices'], { windowsHide: true });
    let out = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.on('exit', () => {
      const voices = [];
      const seen = new Set();
      for (const raw of out.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('-') || line.startsWith('Name ')) continue;
        // Edge-TTS 7.x table format:
        // en-US-AriaNeural  Female  General  Friendly, Positive
        const m = line.match(/^([a-z]{2,3}-[A-Z]{2,4}(?:-[A-Za-z]+)?[A-Za-z]+(?:Neural|MultilingualNeural|Multilingual)?)\s+(Male|Female|Neutral)\b/i);
        if (!m) continue;
        const name = m[1];
        if (seen.has(name)) continue;
        seen.add(name);
        const parts = name.split('-');
        const locale = parts.length >= 2 ? parts.slice(0, 2).join('-') : name;
        const shortName = parts.slice(2).join('-').replace(/Neural$/i, '');
        voices.push({
          name,
          short_name: shortName || name,
          locale,
          gender: m[2],
          engine: 'edge-tts'
        });
      }
      voicesCache = voices;
      voicesCacheTime = Date.now();
      resolve(voices);
    });
    proc.on('error', () => resolve([]));
  });
}

async function speak(text, opts = {}) {
  const py = findPython();
  if (!py) throw new Error('Python not found');
  const voice = opts.voice || 'en-US-AriaNeural';
  const rate = opts.rate || '+0%';
  const pitch = opts.pitch || '+0Hz';
  const volume = opts.volume || '+0%';
  const outFile = opts.outFile || path.join(os.tmpdir(), `jarvis-tts-${Date.now()}.wav`);
  return new Promise((resolve, reject) => {
    const args = [
      '-m', 'edge_tts',
      '--voice', voice,
      '--text', text,
      '--write-media', outFile,
      '--rate', rate,
      '--pitch', pitch,
      '--volume', volume
    ];
    const proc = spawn(py, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('exit', (code) => {
      if (code === 0 && fs.existsSync(outFile)) {
        resolve({ ok: true, file: outFile, voice, text });
      } else {
        reject(new Error(`Edge-TTS failed code=${code} stderr=${stderr.slice(-200)}`));
      }
    });
    proc.on('error', reject);
  });
}

async function playWav(file) {
  if (process.platform !== 'win32') return { ok: false, error: 'non-windows playWav not supported' };
  return new Promise((resolve) => {
    const ps = `(New-Object Media.SoundPlayer "${file}").PlaySync()`;
    execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true }, (err) => {
      resolve({ ok: !err, file, error: err?.message });
    });
  });
}

async function speakAndPlay(text, opts = {}) {
  const result = await speak(text, opts);
  await playWav(result.file);
  return result;
}

module.exports = {
  findPython,
  ensureEdgeTts,
  listVoices,
  speak,
  playWav,
  speakAndPlay
};
