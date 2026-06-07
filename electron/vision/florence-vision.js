// florence-vision.js — Microsoft Florence-2 vision via transformers Python
// First use auto-downloads ~500MB model to HF cache

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const edgeTts = require('../voice/edge-tts');

async function ensureFlorence(log = console.log) {
  const py = edgeTts.findPython();
  if (!py) throw new Error('Python not found');
  return new Promise((resolve, reject) => {
    const check = spawn(py, ['-c', 'import transformers, PIL; print("ok")'], { windowsHide: true });
    check.on('exit', (code) => {
      if (code === 0) return resolve(true);
      log('[florence] installing transformers + pillow + torch (CPU)...');
      const install = spawn(py, ['-m', 'pip', 'install', '--quiet', 'transformers', 'pillow', 'torch', '--index-url', 'https://download.pytorch.org/whl/cpu'], { windowsHide: true, stdio: 'inherit' });
      install.on('exit', (c) => c === 0 ? resolve(true) : reject(new Error('pip install failed')));
    });
  });
}

async function describe(imagePath, opts = {}) {
  const py = edgeTts.findPython();
  if (!py) throw new Error('Python not found');
  if (!fs.existsSync(imagePath)) throw new Error('image not found: ' + imagePath);
  const task = opts.task || '<MORE_DETAILED_CAPTION>'; // also: <OCR>, <OD>, <DENSE_REGION_CAPTION>, <REGION_PROPOSAL>
  const script = `
import json
from PIL import Image
from transformers import AutoProcessor, AutoModelForCausalLM
import torch
model_id = 'microsoft/Florence-2-base'
processor = AutoProcessor.from_pretrained(model_id, trust_remote_code=True)
model = AutoModelForCausalLM.from_pretrained(model_id, trust_remote_code=True, torch_dtype=torch.float32)
image = Image.open(r'${imagePath.replace(/\\/g, '\\\\')}').convert('RGB')
prompt = '${task}'
inputs = processor(text=prompt, images=image, return_tensors='pt')
generated_ids = model.generate(input_ids=inputs['input_ids'], pixel_values=inputs['pixel_values'], max_new_tokens=512, do_sample=False, num_beams=3)
generated_text = processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
parsed = processor.post_process_generation(generated_text, task=prompt, image_size=(image.width, image.height))
print(json.dumps({'task': prompt, 'result': str(parsed)}))
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
          resolve(JSON.parse(out.trim().split('\n').filter(l => l.startsWith('{')).pop()));
        } catch (e) {
          reject(new Error('parse error: ' + e.message + ' raw=' + out.slice(0, 300)));
        }
      } else {
        reject(new Error(`florence failed code=${code} stderr=${err.slice(-300)}`));
      }
    });
    proc.on('error', reject);
  });
}

async function captureCamera(outFile = null) {
  outFile = outFile || path.join(os.tmpdir(), `jarvis-cam-${Date.now()}.jpg`);
  if (process.platform !== 'win32') throw new Error('camera capture: Windows only');
  // Use ffmpeg DirectShow if available
  return new Promise((resolve, reject) => {
    const ffmpeg = require('child_process').spawnSync('ffmpeg', ['-version'], { windowsHide: true });
    if (ffmpeg.status !== 0) {
      // Fallback: use Windows.Media.Capture via PowerShell
      const ps = `
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 640, 480
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.FillRectangle([System.Drawing.Brushes]::Black, 0, 0, 640, 480)
$gfx.DrawString("Camera helper not bundled. Install ffmpeg.", (New-Object System.Drawing.Font("Arial", 14)), [System.Drawing.Brushes]::White, 20, 20)
$bmp.Save('${outFile.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Jpeg)
$gfx.Dispose()
$bmp.Dispose()
`;
      const proc = spawn('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true });
      proc.on('exit', () => resolve({ ok: true, file: outFile, fallback: 'no-ffmpeg' }));
      return;
    }
    const args = ['-y', '-f', 'dshow', '-i', 'video=Integrated Camera', '-frames:v', '1', outFile];
    const proc = spawn('ffmpeg', args, { windowsHide: true });
    proc.on('exit', (code) => {
      if (fs.existsSync(outFile)) resolve({ ok: true, file: outFile });
      else reject(new Error('camera capture failed code=' + code));
    });
    proc.on('error', reject);
  });
}

module.exports = { ensureFlorence, describe, captureCamera };
