'use strict';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';
const DEFAULT_CONNECTION_URL = 'https://windows.cloud.microsoft/#/devices';

const LOG_LEVELS = {
  ERROR: 0,
  WARNING: 1,
  INFO: 2,
  DEBUG: 3
};

const WINDOW_BOUNDS = {
  width: { min: 400, max: 3840 },
  height: { min: 300, max: 2160 }
};

const DEFAULT_CONFIG = {
  logLevel: LOG_LEVELS.INFO,
  connectionUrl: DEFAULT_CONNECTION_URL,
  userAgent: DEFAULT_USER_AGENT,
  windowWidth: 1024,
  windowHeight: 768
};

function inRange(n, min, max) {
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
}

// Validate and normalize a partial settings object (from the settings dialog or
// a config file). Returns only the keys that pass validation, so a malformed or
// hostile value can never overwrite a good default.
function sanitizeSettings(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;

  if (typeof input.connectionUrl === 'string' && input.connectionUrl.trim()) {
    out.connectionUrl = input.connectionUrl.trim();
  }
  if (typeof input.userAgent === 'string' && input.userAgent.trim()) {
    out.userAgent = input.userAgent.trim();
  }
  const w = Number(input.windowWidth);
  if (inRange(w, WINDOW_BOUNDS.width.min, WINDOW_BOUNDS.width.max)) {
    out.windowWidth = Math.round(w);
  }
  const h = Number(input.windowHeight);
  if (inRange(h, WINDOW_BOUNDS.height.min, WINDOW_BOUNDS.height.max)) {
    out.windowHeight = Math.round(h);
  }
  if (Object.values(LOG_LEVELS).includes(input.logLevel)) {
    out.logLevel = input.logLevel;
  }
  return out;
}

// Merge a loaded/partial config over a base config, keeping only valid values.
function mergeConfig(base, loaded) {
  return Object.assign({}, base, sanitizeSettings(loaded));
}

module.exports = {
  DEFAULT_USER_AGENT,
  DEFAULT_CONNECTION_URL,
  LOG_LEVELS,
  WINDOW_BOUNDS,
  DEFAULT_CONFIG,
  sanitizeSettings,
  mergeConfig
};
