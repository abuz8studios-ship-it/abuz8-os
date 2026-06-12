// ABUZ8 OS — Electron main process
// Loads the bundled renderer/index.html into a native window.
// Bismillah.

const { app, BrowserWindow, Menu, shell, ipcMain, session } = require('electron');
const path = require('path');
const portableCore = require('./portable-core');
const backends = require('./backends');  // 2026-06-01: the app owns its backends (LM Studio pattern)

const APP_NAME = 'ABUZ8 OS';
const BG = '#03090d';
const MCP_MODE = process.argv.includes('--mcp');

// Never let a stray async error take the whole app down (the cause of "it froze/died").
process.on('uncaughtException', (e) => { try { console.error('[main] uncaught:', e && e.message); } catch (_) {} });
process.on('unhandledRejection', (e) => { try { console.error('[main] unhandled:', e && (e.message || e)); } catch (_) {} });
// GPU process crashes are common on older iGPUs and can blank the window; disabling
// GPU compositing trades a little smoothness for not dying on a Surface/MX150.
try { app.disableHardwareAcceleration(); } catch (e) {}

let mainWindow = null;
let backendStatus = [];  // live log lines the renderer can show

const OPTIONAL_LOCAL_PORTS = new Set(['3000','5173','7734','8000','8001','8002','8042','8188','8910','9119','11434','1234','18789']);

function installOptionalProbeGuard() {
  // 2026-06-10 audit fix: the previous redirect blackholed every optional
  // connector port (LM Studio 1234, Ollama 11434, ComfyUI 8188, Hermes 9119,
  // OpenClaw 18789, Mission 8910) to a stub that answered HTTP 200, so the UI
  // could never truly connect AND showed false "Connected" states. Probes now
  // hit the real services; an unreachable port fails fast and reads as offline.
}

function createWindow (loadTarget) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: BG,
    title: APP_NAME,
    show: true,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  // Strip default menu in production; keep DevTools on Ctrl+Shift+I
  Menu.setApplicationMenu(null);

  // Prefer loading over http://localhost (secure context → mic works). Fall back
  // to the bundled file if the core URL isn't reachable.
  const fileTarget = path.join(__dirname, 'renderer', 'index.html');
  if (loadTarget && /^https?:\/\//.test(loadTarget)) {
    mainWindow.loadURL(loadTarget).catch(() => mainWindow.loadFile(fileTarget));
    mainWindow.webContents.on('did-fail-load', () => { try { mainWindow.loadFile(fileTarget); } catch (e) {} });
  } else {
    mainWindow.loadFile(fileTarget);
  }

  // Show reliably whether or not 'ready-to-show' fires (it can stall on heavy pages).
  const reveal = () => { try { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } catch (e) {} };
  mainWindow.once('ready-to-show', reveal);
  mainWindow.webContents.once('did-finish-load', reveal);
  setTimeout(reveal, 1500);

  // Open external links in the system browser, not inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost') || url.startsWith('file:')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Keyboard shortcut for DevTools (dev only)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  // Resilience: if the renderer (or GPU/audio) crashes, reload instead of dying.
  mainWindow.webContents.on('render-process-gone', () => { setTimeout(() => { try { mainWindow.reload(); } catch (e) {} }, 500); });
  mainWindow.webContents.on('unresponsive', () => { try { mainWindow.reload(); } catch (e) {} });
}

if (MCP_MODE) {
  const bridge = process.resourcesPath
    ? path.join(process.resourcesPath, 'mcp', 'abuz8-mcp-stdio.js')
    : path.join(__dirname, 'mcp', 'abuz8-mcp-stdio.js');
  require(bridge);
} else {
  app.whenReady().then(async () => {
    installOptionalProbeGuard();
    // Grant microphone access so in-app voice (Whisper STT) works.
    try {
      session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'media' || permission === 'audioCapture' ? true : permission !== 'geolocation'));
      session.defaultSession.setPermissionCheckHandler((wc, permission) => permission === 'media' || permission === 'audioCapture');
      // Let Jarvis SEE the screen: auto-grant getDisplayMedia (primary screen) so
      // "what's on my screen" works without a picker each time.
      const { desktopCapturer } = require('electron');
      session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({ types: ['screen'] }).then((sources) => callback(sources[0] ? { video: sources[0] } : {})).catch(() => callback({}));
      }, { useSystemPicker: false });
    } catch (e) {}

    const log = (m) => {
      const line = `[backends] ${m}`;
      console.log(line);
      backendStatus.push({ t: Date.now(), m });
      try { if (mainWindow) mainWindow.webContents.send('abuz8:backend-log', m); } catch (e) {}
    };
    // Start the bundled portable core FIRST, then load the window over http://localhost
    // so the renderer runs in a secure context (required for microphone capture).
    let port = portableCore.PORT;
    try { const r = await portableCore.start({ app, log }); if (r && r.port) port = r.port; }
    catch (e) { log('portable-core error: ' + e.message); }
    createWindow(`http://127.0.0.1:${port}/app`);

    backends.startAll(log).catch((e) => log('optional connectors error: ' + e.message));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(`http://127.0.0.1:${port}/app`);
    });
  });

  // Kill spawned optional connector children and stop the bundled local API.
  app.on('before-quit', () => {
    try { backends.stopAll(); } catch (e) {}
    try { portableCore.stop(); } catch (e) {}
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // IPC: tell renderer which platform we're on
  ipcMain.handle('abuz8:platform', () => ({
    platform: process.platform,
    version: app.getVersion(),
    name: APP_NAME,
    dataRoot: app.getPath('userData')
  }));

  // IPC: backend status — renderer can show "Qadir UP / ComfyUI UP" etc. + recent log
  ipcMain.handle('abuz8:backends', async () => {
    const out = [];
    for (const b of backends.BACKENDS) {
      out.push({ name: b.name, healthy: b.healthUrl ? await backends.probe(b.healthUrl) : null });
    }
    return { backends: out, log: backendStatus.slice(-40) };
  });
}
