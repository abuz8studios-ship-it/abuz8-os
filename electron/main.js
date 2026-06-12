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

function createWindow () {
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

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

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
}

if (MCP_MODE) {
  const bridge = process.resourcesPath
    ? path.join(process.resourcesPath, 'mcp', 'abuz8-mcp-stdio.js')
    : path.join(__dirname, 'mcp', 'abuz8-mcp-stdio.js');
  require(bridge);
} else {
  app.whenReady().then(() => {
    installOptionalProbeGuard();
    createWindow();
    // Start the bundled portable core first. This is the clean-machine guarantee:
    // chat/status/memory/MCP endpoints work without a home server or developer paths.
    const log = (m) => {
      const line = `[backends] ${m}`;
      console.log(line);
      backendStatus.push({ t: Date.now(), m });
      try { if (mainWindow) mainWindow.webContents.send('abuz8:backend-log', m); } catch (e) {}
    };
    portableCore.start({ app, log }).catch((e) => log('portable-core error: ' + e.message));

    // Optional connector adoption. These are not required for clean-machine launch.
    backends.startAll(log).catch((e) => log('optional connectors error: ' + e.message));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
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
