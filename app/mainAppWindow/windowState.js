const fs = require('fs');
const path = require('path');
const os = require('os');
const { screen } = require('electron');

const STATE_PATH = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'windows-app-for-linux',
  'window-state.json'
);

function load(defaults) {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    if (!isOnScreen(saved)) return defaults;
    return { ...defaults, ...saved };
  } catch {
    return defaults;
  }
}

function save(win) {
  if (win.isMinimized() || win.isFullScreen()) return;
  const [x, y] = win.getPosition();
  const [width, height] = win.getSize();
  const isMaximized = win.isMaximized();
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify({ x, y, width, height, isMaximized }));
  } catch { /* non-fatal */ }
}

function isOnScreen({ x, y, width, height }) {
  if (x == null || y == null) return false;
  return screen.getAllDisplays().some(d => {
    const b = d.workArea;
    return x < b.x + b.width && x + width > b.x &&
           y < b.y + b.height && y + height > b.y;
  });
}

module.exports = { load, save };
