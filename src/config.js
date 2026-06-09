'use strict';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';
const DEFAULT_CONNECTION_URL = 'https://windows.cloud.microsoft/#/devices';

// Known Microsoft cloud environments. `custom` lets the user supply their own
// URL; every other entry derives connectionUrl from `url`.
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
  cloudEnvironment: 'commercial',
  connectionUrl: DEFAULT_CONNECTION_URL,
  userAgent: DEFAULT_USER_AGENT,
  windowWidth: 1024,
  windowHeight: 768,
  clearSessionOnExit: false
};

function inRange(n, min, max) {
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
}

// True for a known cloud-environment key.
function isValidCloudEnvironment(env) {
  return typeof env === 'string' && Object.prototype.hasOwnProperty.call(CLOUD_ENVIRONMENTS, env);
}

// Resolve the connection URL for a given environment. Returns null for unknown
// keys and for 'custom' (whose URL is user-supplied).
function urlForEnvironment(env) {
  if (!isValidCloudEnvironment(env)) return null;
  return CLOUD_ENVIRONMENTS[env].url;
}

// Validate and normalize a partial settings object (from the settings dialog or
// a config file). Returns only the keys that pass validation, so a malformed or
// hostile value can never overwrite a good default.
function sanitizeSettings(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;

  if (isValidCloudEnvironment(input.cloudEnvironment)) {
    out.cloudEnvironment = input.cloudEnvironment;
  }
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
  if (typeof input.clearSessionOnExit === 'boolean') {
    out.clearSessionOnExit = input.clearSessionOnExit;
  }

  // For a non-custom environment, the connection URL is authoritative from the
  // environment definition, so a stale/forged connectionUrl can't point a known
  // environment at an attacker URL.
  if (out.cloudEnvironment && out.cloudEnvironment !== 'custom') {
    out.connectionUrl = CLOUD_ENVIRONMENTS[out.cloudEnvironment].url;
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
  CLOUD_ENVIRONMENTS,
  LOG_LEVELS,
  WINDOW_BOUNDS,
  DEFAULT_CONFIG,
  isValidCloudEnvironment,
  urlForEnvironment,
  sanitizeSettings,
  mergeConfig
};
