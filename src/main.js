const { app, BrowserWindow, session, shell, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Set userData path to a persistent location
// In snaps, use SNAP_USER_DATA if available, otherwise use standard XDG config directory
if (process.env.SNAP_USER_DATA) {
  // Running in a snap - use snap's persistent user data directory
  app.setPath('userData', process.env.SNAP_USER_DATA);
  // Will be logged after logger is initialized
} else {
  // Not in a snap - use standard config directory
  const userDataPath = path.join(os.homedir(), '.config', 'windows-app-for-linux');
  app.setPath('userData', userDataPath);
  // Will be logged after logger is initialized
}

// Default User-Agent string
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';

// Default connection address
const DEFAULT_CONNECTION_URL = 'https://windows.cloud.microsoft/#/devices';

// Known cloud environment endpoints
const CLOUD_ENVIRONMENTS = {
  commercial: {
    label: 'Commercial',
    url: 'https://windows.cloud.microsoft/#/devices'
  },
  gcchigh: {
    label: 'GCC High',
    url: 'https://rdweb.wvd.azure.us/arm/webclient/index.html'
  },
  dod: {
    label: 'DoD',
    url: 'https://rdweb.wvd.microsoft.us/arm/webclient/index.html'
  },
  custom: {
    label: 'Custom',
    url: null
  }
};

// Log levels
const LOG_LEVELS = {
  ERROR: 0,
  WARNING: 1,
  INFO: 2,
  DEBUG: 3
};

// Application configuration
let appConfig = {
  logLevel: LOG_LEVELS.INFO,
  cloudEnvironment: 'commercial',
  connectionUrl: DEFAULT_CONNECTION_URL,
  userAgent: DEFAULT_USER_AGENT,
  windowWidth: 1024,
  windowHeight: 768
};

// Load configuration from file
function loadConfig() {
  const configPath = path.join(app.getPath('userData'), 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      const loaded = JSON.parse(configData);
      appConfig = { ...appConfig, ...loaded };
      log(LOG_LEVELS.INFO, 'Configuration loaded from', configPath);
    }
  } catch (err) {
    log(LOG_LEVELS.ERROR, 'Error loading configuration:', err.message);
  }
}

// Save configuration to file
function saveConfig() {
  const configPath = path.join(app.getPath('userData'), 'config.json');
  try {
    fs.writeFileSync(configPath, JSON.stringify(appConfig, null, 2), 'utf8');
    log(LOG_LEVELS.INFO, 'Configuration saved to', configPath);
  } catch (err) {
    log(LOG_LEVELS.ERROR, 'Error saving configuration:', err.message);
  }
}

// Logging function with levels
function log(level, ...args) {
  const levelNames = ['ERROR', 'WARNING', 'INFO', 'DEBUG'];
  const levelName = levelNames[level] || 'UNKNOWN';
  
  // Only log if level is at or below current log level
  if (level <= appConfig.logLevel) {
    const timestamp = new Date().toISOString();
    // Format: [TIMESTAMP] [LEVEL] message
    const message = `[${timestamp}] [${levelName}] ${args.join(' ')}`;
    
    // Output directly to console to avoid circular calls
    if (level === LOG_LEVELS.ERROR) {
      console.error(message);
    } else if (level === LOG_LEVELS.WARNING) {
      console.warn(message);
    } else {
      console.log(message);
    }
  }
}

// Convenience logging functions - all logs will have [LEVEL] prefix
const logger = {
  error: (...args) => log(LOG_LEVELS.ERROR, ...args),
  warning: (...args) => log(LOG_LEVELS.WARNING, ...args),
  info: (...args) => log(LOG_LEVELS.INFO, ...args),
  debug: (...args) => log(LOG_LEVELS.DEBUG, ...args)
};

// Add command line switches to make Electron behave more like Edge browser
// These are flags that Edge/Chrome use by default
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// Enable features that browsers have by default - critical for RDP
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,SharedArrayBuffer,CrossOriginOpenerPolicy,CrossOriginEmbedderPolicy');
// Enable shared memory (needed for RDP/remote desktop) - this is critical!
app.commandLine.appendSwitch('enable-blink-features', 'SharedArrayBuffer');
// Allow WebRTC and related features
app.commandLine.appendSwitch('enable-webrtc');
// Don't disable features that browsers use
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
app.commandLine.appendSwitch('enable-gpu-rasterization');
// Enable WebAssembly (RDP client uses this)
app.commandLine.appendSwitch('enable-webassembly');
// Use /tmp instead of /dev/shm for shared memory (avoids permission issues)
app.commandLine.appendSwitch('disable-dev-shm-usage');
// Note: We're NOT using --no-sandbox as it causes shared memory issues
// Instead, we'll rely on the sandbox: false in webPreferences for new windows

// Load configuration early (before logger is used)
loadConfig();

// Log userData path after config is loaded
if (process.env.SNAP_USER_DATA) {
  logger.info('Using snap userData path:', process.env.SNAP_USER_DATA);
} else {
  logger.info('Using standard userData path:', app.getPath('userData'));
}

// Global error handling for the main process
process.on('uncaughtException', (error) => {
  logger.error('Unhandled exception in main process:', error);
  // Don't crash the app, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection in main process:', reason);
  // Don't crash the app, just log the error
});

let mainWindow;
const windows = new Set(); // Track all windows for menu updates

// About dialog
function showAboutDialog() {
  const aboutWindow = new BrowserWindow({
    width: 400,
    height: 300,
    parent: mainWindow,
    modal: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>About</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      padding: 30px;
      margin: 0;
      background: #f5f5f5;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
    }
    h1 {
      margin: 0 0 10px 0;
      color: #333;
      font-size: 24px;
    }
    .version {
      color: #666;
      font-size: 14px;
      margin-bottom: 20px;
    }
    .description {
      color: #555;
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: 30px;
      max-width: 350px;
    }
    button {
      background: #0078d4;
      color: white;
      border: none;
      padding: 10px 30px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 14px;
    }
    button:hover {
      background: #106ebe;
    }
  </style>
</head>
<body>
  <h1>Windows App for Linux</h1>
  <div class="version">Version 1.0.0</div>
  <div class="description">
    Unofficial client for Windows App - Access Azure Virtual Desktops on Linux via Windows App web access.
  </div>
  <button onclick="window.close()">Close</button>
</body>
</html>
  `;

  aboutWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

// Settings dialog
function showSettingsDialog() {
  // Create preload script for settings window
  const preloadScript = `
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel, data) => {
    // Whitelist channels for security
    const validChannels = ['save-settings', 'clear-cache'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  }
});
`;
  
  // Write preload script to temporary file
  const userDataPath = app.getPath('userData');
  // Ensure userData directory exists
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }
  const preloadPath = path.join(userDataPath, 'settings-preload.js');
  fs.writeFileSync(preloadPath, preloadScript, 'utf8');
  
  const settingsWindow = new BrowserWindow({
    width: 700,
    height: 650,
    parent: mainWindow,
    modal: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath
    }
  });

  const cloudEnvsJson = JSON.stringify(CLOUD_ENVIRONMENTS);
  const currentEnv = appConfig.cloudEnvironment || 'commercial';
  const currentUrl = appConfig.connectionUrl.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const currentUserAgent = appConfig.userAgent.replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Settings</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      padding: 20px;
      margin: 0;
      background: #f5f5f5;
    }
    h2 {
      margin-top: 0;
      color: #333;
    }
    .setting-group {
      background: white;
      padding: 15px;
      margin-bottom: 15px;
      border-radius: 5px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    label {
      display: block;
      margin-bottom: 5px;
      font-weight: 500;
      color: #555;
    }
    select, input[type="text"], input[type="url"] {
      width: 100%;
      padding: 8px;
      border: 1px solid #ddd;
      border-radius: 3px;
      font-size: 14px;
      box-sizing: border-box;
    }
    input[type="url"], input[type="text"].mono {
      font-family: monospace;
    }
    input#userAgent {
      font-size: 12px;
    }
    .warning {
      background: #fff3cd;
      border: 1px solid #ffc107;
      color: #856404;
      padding: 10px;
      border-radius: 3px;
      margin-top: 10px;
      font-size: 12px;
    }
    button {
      background: #0078d4;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 14px;
      margin-right: 10px;
    }
    button:hover { background: #106ebe; }
    button.danger { background: #d13438; }
    button.danger:hover { background: #a4262c; }
    .button-group { margin-top: 20px; text-align: right; }
    .description { font-size: 12px; color: #666; margin-top: 5px; }
    #connectionUrl:disabled { background: #f0f0f0; color: #888; cursor: not-allowed; }
  </style>
</head>
<body>
  <h2>Settings</h2>

  <div class="setting-group">
    <label for="cloudEnvironment">Cloud Environment:</label>
    <select id="cloudEnvironment" onchange="onEnvChange()">
      <option value="commercial">Commercial</option>
      <option value="gcchigh">GCC High</option>
      <option value="dod">DoD</option>
      <option value="custom">Custom</option>
    </select>
    <div class="description">Selects the Microsoft cloud endpoint. Choose Custom to enter your own URL.</div>
  </div>

  <div class="setting-group">
    <label for="connectionUrl">Connection URL:</label>
    <input type="url" id="connectionUrl" class="mono"
      value="${currentUrl}"
      placeholder="https://windows.cloud.microsoft/#/devices">
    <div class="description">The URL loaded on startup. Automatically set by the environment selector above.</div>
    <div class="warning" id="customWarning" style="display:none;">
      <strong>Warning:</strong> Changing this address may cause the application to not work correctly. Only modify if you know what you're doing.
    </div>
  </div>

  <div class="setting-group">
    <label for="userAgent">User-Agent String:</label>
    <input type="text" id="userAgent" class="mono"
      value="${currentUserAgent}"
      placeholder="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...">
    <div class="description">Sent with HTTP requests. Leave as-is unless you have a specific reason to change it.</div>
  </div>

  <div class="setting-group">
    <label>Default Window Size:</label>
    <div style="display: flex; gap: 10px; align-items: center;">
      <div style="flex: 1;">
        <label for="windowWidth" style="font-size: 12px; margin-bottom: 3px;">Width:</label>
        <input type="number" id="windowWidth" value="${appConfig.windowWidth}" min="400" max="3840" style="width: 100%;">
      </div>
      <div style="flex: 1;">
        <label for="windowHeight" style="font-size: 12px; margin-bottom: 3px;">Height:</label>
        <input type="number" id="windowHeight" value="${appConfig.windowHeight}" min="300" max="2160" style="width: 100%;">
      </div>
    </div>
    <div class="description">Default size for new windows.</div>
  </div>

  <div class="setting-group">
    <label>Data Management:</label>
    <button class="danger" onclick="clearCache()">Clear Cookies and Cache</button>
    <div class="description">Clears all stored cookies, cache, and local storage. You will need to log in again.</div>
  </div>

  <div class="button-group">
    <button onclick="saveSettings()">Save</button>
    <button onclick="window.close()">Cancel</button>
  </div>

  <script>
    const ENVS = ${cloudEnvsJson};
    const urlField = document.getElementById('connectionUrl');
    const envSelect = document.getElementById('cloudEnvironment');
    const customWarning = document.getElementById('customWarning');

    // Initialise to current saved state
    envSelect.value = '${currentEnv}';
    updateUrlField('${currentEnv}');

    function onEnvChange() {
      updateUrlField(envSelect.value);
    }

    function updateUrlField(env) {
      const isCustom = env === 'custom';
      urlField.disabled = !isCustom;
      customWarning.style.display = isCustom ? 'block' : 'none';
      if (!isCustom && ENVS[env] && ENVS[env].url) {
        urlField.value = ENVS[env].url;
      }
    }

    function saveSettings() {
      const cloudEnvironment = envSelect.value;
      const connectionUrl = urlField.value.trim();
      const userAgent = document.getElementById('userAgent').value.trim();
      const windowWidth = parseInt(document.getElementById('windowWidth').value);
      const windowHeight = parseInt(document.getElementById('windowHeight').value);

      const settings = { cloudEnvironment };
      if (connectionUrl) settings.connectionUrl = connectionUrl;
      if (userAgent) settings.userAgent = userAgent;
      if (windowWidth >= 400 && windowWidth <= 3840) settings.windowWidth = windowWidth;
      if (windowHeight >= 300 && windowHeight <= 2160) settings.windowHeight = windowHeight;

      window.electronAPI.send('save-settings', settings);
      window.close();
    }

    async function clearCache() {
      if (confirm('Are you sure you want to clear all cookies and cache? You will need to log in again.')) {
        window.electronAPI.send('clear-cache');
        alert('Cookies and cache cleared. The application will reload.');
        window.close();
      }
    }
  </script>
</body>
</html>
  `;

  settingsWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  
  // Handle IPC messages from settings window
  const saveHandler = (event, settings) => {
    if (settings.cloudEnvironment) {
      appConfig.cloudEnvironment = settings.cloudEnvironment;
    }
    if (settings.connectionUrl) {
      appConfig.connectionUrl = settings.connectionUrl;
    }
    if (settings.userAgent) {
      appConfig.userAgent = settings.userAgent;
      // Update User-Agent for the session
      session.defaultSession.setUserAgent(appConfig.userAgent);
      logger.info('User-Agent updated to:', appConfig.userAgent);
    }
    if (settings.windowWidth) {
      appConfig.windowWidth = settings.windowWidth;
      logger.info('Default window width updated to:', appConfig.windowWidth);
    }
    if (settings.windowHeight) {
      appConfig.windowHeight = settings.windowHeight;
      logger.info('Default window height updated to:', appConfig.windowHeight);
    }
    saveConfig();
    logger.info('Settings saved:', settings);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (settings.connectionUrl) {
        mainWindow.loadURL(appConfig.connectionUrl);
      } else if (settings.userAgent) {
        // If only User-Agent changed, reload the current page
        mainWindow.reload();
      }
      // Note: Window size changes will apply to new windows, not the current one
    }
  };
  
  const clearCacheHandler = async () => {
    try {
      await session.defaultSession.clearCache();
      await session.defaultSession.clearStorageData();
      const cookies = await session.defaultSession.cookies.get({});
      for (const cookie of cookies) {
        await session.defaultSession.cookies.remove(cookie.url || `http${cookie.secure ? 's' : ''}://${cookie.domain}`, cookie.name);
      }
      logger.info('Cache and cookies cleared');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.reload();
      }
    } catch (err) {
      logger.error('Error clearing cache:', err);
      dialog.showErrorBox('Error', 'Failed to clear cache: ' + err.message);
    }
  };
  
  ipcMain.once('save-settings', saveHandler);
  ipcMain.once('clear-cache', clearCacheHandler);
  
  settingsWindow.on('closed', () => {
    ipcMain.removeListener('save-settings', saveHandler);
    ipcMain.removeListener('clear-cache', clearCacheHandler);
  });
}

// Function to create application menu with DevTools toggle
function createMenu() {
  const isMac = process.platform === 'darwin';
  
  const template = [
    // File menu
    ...(isMac ? [{
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            createWindow();
          }
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            showSettingsDialog();
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' },
          { type: 'separator' },
          {
            label: 'Speech',
            submenu: [
              { role: 'startSpeaking' },
              { role: 'stopSpeaking' }
            ]
          }
        ] : [
          { role: 'delete' },
          { type: 'separator' },
          { role: 'selectAll' }
        ])
      ]
    },
    // View menu
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Developer Tools',
          accelerator: 'F12',
          click: (item, focusedWindow) => {
            if (focusedWindow) {
              if (focusedWindow.webContents.isDevToolsOpened()) {
                focusedWindow.webContents.closeDevTools();
              } else {
                focusedWindow.webContents.openDevTools();
              }
            }
          }
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        {
          label: 'Toggle Fullscreen',
          accelerator: 'F11',
          click: (item, focusedWindow) => {
            if (focusedWindow) {
              focusedWindow.setFullScreen(!focusedWindow.isFullScreen());
            }
          }
        }
      ]
    },
    // Window menu (macOS)
    ...(isMac ? [{
      label: 'Window',
      submenu: [
        { role: 'close' },
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }] : []),
    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Windows App for Linux',
          click: () => {
            showAboutDialog();
          }
        },
        {
          label: 'Documentation',
          click: () => {
            shell.openExternal('https://windows.cloud.microsoft/');
          }
        },
        { type: 'separator' },
        {
          label: 'Log Level: Full Logging',
          type: 'checkbox',
          checked: appConfig.logLevel >= LOG_LEVELS.DEBUG,
          click: (item) => {
            if (item.checked) {
              appConfig.logLevel = LOG_LEVELS.DEBUG;
              logger.info('Log level set to: DEBUG (Full Logging)');
            } else {
              appConfig.logLevel = LOG_LEVELS.ERROR;
              logger.error('Log level set to: ERROR (Errors Only)');
            }
            saveConfig();
            createMenu(); // Refresh menu to update checkbox
          }
        },
        {
          label: 'Log Level: Errors Only',
          type: 'checkbox',
          checked: appConfig.logLevel === LOG_LEVELS.ERROR,
          click: (item) => {
            if (item.checked) {
              appConfig.logLevel = LOG_LEVELS.ERROR;
              logger.error('Log level set to: ERROR (Errors Only)');
            } else {
              appConfig.logLevel = LOG_LEVELS.DEBUG;
              logger.info('Log level set to: DEBUG (Full Logging)');
            }
            saveConfig();
            createMenu(); // Refresh menu to update checkbox
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}


// Returns true for small auth/login popups. Intentionally not domain-based
// so it works for any identity provider (ADFS, Okta, federated, GCC High, etc.).
function isPopupWindow(features, disposition) {
  if (disposition === 'new-popup') return true;
  if (typeof features === 'string' && features.includes('popup')) return true;
  const w = parseInt((/width=(\d+)/i.exec(features) || [])[1], 10);
  const h = parseInt((/height=(\d+)/i.exec(features) || [])[1], 10);
  if (!isNaN(w) && !isNaN(h) && w < 800 && h < 800) return true;
  return false;
}

// Configures a BrowserWindow created by Electron via action:'allow'.
// Contains all event handlers that used to live inside setWindowOpenHandler.
function setupRDPWindow(rdpWindow, url) {
  logger.debug('[RDP Window] Setup, ID:', rdpWindow.id);

  rdpWindow.webContents.setUserAgent(appConfig.userAgent);

  rdpWindow.webContents.session.cookies.get({}).then(cookies => {
    logger.debug('[RDP Window] Cookies in session:', cookies.length);
  }).catch(err => {
    logger.error('[RDP Window] Error getting cookies:', err);
  });

  rdpWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    logger.debug('[New Window] Will navigate to:', navigationUrl);
  });

  rdpWindow.webContents.on('did-navigate', (event, navigationUrl) => {
    logger.debug('[New Window] Did navigate to:', navigationUrl);
  });

  rdpWindow.webContents.on('did-navigate-in-page', (event, navigationUrl) => {
    logger.debug('[New Window] Did navigate in page to:', navigationUrl);
  });

  rdpWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logger.error('=== NEW WINDOW LOAD FAILED ===');
    logger.error('URL:', validatedURL);
    logger.error('Error Code:', errorCode);
    logger.error('Description:', errorDescription);
    logger.error('Is Main Frame:', isMainFrame);
    logger.error('============================');
    if (isMainFrame && errorCode !== -3) {
      logger.debug('[New Window] Attempting to reload after load failure...');
      setTimeout(() => {
        if (!rdpWindow.isDestroyed()) { rdpWindow.reload(); }
      }, 2000);
    }
  });

  rdpWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    logger.debug(`[New Window Console ${level}]:`, message, `(${sourceId}:${line})`);
  });

  rdpWindow.webContents.on('did-start-loading', () => {
    logger.debug('[New Window] Started loading:', rdpWindow.webContents.getURL());
  });

  rdpWindow.webContents.on('did-finish-load', () => {
    const finishedUrl = rdpWindow.webContents.getURL();
    logger.debug('[New Window] Finished loading:', finishedUrl);
    setTimeout(() => {
      if (!rdpWindow.isDestroyed()) {
        rdpWindow.webContents.executeJavaScript(`
          (function() {
            const body = document.body;
            if (body && body.innerHTML.trim() === '') { return true; }
            return false;
          })();
        `).then(isBlank => {
          if (isBlank) {
            logger.warning('[New Window] Blank page detected - attempting reload...');
            setTimeout(() => {
              if (!rdpWindow.isDestroyed()) { rdpWindow.reload(); }
            }, 1000);
          }
        }).catch(() => {});
      }
    }, 2000);
  });

  rdpWindow.webContents.on('dom-ready', () => {
    logger.debug('[New Window] DOM ready:', rdpWindow.webContents.getURL());
  });

  rdpWindow.webContents.on('page-title-updated', (event, title) => {
    logger.debug('[New Window] Title updated:', title);
  });

  // Clear stale RDP session state before loading — prevents grey screen on
  // reconnect caused by the RDP client finding partial connection data in
  // localStorage/IndexedDB. Cookies are excluded so the user stays authenticated.
  // stop() cancels any auto-navigation Electron may have started so we get
  // exactly one clean load after storage is cleared.
  const rdpOrigin = (() => { try { return new URL(url).origin; } catch { return null; } })();
  rdpWindow.webContents.stop();
  const doLoad = () => rdpWindow.loadURL(url).catch(err => {
    logger.error('[RDP Window] Error loading URL:', url, err);
  });
  if (rdpOrigin) {
    rdpWindow.webContents.session.clearStorageData({
      origin: rdpOrigin,
      storages: ['localstorage', 'sessionstorage', 'indexdb', 'cachestorage', 'serviceworkers']
    }).then(() => {
      logger.debug('[RDP Window] Cleared stale storage for', rdpOrigin);
      doLoad();
    }).catch(() => doLoad());
  } else {
    doLoad();
  }

  let isClosing = false;
  let forceCloseTimeout = null;

  rdpWindow.on('close', (event) => {
    try {
      if (isClosing) { return; }
      logger.debug('[New Window] Close event triggered');
      isClosing = true;
      try {
        if (rdpWindow.webContents && !rdpWindow.webContents.isDestroyed()) {
          if (rdpWindow.webContents.isDevToolsOpened()) {
            rdpWindow.webContents.closeDevTools();
          }
        }
      } catch (err) {
        logger.error('[New Window] Error closing DevTools:', err);
      }
      forceCloseTimeout = setTimeout(() => {
        if (!rdpWindow.isDestroyed()) {
          logger.debug('[New Window] Force closing window (timeout - page prevented close)');
          rdpWindow.destroy();
        }
      }, 2000);
    } catch (err) {
      logger.error('[New Window] Error in close handler:', err);
      if (!rdpWindow.isDestroyed()) { rdpWindow.destroy(); }
    }
  });

  rdpWindow.on('closed', () => {
    try {
      if (forceCloseTimeout) {
        clearTimeout(forceCloseTimeout);
        forceCloseTimeout = null;
      }
      windows.delete(rdpWindow);
      logger.debug('[New Window] Closed');
    } catch (err) {
      logger.error('[New Window] Error in closed handler:', err);
    }
  });

  windows.add(rdpWindow);

  rdpWindow.webContents.on('uncaught-exception', (event, error) => {
    logger.error('[New Window] Uncaught exception:', error);
    event.preventDefault();
  });

  rdpWindow.webContents.on('unresponsive', () => {
    logger.warning('[New Window] Window became unresponsive');
    setTimeout(() => {
      if (!rdpWindow.isDestroyed() && rdpWindow.webContents.isLoading()) {
        logger.warning('[New Window] Window still unresponsive, user can force close with Ctrl+W or Ctrl+Q');
      }
    }, 5000);
  });

  rdpWindow.webContents.on('responsive', () => {
    logger.debug('[New Window] Window became responsive again');
  });

  let crashCount = 0;
  const MAX_CRASHES = 1;

  rdpWindow.webContents.on('render-process-gone', (event, details) => {
    logger.error('=== RENDER PROCESS CRASHED ===');
    logger.error('Reason:', details.reason);
    logger.error('Exit Code:', details.exitCode);
    logger.error('Crash Count:', crashCount + 1);
    logger.error('Details:', JSON.stringify(details, null, 2));
    logger.error('URL at crash:', rdpWindow.webContents.getURL());
    logger.error('=============================');
    crashCount++;
    if (details.reason === 'crashed' && crashCount < MAX_CRASHES) {
      logger.debug(`Attempting to reload crashed page (attempt ${crashCount}/${MAX_CRASHES})...`);
      setTimeout(() => { rdpWindow.reload(); }, 3000);
    } else {
      logger.error('Render process crashed. Attempting to recover...');
      logger.debug('Window will stay open. If you see a blank screen, the RDP client crashed.');
    }
  });

  rdpWindow.webContents.on('did-start-loading', () => {
    rdpWindow.webContents.executeJavaScript(`
      (function() {
        if (typeof dragEvent === 'undefined') {
          window.dragEvent = null;
          Object.defineProperty(window, 'dragEvent', {
            value: null, writable: true, configurable: true, enumerable: false
          });
        }
        if (typeof SharedArrayBuffer !== 'undefined') {
          window.SharedArrayBuffer = SharedArrayBuffer;
        }
        if (navigator.permissions && navigator.permissions.query) {
          const _origQuery = navigator.permissions.query.bind(navigator.permissions);
          navigator.permissions.query = function(descriptor) {
            if (descriptor.name === 'camera' || descriptor.name === 'microphone' || descriptor.name === 'media') {
              return Promise.resolve({ state: 'granted', onchange: null });
            }
            return _origQuery(descriptor);
          };
        }
      })();
    `).catch(() => {});
  });

  rdpWindow.webContents.once('dom-ready', () => {
    rdpWindow.webContents.executeJavaScript(`
      (function() {
        if (typeof dragEvent === 'undefined') {
          window.dragEvent = null;
          Object.defineProperty(window, 'dragEvent', {
            value: null, writable: true, configurable: true, enumerable: false
          });
        }
        window.addEventListener('error', function(e) {
          try { e.preventDefault(); } catch (_) {}
          return true;
        }, true);
        window.addEventListener('unhandledrejection', function(e) {
          try { e.preventDefault(); } catch (_) {}
        });
      })();
    `).catch(err => {
      logger.error('[RDP Window] Error injecting fix:', err);
    });
  });

  rdpWindow.webContents.on('did-finish-load', () => {
    rdpWindow.webContents.executeJavaScript(`
      (function() {
        if (typeof dragEvent === 'undefined') { window.dragEvent = null; }
      })();
    `).catch(() => {});
  });

  rdpWindow.once('ready-to-show', () => {
    logger.debug('[New Window] Ready to show');
    rdpWindow.show();
    rdpWindow.setMenuBarVisibility(true);
  });

  rdpWindow.setMenuBarVisibility(true);

  rdpWindow.on('enter-full-screen', () => {
    setTimeout(() => {
      if (!rdpWindow.isDestroyed()) { rdpWindow.setMenuBarVisibility(false); }
    }, 100);
  });

  rdpWindow.on('leave-full-screen', () => {
    setTimeout(() => {
      if (!rdpWindow.isDestroyed()) { rdpWindow.setMenuBarVisibility(true); }
    }, 100);
  });

  rdpWindow.webContents.on('before-input-event', (event, input) => {
    const systemKeys = ['Super', 'Meta', 'Alt', 'Tab', 'Escape'];
    const isSystemKey = systemKeys.includes(input.key) ||
                       (input.alt && input.key === 'Tab') ||
                       (input.meta && input.key !== 'F11' && input.key !== 'F12');
    if (input.key === 'F11') {
      rdpWindow.setFullScreen(!rdpWindow.isFullScreen());
      setTimeout(() => {
        if (!rdpWindow.isDestroyed()) {
          rdpWindow.setMenuBarVisibility(!rdpWindow.isFullScreen());
        }
      }, 100);
    } else if (input.key === 'F12') {
      if (rdpWindow.webContents.isDevToolsOpened()) {
        rdpWindow.webContents.closeDevTools();
      } else {
        rdpWindow.webContents.openDevTools();
      }
    } else if ((input.control || input.meta) && input.key === 'W') {
      event.preventDefault();
      logger.debug('[New Window] Force closing via Ctrl+W');
      if (!rdpWindow.isDestroyed()) { rdpWindow.destroy(); }
    } else if ((input.control || input.meta) && input.key === 'Q') {
      event.preventDefault();
      logger.debug('[New Window] Force closing via Ctrl+Q');
      if (!rdpWindow.isDestroyed()) { rdpWindow.destroy(); }
    } else if (isSystemKey && !input.control && !input.shift) {
      return;
    }
  });

  // Allow auth popups from within RDP windows (mid-session re-auth).
  rdpWindow.webContents.setWindowOpenHandler(({ url: u, features: f, disposition: d }) => {
    logger.debug('[RDP Window] Window open request:', u, d);
    if (isPopupWindow(f, d)) {
      return { action: 'allow', overrideBrowserWindowOptions: {
        width: 500, height: 700, show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true, session: session.defaultSession }
      }};
    }
    return { action: 'deny' };
  });
  rdpWindow.webContents.on('did-create-window', (popupWin) => {
    popupWin.setMenuBarVisibility(false);
    popupWin.once('ready-to-show', () => popupWin.show());
  });
}

function createWindow(isFullscreen = false) {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: appConfig.windowWidth,
    height: appConfig.windowHeight,
    fullscreen: isFullscreen,
    fullscreenable: true, // Allow fullscreen
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      // Enable permissions for camera, microphone, etc.
      permissions: ['camera', 'microphone', 'notifications']
    },
    show: false // Don't show until ready
  });

  // Set User-Agent and browser-like headers before loading
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = appConfig.userAgent;
    // Add headers that browsers send by default
    if (!details.requestHeaders['Accept']) {
      details.requestHeaders['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8';
    }
    if (!details.requestHeaders['Accept-Language']) {
      details.requestHeaders['Accept-Language'] = 'en-US,en;q=0.9';
    }
    if (!details.requestHeaders['Accept-Encoding']) {
      details.requestHeaders['Accept-Encoding'] = 'gzip, deflate, br';
    }
    callback({ requestHeaders: details.requestHeaders });
  });

  // Note: Permission handlers are now set up in app.whenReady() BEFORE createWindow()
  // This ensures they're active for all windows from the start

  // Set up window open handler for new windows (remote desktop, etc.)
  // action:'allow' ensures window.open() returns a valid reference in the renderer.
  // action:'deny' returns null, which the Windows App treats as "popup blocked",
  // aborting auth flows that redirect to any third-party identity provider.
  mainWindow.webContents.setWindowOpenHandler(({ url, frameName, features, disposition }) => {
    logger.debug('=== NEW WINDOW REQUEST ===', url, '|', disposition);
    const popup = isPopupWindow(features, disposition);
    return {
      action: 'allow',
      overrideBrowserWindowOptions: popup ? {
        width: 500,
        height: 700,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: true,
          session: session.defaultSession
        }
      } : {
        width: 1920,
        height: 1080,
        fullscreen: false,
        fullscreenable: true,
        backgroundColor: '#1e1e1e',
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: true,
          permissions: ['camera', 'microphone', 'notifications'],
          session: session.defaultSession,
          devTools: true,
          backgroundThrottling: false,
          offscreen: false,
          enableWebSQL: false,
          enableBlinkFeatures: 'SharedArrayBuffer',
          sandbox: false,
          v8CacheOptions: 'none'
        }
      }
    };
  });

  mainWindow.webContents.on('did-create-window', (win, details) => {
    logger.debug('[did-create-window]', details.url, '|', details.disposition);
    if (isPopupWindow(details.features, details.disposition)) {
      win.setMenuBarVisibility(false);
      win.once('ready-to-show', () => win.show());
      windows.add(win);
      win.on('closed', () => windows.delete(win));
    } else {
      setupRDPWindow(win, details.url);
    }
  });


  // Load the configured connection URL
  mainWindow.loadURL(appConfig.connectionUrl);

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Ensure menu bar is always visible
    mainWindow.setMenuBarVisibility(true);
    // Don't force fullscreen for main window
  });

  // DevTools disabled by default - can be toggled via menu

  // Add debugging for main window too
  mainWindow.webContents.on('did-navigate', (event, navigationUrl) => {
    logger.debug('[Main Window] Navigated to:', navigationUrl);
  });

  mainWindow.webContents.on('did-navigate-in-page', (event, navigationUrl) => {
    logger.debug('[Main Window] Navigated in page to:', navigationUrl);
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    logger.error('[Main Window] Failed to load:', validatedURL, errorCode, errorDescription);
  });

  // Handle window closed
  mainWindow.on('close', (event) => {
    try {
      logger.debug('[Main Window] Close event triggered');
      // Clean up DevTools if open
      try {
        if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
          if (mainWindow.webContents.isDevToolsOpened()) {
            mainWindow.webContents.closeDevTools();
          }
        }
      } catch (err) {
        logger.error('[Main Window] Error closing DevTools:', err);
      }
    } catch (err) {
      logger.error('[Main Window] Error in close handler:', err);
    }
  });

  mainWindow.on('closed', () => {
    try {
      windows.delete(mainWindow);
      mainWindow = null;
      logger.debug('[Main Window] Closed');
    } catch (err) {
      logger.error('[Main Window] Error in closed handler:', err);
    }
  });

  windows.add(mainWindow);

  // Handle fullscreen toggle (F11 or ESC)
  // Menu bar visible by default, hidden in fullscreen
  mainWindow.setMenuBarVisibility(true);
  
  // Hide menu bar when entering fullscreen, show when leaving
  mainWindow.on('enter-full-screen', () => {
    setTimeout(() => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.setMenuBarVisibility(false);
      }
    }, 100);
  });
  
  mainWindow.on('leave-full-screen', () => {
    setTimeout(() => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.setMenuBarVisibility(true);
      }
    }, 100);
  });
  
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Allow system shortcuts to pass through (Windows key, Alt+Tab, etc.)
    // These are system-level shortcuts that should work even in fullscreen
    const systemKeys = ['Super', 'Meta', 'Alt', 'Tab', 'Escape'];
    const isSystemKey = systemKeys.includes(input.key) || 
                       (input.alt && input.key === 'Tab') ||
                       (input.meta && input.key !== 'F11' && input.key !== 'F12');
    
    // Only handle our specific shortcuts, let system shortcuts pass through
    if (input.key === 'F11') {
      const isFullscreen = mainWindow.isFullScreen();
      mainWindow.setFullScreen(!isFullscreen);
      // Update menu bar visibility after toggling fullscreen
      setTimeout(() => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.setMenuBarVisibility(!mainWindow.isFullScreen());
        }
      }, 100);
    } else if (input.key === 'F12') {
      // Toggle DevTools with F12 (like Edge)
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools();
      }
    } else if (isSystemKey && !input.control && !input.shift) {
      // Allow system shortcuts to pass through to the OS
      // Don't prevent default for system keys
      return;
    }
  });
}

// Set User-Agent for the entire session
app.whenReady().then(() => {
  // Log all command line switches for debugging
  logger.debug('=== ELECTRON COMMAND LINE FLAGS ===');
  const switches = app.commandLine.getSwitchValue('switches') || '';
  logger.debug('Command line switches:', process.argv);
  logger.debug('===============================');
  
  // Log userData path for debugging
  logger.debug('=== USER DATA PATH ===');
  const userDataPath = app.getPath('userData');
  logger.debug('userData path:', userDataPath);
  logger.debug('userData exists:', fs.existsSync(userDataPath));
  // Ensure userData directory exists
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
    logger.debug('Created userData directory');
  }
  logger.debug('SNAP_USER_DATA env:', process.env.SNAP_USER_DATA);
  logger.debug('========================');

  // Set default User-Agent
  session.defaultSession.setUserAgent(appConfig.userAgent);
  
  // Ensure cookies are persisted
  // The default session should persist cookies automatically, but let's verify
  logger.debug('Session storage path:', session.defaultSession.getStoragePath());
  
  // Set up cookie change monitoring for debugging
  session.defaultSession.cookies.on('changed', (event, cookie, cause, removed) => {
    if (appConfig.logLevel >= LOG_LEVELS.DEBUG) {
      if (removed) {
        logger.debug(`[Cookie] Removed: ${cookie.name} from ${cookie.domain}`);
      } else {
        logger.debug(`[Cookie] Set: ${cookie.name} from ${cookie.domain} (expires: ${cookie.expirationDate ? new Date(cookie.expirationDate * 1000).toISOString() : 'session'})`);
      }
    }
  });
  
  // Log existing cookies on startup to verify persistence
  session.defaultSession.cookies.get({}).then(cookies => {
    logger.info(`[Cookies] Loaded ${cookies.length} cookies on startup`);
    const microsoftCookies = cookies.filter(c => c.domain.includes('microsoft.com'));
    logger.debug(`[Cookies] ${microsoftCookies.length} Microsoft cookies found`);
    if (microsoftCookies.length > 0 && appConfig.logLevel >= LOG_LEVELS.DEBUG) {
      microsoftCookies.forEach(c => {
        logger.debug(`  - ${c.name} (expires: ${c.expirationDate ? new Date(c.expirationDate * 1000).toISOString() : 'session'})`);
      });
    }
  }).catch(err => {
    logger.error('[Cookies] Error loading cookies:', err);
  });

  // Create application menu
  createMenu();

  // Set up permission handlers BEFORE creating any windows
  // This ensures they're active for all windows from the start
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    logger.debug(`[Permission Request] ${permission} from ${details.requestingUrl || 'unknown'}`);
    logger.debug(`[Permission Request] Full details:`, JSON.stringify(details, null, 2));
    // Allow camera, microphone, notifications, and other media permissions
    // Note: "media" is a combined permission for camera + microphone
    const allowedPermissions = [
      'camera',
      'microphone',
      'media', // Combined permission for camera + microphone
      'notifications',
      'geolocation',
      'midi',
      'midiSysex',
      'pointerLock',
      'fullscreen',
      'openExternal'
    ];

    // Check if permission is allowed (case-insensitive)
    const permissionLower = permission.toLowerCase();
    const isAllowed = allowedPermissions.some(p => p.toLowerCase() === permissionLower);
    
    if (isAllowed) {
      logger.debug(`[Permission Request] GRANTED: ${permission}`);
      callback(true); // Allow the permission
    } else {
      logger.debug(`[Permission Request] DENIED: ${permission} (not in allowed list: ${allowedPermissions.join(', ')})`);
      callback(false); // Deny other permissions
    }
  });

  // Handle permission check - set up globally for all windows using defaultSession
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const allowedPermissions = [
      'camera',
      'microphone',
      'media', // Combined permission for camera + microphone
      'notifications',
      'geolocation',
      'midi',
      'midiSysex',
      'pointerLock',
      'fullscreen'
    ];

    // Check if permission is allowed (case-insensitive)
    const permissionLower = permission.toLowerCase();
    const allowed = allowedPermissions.some(p => p.toLowerCase() === permissionLower);
    logger.debug(`[Permission Check] ${permission} from ${requestingOrigin} -> ${allowed ? 'ALLOWED' : 'DENIED'}`);
    return allowed;
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});


