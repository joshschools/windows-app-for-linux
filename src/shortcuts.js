'use strict';

// Electron's before-input-event reports `input.key` as the DOM KeyboardEvent.key
// value, which is lowercase ('w', 'q') unless Shift is held. The original code
// compared against uppercase 'W'/'Q', so the documented force-close shortcuts
// never actually fired. Comparisons here are case-insensitive.
function keyEquals(input, key) {
  if (!input || typeof input.key !== 'string') return false;
  return input.key.toLowerCase() === String(key).toLowerCase();
}

function isCtrlOrCmd(input) {
  return !!(input && (input.control || input.meta));
}

// Ctrl/Cmd+W or Ctrl/Cmd+Q -> force close the window.
function isForceCloseShortcut(input) {
  return isCtrlOrCmd(input) && (keyEquals(input, 'w') || keyEquals(input, 'q'));
}

// F11 -> toggle fullscreen.
function isFullscreenToggle(input) {
  return keyEquals(input, 'F11');
}

// F12 -> toggle DevTools.
function isDevToolsToggle(input) {
  return keyEquals(input, 'F12');
}

module.exports = {
  keyEquals,
  isCtrlOrCmd,
  isForceCloseShortcut,
  isFullscreenToggle,
  isDevToolsToggle
};
