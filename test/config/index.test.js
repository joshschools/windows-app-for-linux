const path = require('path');
const fs = require('fs');
const os = require('os');
const { loadConfig } = require('../../app/config');

describe('loadConfig', () => {
  let tmpFile = null;

  afterEach(() => {
    if (tmpFile) {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      tmpFile = null;
    }
  });

  function writeTmpConfig(obj) {
    tmpFile = path.join(os.tmpdir(), `waf-test-config-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify(obj));
    return tmpFile;
  }

  it('returns defaults when config file does not exist', () => {
    const cfg = loadConfig({ configPath: '/nonexistent/path/config.json' });
    expect(cfg.url).toBe('https://windows.cloud.microsoft/#/devices');
    expect(cfg.sessionPartition).toBe('persist:windows-app');
  });

  it('merges file config over defaults', () => {
    const file = writeTmpConfig({ userAgent: 'custom-ua-string' });
    const cfg = loadConfig({ configPath: file });
    expect(cfg.userAgent).toBe('custom-ua-string');
    expect(cfg.url).toBe('https://windows.cloud.microsoft/#/devices');
  });

  it('merges window config deeply — preserves unset defaults', () => {
    const file = writeTmpConfig({ window: { width: 1920 } });
    const cfg = loadConfig({ configPath: file });
    expect(cfg.window.width).toBe(1920);
    expect(cfg.window.height).toBe(800);
  });

  it('CLI --url overrides file config', () => {
    const file = writeTmpConfig({ url: 'https://file.example.com' });
    const cfg = loadConfig({
      configPath: file,
      argv: ['node', 'app', '--url', 'https://cli.example.com'],
    });
    expect(cfg.url).toBe('https://cli.example.com');
  });

  it('CLI --user-agent overrides defaults', () => {
    const cfg = loadConfig({
      configPath: '/nonexistent.json',
      argv: ['node', 'app', '--user-agent', 'TestUA/1.0'],
    });
    expect(cfg.userAgent).toBe('TestUA/1.0');
  });

  it('ignores malformed JSON in config file', () => {
    tmpFile = path.join(os.tmpdir(), `waf-test-bad-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, '{ not valid json }');
    const cfg = loadConfig({ configPath: tmpFile });
    expect(cfg.url).toBe('https://windows.cloud.microsoft/#/devices');
  });
});
