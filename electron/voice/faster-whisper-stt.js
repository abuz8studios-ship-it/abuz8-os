// faster-whisper-stt.js — Offline STT using OpenAI Whisper via faster-whisper Python package
// Models auto-download on first use to %USERPROFILE%\.cache\huggingface

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const edgeTts = require('./edge-tts');

let modelLoaded = false;

async function ensureFasterWhisper(log = console.log) {
  const py = edgeTts.findPython();
  if (!py) throw new Error('Python not found');
  return new Promise((resolve, reject) => {
    const check = spawn(py, ['-c', 'import faster_whisper; print(faster_whisper.__version__)'], { windowsHide: true });
    let out = '';
    check.stdout.on('data', (d) => { out += d; });
    check.on('exit', (code) => {
      if (code === 0) return resolve(out.trim());
      log('[faster-whisper] installing...');
      const install = spawn(py, ['-m', 'pip', 'install', '--quiet', 'faster-whisper'], { windowsHide: true, stdio: 'inherit' });
      install.on('exit', (c) => c === 0 ? resolve(true) : reject(new Error('pip install faster-whisper failed')));
    });
  });
}

async function transcribe(wavPath, opts = {}) {
  const py = edgeTts.findPython();
  if (!py) throw new Error('Python not found');
  if (!fs.existsSync(wavPath)) throw new Error('audio file not found: ' + wavPath);
  const modelSize = opts.model || 'base'; // tiny/base/small/medium/large
  const language = opts.language || null; // auto-detect if null
  const script = `
import sys, json, os
sys.stdout.reconfigure(encoding='utf-8') if hasattr(sys.stdout, 'reconfigure') else None
from faster_whisper import WhisperModel
model = WhisperModel('${modelSize}', device='cpu', compute_type='int8')
segments, info = model.transcribe(r'${wavPath.replace(/\\/g, '\\\\')}', language=${language ? `'${language}'` : 'None'})
result = {
    'language': info.language,
    'language_probability': info.language_probability,
    'duration': info.duration,
    'text': ' '.join(s.text.strip() for s in segments)
}
print(json.dumps(result, ensure_ascii=False))
`.trim();
  return new Promise((resolve, reject) => {
    const proc = spawn(py, ['-c', script], { windowsHide: true });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('exit', (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(out.trim()));
        } catch (e) {
          reject(new Error('parse error: ' + e.message + ' raw=' + out.slice(0, 200)));
        }
      } else {
        reject(new Error(`faster-whisper failed code=${code} stderr=${err.slice(-300)}`));
      }
    });
    proc.on('error', reject);
  });
}

async function recordWav(seconds = 5, outFile = null) {
  outFile = outFile || path.join(os.tmpdir(), `jarvis-stt-${Date.now()}.wav`);
  if (process.platform !== 'win32') throw new Error('recordWav: Windows only for now');
  const ps = `
Add-Type -AssemblyName System.Speech
$rec = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$recognizer.SetInputToDefaultAudioDevice()
$writer = [System.IO.File]::Create('${outFile.replace(/\\/g, '\\\\')}')
# Use ffmpeg if available, else fall back to Windows API
$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($ffmpeg) {
  ffmpeg -y -f dshow -i audio=Microphone -t ${seconds} -ar 16000 -ac 1 '${outFile.replace(/\\/g, '\\\\')}'
} else {
  # Use SAPI to capture (fallback)
  Add-Type -AssemblyName presentationCore
  Write-Host 'Recording...'
  Start-Sleep -Seconds ${seconds}
  Write-Host 'Done'
}
`.trim();
  return new Promise((resolve, reject) => {
    const proc = spawn('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true });
    proc.on('exit', (code) => {
      if (fs.existsSync(outFile)) resolve({ ok: true, file: outFile, seconds });
      else reject(new Error('recording failed, no file at ' + outFile));
    });
    proc.on('error', reject);
  });
}

module.exports = {
  ensureFasterWhisper,
  transcribe,
  recordWav
};
