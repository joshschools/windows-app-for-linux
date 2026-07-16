const path = require('path');
const fs = require('fs');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const defaults = require('./options');

const DEFAULT_CONFIG_PATH = path.join(
  process.env.XDG_CONFIG_HOME || path.join(require('os').homedir(), '.config'),
  'windows-app-for-linux',
  'config.json'
);

function loadConfig({ configPath = DEFAULT_CONFIG_PATH, argv = process.argv } = {}) {
  const fileConfig = (() => {
    try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); }
    catch { return {}; }
  })();

  const args = yargs(hideBin(argv))
    .option('url', { type: 'string' })
    .option('user-agent', { type: 'string' })
    .option('cloud-environment', { type: 'string', choices: Object.keys(defaults.cloudEnvironments) })
    .parseSync();

  const cloudEnvironment = args['cloud-environment'] || fileConfig.cloudEnvironment;
  const envUrl = cloudEnvironment && defaults.cloudEnvironments[cloudEnvironment];

  return {
    ...defaults,
    ...(envUrl && { url: envUrl }),
    ...fileConfig,
    ...(args.url && { url: args.url }),
    ...(args['user-agent'] && { userAgent: args['user-agent'] }),
    window: {
      ...defaults.window,
      ...(fileConfig.window || {}),
    },
  };
}

function saveConfig(updates, { configPath = DEFAULT_CONFIG_PATH } = {}) {
  const existing = (() => {
    try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); }
    catch { return {}; }
  })();

  const merged = { ...existing, ...updates };
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) delete merged[key];
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
  return merged;
}

const config = loadConfig();
module.exports = config;
module.exports.loadConfig = loadConfig;
module.exports.saveConfig = saveConfig;
