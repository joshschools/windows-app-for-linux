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
    .parseSync();

  return {
    ...defaults,
    ...fileConfig,
    ...(args.url && { url: args.url }),
    ...(args['user-agent'] && { userAgent: args['user-agent'] }),
    window: {
      ...defaults.window,
      ...(fileConfig.window || {}),
    },
  };
}

const config = loadConfig();
module.exports = config;
module.exports.loadConfig = loadConfig;
