const { app, BrowserWindow, session, shell, Menu, dialog, ipcMain, screen } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Pure, unit-tested helpers (see src/*.js and test/*.test.js)
const { isTrustedOrigin, isAllowedNavigationUrl } = require('./security');
const {
  DEFAULT_USER_AGENT,
  DEFAULT_CONNECTION_URL,
  CLOUD_ENVIRONMENTS,
  LOG_LEVELS,
  DEFAULT_CONFIG,
  sanitizeSettings,
  mergeConfig
} = require('./config');
const { isForceCloseShortcut, isFullscreenToggle, isDevToolsToggle } = require('./shortcuts');
const { shouldRetryCrash } = require('./recovery');
const { isPopupWindow, getRdpWindowDimensions, buildRendererResizeNotifyScript } = require('./windows');

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

// Application configuration (defaults live in ./config)
let appConfig = Object.assign({}, DEFAULT_CONFIG);

// Load configuration from file
function loadConfig() {
  const configPath = path.join(app.getPath('userData'), 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      const loaded = JSON.parse(configData);
      // mergeConfig validates each field, so a corrupt config.json can't
      // overwrite a good default with garbage.
      appConfig = mergeConfig(appConfig, loaded);
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

async function clearSessionData() {
  await session.defaultSession.clearCache();
  await session.defaultSession.clearStorageData();
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

// Linux display: disable Vulkan (reduces Wayland+Vulkan console spam). Do not force
// X11 on a Wayland desktop — that runs through XWayland and often crashes the GPU
// process (exit 139). Set ELECTRON_OZONE_PLATFORM=x11|wayland to override; on X11
// sessions under Wayland also set WINDOWS_APP_DISABLE_GPU=1 if GPU still crashes.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('disable-features', 'Vulkan');
  const platform = process.env.ELECTRON_OZONE_PLATFORM;
  if (platform === 'x11') {
    app.commandLine.appendSwitch('ozone-platform', 'x11');
    if (process.env.WAYLAND_DISPLAY && process.env.WINDOWS_APP_DISABLE_GPU !== '0') {
      app.commandLine.appendSwitch('disable-gpu');
    }
  } else if (platform === 'wayland') {
    app.commandLine.appendSwitch('ozone-platform', 'wayland');
  }
}

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
const rdpResizeWindows = new WeakSet();
const resizeNotifyTimers = new Map();

function notifyRendererResize(win) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  const bounds = win.getContentBounds();
  win.webContents.setZoomFactor(1);
  const script = buildRendererResizeNotifyScript(bounds.width, bounds.height);
  win.webContents.executeJavaScript(script).catch(() => {});
}

function scheduleRendererResize(win) {
  if (!win || win.isDestroyed()) return;
  const id = win.id;
  if (resizeNotifyTimers.has(id)) clearTimeout(resizeNotifyTimers.get(id));
  resizeNotifyTimers.set(id, setTimeout(() => {
    resizeNotifyTimers.delete(id);
    notifyRendererResize(win);
  }, 120));
}

function attachRdpResizeHandling(win) {
  rdpResizeWindows.add(win);
  const schedule = () => scheduleRendererResize(win);
  win.on('resize', schedule);
  win.on('will-resize', schedule);
  win.on('maximize', schedule);
  win.on('unmaximize', schedule);
  win.on('enter-full-screen', () => setTimeout(schedule, 200));
  win.on('leave-full-screen', () => setTimeout(schedule, 200));
  win.on('closed', () => {
    rdpResizeWindows.delete(win);
    resizeNotifyTimers.delete(win.id);
  });
}

function getRdpDisplayWorkArea() {
  const refBounds = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow.getBounds()
    : screen.getPrimaryDisplay().bounds;
  return screen.getDisplayMatching(refBounds).workAreaSize;
}

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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
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
  <div class="version">Version ${app.getVersion()}</div>
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
  // Use the static, shipped preload (settings-preload.js) rather than writing
  // one to disk at runtime.
  const preloadPath = path.join(__dirname, 'settings-preload.js');

  // Data for the cloud-environment selector. Serialized into the page so the
  // dropdown can auto-fill the connection URL client-side.
  const cloudEnvsJson = JSON.stringify(CLOUD_ENVIRONMENTS);
  const currentEnv = appConfig.cloudEnvironment || 'commercial';

  const settingsWindow = new BrowserWindow({
    width: 700,
    height: 680,
    parent: mainWindow,
    modal: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath
    }
  });

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
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
    input[type="text"], input[type="url"] {
      width: 100%;
      padding: 8px;
      border: 1px solid #ddd;
      border-radius: 3px;
      font-size: 14px;
      box-sizing: border-box;
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
    button:hover {
      background: #106ebe;
    }
    button.danger {
      background: #d13438;
    }
    button.danger:hover {
      background: #a4262c;
    }
    .button-group {
      margin-top: 20px;
      text-align: right;
    }
    .description {
      font-size: 12px;
      color: #666;
      margin-top: 5px;
    }
  </style>
</head>
<body>
  <h2>Settings</h2>

  <div class="setting-group">
    <label for="cloudEnvironment">Cloud Environment:</label>
    <select id="cloudEnvironment" onchange="onEnvChange()" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 3px; font-size: 14px; box-sizing: border-box;">
      <option value="commercial">Commercial</option>
      <option value="gcchigh">GCC High</option>
      <option value="dod">DoD</option>
      <option value="custom">Custom</option>
    </select>
    <div class="description">Selects the Microsoft cloud endpoint. Choose Custom to enter your own URL.</div>
  </div>

  <div class="setting-group">
    <label for="connectionUrl">Default Connection Address:</label>
    <input type="url" id="connectionUrl" value="${appConfig.connectionUrl.replace(/"/g, '&quot;').replace(/'/g, '&#39;')}" placeholder="https://windows.cloud.microsoft/#/devices">
    <div class="description">The URL to load when the application starts. Set automatically by the environment selector above (editable only for Custom).</div>
    <div class="warning" id="customWarning" style="display:none;">
      <strong>Warning:</strong> Changing this address may cause the application to not work correctly. Only modify if you know what you're doing.
    </div>
  </div>
  
  <div class="setting-group">
    <label for="userAgent">User-Agent String:</label>
    <input type="text" id="userAgent" value="${appConfig.userAgent.replace(/"/g, '&quot;').replace(/'/g, '&#39;')}" placeholder="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...">
    <div class="description">The User-Agent string sent with HTTP requests. Changing this may affect how websites identify your browser.</div>
    <div class="warning">
      <strong>Warning:</strong> Changing the User-Agent may cause websites to behave differently or not work correctly. Only modify if you know what you're doing.
    </div>
  </div>
  
  <div class="setting-group">
    <label>Data Management:</label>
    <button class="danger" onclick="clearCache()">Clear Cookies and Cache</button>
    <div class="description">This will clear all stored cookies, cache, and local storage. You will need to log in again.</div>
    <label style="display: flex; align-items: center; gap: 8px; margin-top: 12px; font-weight: normal;">
      <input type="checkbox" id="clearSessionOnExit" ${appConfig.clearSessionOnExit ? 'checked' : ''}>
      Clear cookies and cache when exiting the application
    </label>
    <div class="description">When enabled, all session data is wiped on quit so the next launch starts signed out.</div>
  </div>
  
  <div class="button-group">
    <button onclick="saveSettings()">Save</button>
    <button onclick="cancelSettings()">Cancel</button>
  </div>
  
  <script>
    // Use the exposed electronAPI from preload script instead of require('electron')
    // electronAPI is exposed via contextBridge in the preload script
    const ENVS = ${cloudEnvsJson};
    const envSelect = document.getElementById('cloudEnvironment');
    const urlField = document.getElementById('connectionUrl');
    const customWarning = document.getElementById('customWarning');

    // Initialise to the current saved environment.
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
      const connectionUrl = urlField.value;
      const userAgent = document.getElementById('userAgent').value;
      const settings = { cloudEnvironment };
      if (connectionUrl && connectionUrl.trim()) {
        settings.connectionUrl = connectionUrl.trim();
      }
      if (userAgent && userAgent.trim()) {
        settings.userAgent = userAgent.trim();
      }
      settings.clearSessionOnExit = document.getElementById('clearSessionOnExit').checked;
      // Use the exposed API from preload script
      window.electronAPI.send('save-settings', settings);
      window.close();
    }
    
    function cancelSettings() {
      window.close();
    }
    
    async function clearCache() {
      if (confirm('Are you sure you want to clear all cookies and cache? You will need to log in again.')) {
        // Use the exposed API from preload script
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
  const saveHandler = (event, rawSettings) => {
    // Re-validate in the main process; never trust values straight off IPC.
    // sanitizeSettings() also forces connectionUrl to the environment's URL for
    // any non-custom environment, so a forged URL can't repoint a known cloud.
    const settings = sanitizeSettings(rawSettings);
    const prevConnectionUrl = appConfig.connectionUrl;
    const prevUserAgent = appConfig.userAgent;
    if (settings.cloudEnvironment) {
      appConfig.cloudEnvironment = settings.cloudEnvironment;
      logger.info('Cloud environment set to:', settings.cloudEnvironment);
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
    if (typeof settings.clearSessionOnExit === 'boolean') {
      appConfig.clearSessionOnExit = settings.clearSessionOnExit;
      logger.info('Clear session on exit:', settings.clearSessionOnExit);
    }
    saveConfig();
    logger.info('Settings saved:', settings);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (appConfig.connectionUrl !== prevConnectionUrl) {
        mainWindow.loadURL(appConfig.connectionUrl);
      } else if (appConfig.userAgent !== prevUserAgent) {
        mainWindow.reload();
      }
    }
  };

  const clearCacheHandler = async () => {
    try {
      await clearSessionData();
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

// --- Shared window behavior (used by both the main window and child windows) ---

// Keep the menu bar visible except while in fullscreen.
function attachFullscreenMenuToggle(win) {
  win.setMenuBarVisibility(true);
  win.on('enter-full-screen', () => {
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.setMenuBarVisibility(false);
        if (rdpResizeWindows.has(win)) scheduleRendererResize(win);
      }
    }, 100);
  });
  win.on('leave-full-screen', () => {
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.setMenuBarVisibility(true);
        if (rdpResizeWindows.has(win)) scheduleRendererResize(win);
      }
    }, 100);
  });
}

// F11 toggles fullscreen, F12 toggles DevTools. When allowForceClose is set,
// Ctrl/Cmd+W and Ctrl/Cmd+Q destroy the window (used for child windows whose
// page may block a normal close). All other keys, including system shortcuts,
// pass through untouched.
function attachWindowKeyShortcuts(win, { allowForceClose = false } = {}) {
  win.webContents.on('before-input-event', (event, input) => {
    if (isFullscreenToggle(input)) {
      win.setFullScreen(!win.isFullScreen());
      setTimeout(() => {
        if (!win.isDestroyed()) {
          win.setMenuBarVisibility(!win.isFullScreen());
          if (rdpResizeWindows.has(win)) scheduleRendererResize(win);
        }
      }, 100);
    } else if (isDevToolsToggle(input)) {
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools();
      } else {
        win.webContents.openDevTools();
      }
    } else if (allowForceClose && isForceCloseShortcut(input)) {
      event.preventDefault();
      logger.debug('Force closing window via keyboard shortcut');
      if (!win.isDestroyed()) win.destroy();
    }
  });
}

// Install the browser-like request header rewrite on the default session. Called
// once from app.whenReady() (it is session-global, not per-window).
function installRequestHeaderRewrite() {
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
}

// Minimal early page shim. Some Windows App web client builds reference a global
// `dragEvent` that does not exist outside their expected environment; define it
// before page scripts run. Injected once per navigation (did-start-loading).
// NOTE: we intentionally no longer override navigator.permissions.query or
// install blanket error/unhandledrejection swallowers here - the native
// permission handler already grants what the client needs, and silently
// preventing every page error hid real (including security-relevant) failures.
const EARLY_PAGE_SHIM = `
  (function() {
    if (typeof window.dragEvent === 'undefined') {
      try {
        Object.defineProperty(window, 'dragEvent', {
          value: null, writable: true, configurable: true, enumerable: false
        });
      } catch (e) { /* ignore */ }
    }
  })();
`;

// BrowserWindow options passed to Electron when a page calls window.open().
// action:'allow' is required so window.open() returns a valid reference; with
// action:'deny' the Windows App web client sees null and treats auth as blocked.
function buildWindowOpenOptions(popup) {
  const sharedSession = { session: session.defaultSession };
  if (popup) {
    return {
      width: 500,
      height: 700,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        ...sharedSession
      }
    };
  }
  const { width, height } = getRdpWindowDimensions(getRdpDisplayWorkArea());
  return {
    width,
    height,
    useContentSize: true,
    fullscreen: false,
    fullscreenable: true,
    backgroundColor: '#1e1e1e',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      permissions: ['camera', 'microphone', 'notifications'],
      ...sharedSession,
      devTools: false,
      backgroundThrottling: false,
      offscreen: false,
      enableWebSQL: false,
      enableBlinkFeatures: 'SharedArrayBuffer',
      // SECURITY TRADEOFF: sandbox disabled for AVD/RDP shared memory. Guards
      // below limit navigations to Microsoft hosts only.
      sandbox: false,
      v8CacheOptions: 'code'
    }
  };
}

function handleWindowOpenRequest({ url, features, disposition }) {
  logger.debug('[Window open]', url, '|', disposition, '|', features);
  const popup = isPopupWindow(features, disposition);
  // RDP sessions must start on a Microsoft endpoint; auth popups may begin on
  // Microsoft and redirect to any corporate IdP (e.g. sso.gdit.com).
  if (!popup && !isAllowedNavigationUrl(url)) {
    logger.warning('[Window open] Untrusted RDP URL opened externally:', url);
    shell.openExternal(url).catch(err => {
      logger.error('[Window open] Failed to open external URL:', err);
    });
    return { action: 'deny' };
  }
  return {
    action: 'allow',
    overrideBrowserWindowOptions: buildWindowOpenOptions(popup)
  };
}

// Block top-frame navigations away from Microsoft hosts on RDP windows only
// (sandbox:false). Main window and auth popups are NOT guarded — federated SSO
// redirects to corporate IdPs (sso.gdit.com, Okta, ADFS, etc.) must stay in-app.
function applyRdpNavigationGuards(win) {
  win.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isAllowedNavigationUrl(navigationUrl)) {
      event.preventDefault();
      logger.warning('[RDP Nav] Blocked navigation to untrusted URL:', navigationUrl);
    }
  });
  win.webContents.on('will-redirect', (event, navigationUrl) => {
    if (!isAllowedNavigationUrl(navigationUrl)) {
      event.preventDefault();
      logger.warning('[RDP Nav] Blocked redirect to untrusted URL:', navigationUrl);
    }
  });
}

// Minimal wiring for an auth/login popup created via action:'allow'.
function setupAuthPopup(popupWin) {
  popupWin.webContents.setUserAgent(appConfig.userAgent);
  popupWin.setMenuBarVisibility(false);
  popupWin.webContents.setWindowOpenHandler(handleWindowOpenRequest);
  popupWin.once('ready-to-show', () => popupWin.show());
  windows.add(popupWin);
  popupWin.on('closed', () => windows.delete(popupWin));
}

// Wire up an RDP/AVD child window created via action:'allow' + did-create-window.
function setupRdpWindow(rdpWindow, url) {
  logger.debug('[RDP Window] Setup, ID:', rdpWindow.id);

  rdpWindow.webContents.setUserAgent(appConfig.userAgent);
  rdpWindow.webContents.setWindowOpenHandler(handleWindowOpenRequest);
  applyRdpNavigationGuards(rdpWindow);

  rdpWindow.webContents.on('did-create-window', (win, details) => {
    if (isPopupWindow(details.features, details.disposition)) {
      setupAuthPopup(win);
    }
  });

  rdpWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logger.error('[RDP Window] Load failed:', validatedURL, errorCode, errorDescription, 'mainFrame=', isMainFrame);
    if (isMainFrame && errorCode !== -3) {
      setTimeout(() => {
        if (!rdpWindow.isDestroyed()) rdpWindow.reload();
      }, 2000);
    }
  });

  rdpWindow.webContents.on('did-finish-load', () => {
    logger.debug('[RDP Window] Finished loading:', rdpWindow.webContents.getURL());
    scheduleRendererResize(rdpWindow);
  });

  attachRdpResizeHandling(rdpWindow);

  rdpWindow.webContents.on('did-start-loading', () => {
    rdpWindow.webContents.executeJavaScript(EARLY_PAGE_SHIM).catch(() => {});
  });

  // Clear stale RDP client storage for this origin before loading (grey-screen
  // fix on reconnect). Cookies are preserved so SSO stays valid.
  const rdpOrigin = (() => { try { return new URL(url).origin; } catch { return null; } })();
  rdpWindow.webContents.stop();
  const doLoad = () => {
    logger.debug('[RDP Window] Loading URL:', url);
    rdpWindow.loadURL(url).catch(err => {
      logger.error('[RDP Window] Error loading URL:', url, err);
    });
  };
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

  rdpWindow.on('close', () => {
    try {
      if (isClosing) return;
      isClosing = true;
      logger.debug('[RDP Window] Close event triggered');
      try {
        if (rdpWindow.webContents && !rdpWindow.webContents.isDestroyed() &&
            rdpWindow.webContents.isDevToolsOpened()) {
          rdpWindow.webContents.closeDevTools();
        }
      } catch (err) {
        logger.error('[RDP Window] Error closing DevTools:', err);
      }
      forceCloseTimeout = setTimeout(() => {
        if (!rdpWindow.isDestroyed()) {
          logger.debug('[RDP Window] Force closing window (page prevented close)');
          rdpWindow.destroy();
        }
      }, 2000);
    } catch (err) {
      logger.error('[RDP Window] Error in close handler:', err);
      if (!rdpWindow.isDestroyed()) rdpWindow.destroy();
    }
  });

  rdpWindow.on('closed', () => {
    try {
      if (forceCloseTimeout) {
        clearTimeout(forceCloseTimeout);
        forceCloseTimeout = null;
      }
      windows.delete(rdpWindow);
      logger.debug('[RDP Window] Closed');
    } catch (err) {
      logger.error('[RDP Window] Error in closed handler:', err);
    }
  });

  windows.add(rdpWindow);

  rdpWindow.webContents.on('unresponsive', () => {
    logger.warning('[RDP Window] Window became unresponsive (force close with Ctrl+W / Ctrl+Q)');
  });

  let crashRetries = 0;
  const MAX_CRASH_RETRIES = 1;
  rdpWindow.webContents.on('render-process-gone', (event, details) => {
    logger.error('[RDP Window] Render process gone:', details.reason, 'exitCode=', details.exitCode);
    if (shouldRetryCrash(details.reason, crashRetries, MAX_CRASH_RETRIES)) {
      crashRetries++;
      logger.debug(`Reloading crashed page (attempt ${crashRetries}/${MAX_CRASH_RETRIES})...`);
      setTimeout(() => {
        if (!rdpWindow.isDestroyed()) rdpWindow.reload();
      }, 3000);
    } else {
      logger.error('Render process crashed and will not be reloaded again.');
    }
  });

  rdpWindow.once('ready-to-show', () => {
    logger.debug('[RDP Window] Ready to show');
    rdpWindow.show();
    rdpWindow.setMenuBarVisibility(true);
    // Give the AVD client time to mount, then sync to the current window size.
    setTimeout(() => scheduleRendererResize(rdpWindow), 250);
    setTimeout(() => scheduleRendererResize(rdpWindow), 1000);
    setTimeout(() => scheduleRendererResize(rdpWindow), 3000);
  });

  attachFullscreenMenuToggle(rdpWindow);
  attachWindowKeyShortcuts(rdpWindow, { allowForceClose: true });
}

function createWindow(isFullscreen = false) {
  const { width, height } = getRdpWindowDimensions(getRdpDisplayWorkArea());
  // Create the browser window
  mainWindow = new BrowserWindow({
    width,
    height,
    useContentSize: true,
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

  // Note: the User-Agent / browser-like header rewrite is installed once on the
  // default session in app.whenReady() (installRequestHeaderRewrite). It is
  // session-global, so it does not belong in per-window setup.

  // Note: Permission handlers are now set up in app.whenReady() BEFORE createWindow()
  // This ensures they're active for all windows from the start

  // action:'allow' so window.open() returns a valid reference (required for SSO).
  // did-create-window routes auth popups vs RDP sessions. Main window is NOT
  // navigation-guarded so federated IdP redirects (e.g. sso.gdit.com) stay in-app.
  mainWindow.webContents.setWindowOpenHandler(handleWindowOpenRequest);
  mainWindow.webContents.on('did-create-window', (win, details) => {
    logger.debug('[did-create-window]', details.url, '|', details.disposition);
    if (isPopupWindow(details.features, details.disposition)) {
      setupAuthPopup(win);
    } else {
      setupRdpWindow(win, details.url);
    }
  });

  // Load the configured connection URL
  mainWindow.loadURL(appConfig.connectionUrl);

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Ensure menu bar is always visible
    mainWindow.setMenuBarVisibility(true);
    setTimeout(() => scheduleRendererResize(mainWindow), 250);
    setTimeout(() => scheduleRendererResize(mainWindow), 1000);
  });

  // DevTools disabled by default - can be toggled via menu

  // Add debugging for main window too
  mainWindow.webContents.on('did-navigate', (event, navigationUrl) => {
    logger.debug('[Main Window] Navigated to:', navigationUrl);
  });

  mainWindow.webContents.on('did-navigate-in-page', (event, navigationUrl) => {
    logger.debug('[Main Window] Navigated in page to:', navigationUrl);
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // ERR_ABORTED (-3) is normal when a navigation is superseded (e.g. loadURL while loading).
    if (errorCode === -3) {
      logger.debug('[Main Window] Navigation aborted:', validatedURL);
      return;
    }
    if (isMainFrame === false) return;
    logger.error('[Main Window] Failed to load:', validatedURL, errorCode, errorDescription);
  });

  attachRdpResizeHandling(mainWindow);
  mainWindow.webContents.on('did-finish-load', () => scheduleRendererResize(mainWindow));

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

  // Menu bar visible by default, hidden in fullscreen; F11 fullscreen + F12
  // DevTools. (No force-close on the main window - closing it quits the app.)
  attachFullscreenMenuToggle(mainWindow);
  attachWindowKeyShortcuts(mainWindow);
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

  // Install the browser-like request header rewrite once (session-global)
  installRequestHeaderRewrite();

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
    const requestingUrl = details.requestingUrl ||
      (webContents && !webContents.isDestroyed() ? webContents.getURL() : '');
    logger.debug(`[Permission Request] ${permission} from ${requestingUrl || 'unknown'}`);
    logger.debug(`[Permission Request] Full details:`, JSON.stringify(details, null, 2));
    // Only the permissions an AVD/RDP session actually needs. Broad grants like
    // geolocation, midi/midiSysex and openExternal were removed to shrink the
    // attack surface if a trusted-but-compromised page asks for them.
    // Note: "media" is a combined permission for camera + microphone.
    const allowedPermissions = [
      'camera',
      'microphone',
      'media',
      'notifications',
      'pointerLock',
      'fullscreen'
    ];

    // Check if permission is allowed (case-insensitive)
    const permissionLower = permission.toLowerCase();
    const isAllowed = allowedPermissions.some(p => p.toLowerCase() === permissionLower);
    // Only grant sensitive permissions to trusted Microsoft origins
    const trusted = isTrustedOrigin(requestingUrl);

    if (isAllowed && trusted) {
      logger.debug(`[Permission Request] GRANTED: ${permission}`);
      callback(true); // Allow the permission
    } else if (isAllowed && !trusted) {
      logger.warning(`[Permission Request] DENIED: ${permission} from untrusted origin ${requestingUrl || 'unknown'}`);
      callback(false); // Deny permissions requested by untrusted origins
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
      'media',
      'notifications',
      'pointerLock',
      'fullscreen'
    ];

    // Check if permission is allowed (case-insensitive) AND comes from a trusted origin
    const permissionLower = permission.toLowerCase();
    const allowed = allowedPermissions.some(p => p.toLowerCase() === permissionLower) &&
      isTrustedOrigin(requestingOrigin);
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

let sessionClearedOnExit = false;

app.on('before-quit', (event) => {
  if (!appConfig.clearSessionOnExit || sessionClearedOnExit) return;
  event.preventDefault();
  sessionClearedOnExit = true;
  clearSessionData()
    .then(() => {
      logger.info('Session cache and cookies cleared on exit');
      app.quit();
    })
    .catch((err) => {
      logger.error('Error clearing session on exit:', err);
      app.quit();
    });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});


