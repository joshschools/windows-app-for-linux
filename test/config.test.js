'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeSettings,
  mergeConfig,
  DEFAULT_CONFIG,
  CLOUD_ENVIRONMENTS,
  LOG_LEVELS,
  isValidCloudEnvironment,
  urlForEnvironment
} = require('../src/config');

test('sanitizeSettings: keeps valid values', () => {
  const out = sanitizeSettings({
    connectionUrl: 'https://windows.cloud.microsoft/',
    userAgent: 'Custom UA',
    logLevel: LOG_LEVELS.DEBUG
  });
  assert.deepEqual(out, {
    connectionUrl: 'https://windows.cloud.microsoft/',
    userAgent: 'Custom UA',
    logLevel: LOG_LEVELS.DEBUG
  });
});

test('sanitizeSettings: trims strings and drops empty/whitespace-only ones', () => {
  const out = sanitizeSettings({ connectionUrl: '  https://x.microsoft.com  ', userAgent: '   ' });
  assert.equal(out.connectionUrl, 'https://x.microsoft.com');
  assert.ok(!('userAgent' in out));
});

test('sanitizeSettings: rejects invalid log levels', () => {
  assert.deepEqual(sanitizeSettings({ logLevel: 99 }), {});
  assert.deepEqual(sanitizeSettings({ logLevel: 'DEBUG' }), {});
});

test('sanitizeSettings: ignores legacy window size keys', () => {
  assert.deepEqual(sanitizeSettings({ windowWidth: 1024, windowHeight: 768 }), {});
});

test('mergeConfig: ignores legacy window size keys from saved config', () => {
  const merged = mergeConfig(DEFAULT_CONFIG, { windowWidth: 800, windowHeight: 600 });
  assert.ok(!('windowWidth' in merged));
  assert.ok(!('windowHeight' in merged));
});

test('sanitizeSettings: tolerates non-object input', () => {
  assert.deepEqual(sanitizeSettings(null), {});
  assert.deepEqual(sanitizeSettings(undefined), {});
  assert.deepEqual(sanitizeSettings('nope'), {});
  assert.deepEqual(sanitizeSettings(123), {});
});

test('mergeConfig: a malformed loaded value cannot clobber a good default', () => {
  const merged = mergeConfig(DEFAULT_CONFIG, {
    connectionUrl: '',          // empty -> ignored
    userAgent: 'My UA'          // valid -> applied
  });
  assert.equal(merged.connectionUrl, DEFAULT_CONFIG.connectionUrl);
  assert.equal(merged.userAgent, 'My UA');
});

test('mergeConfig: does not mutate the base config', () => {
  const base = Object.assign({}, DEFAULT_CONFIG);
  const snapshot = JSON.stringify(base);
  mergeConfig(base, { userAgent: 'Other UA' });
  assert.equal(JSON.stringify(base), snapshot);
});

test('mergeConfig: ignores unknown keys', () => {
  const merged = mergeConfig(DEFAULT_CONFIG, { evil: 'rm -rf', __proto__: { polluted: true } });
  assert.ok(!('evil' in merged));
  assert.equal({}.polluted, undefined, 'prototype must not be polluted');
});

test('isValidCloudEnvironment: only known keys are valid', () => {
  assert.equal(isValidCloudEnvironment('commercial'), true);
  assert.equal(isValidCloudEnvironment('gcchigh'), true);
  assert.equal(isValidCloudEnvironment('dod'), true);
  assert.equal(isValidCloudEnvironment('custom'), true);
  assert.equal(isValidCloudEnvironment('hacker'), false);
  assert.equal(isValidCloudEnvironment('toString'), false, 'no inherited keys');
  assert.equal(isValidCloudEnvironment(null), false);
});

test('urlForEnvironment: returns the canonical endpoint, null for custom/unknown', () => {
  assert.equal(urlForEnvironment('commercial'), CLOUD_ENVIRONMENTS.commercial.url);
  assert.equal(urlForEnvironment('gcchigh'), 'https://rdweb.wvd.azure.us/arm/webclient/index.html');
  assert.equal(urlForEnvironment('dod'), 'https://rdweb.wvd.microsoft.us/arm/webclient/index.html');
  assert.equal(urlForEnvironment('custom'), null);
  assert.equal(urlForEnvironment('nope'), null);
});

test('sanitizeSettings: keeps a valid cloudEnvironment and rejects unknown ones', () => {
  assert.equal(sanitizeSettings({ cloudEnvironment: 'gcchigh' }).cloudEnvironment, 'gcchigh');
  assert.ok(!('cloudEnvironment' in sanitizeSettings({ cloudEnvironment: 'evil' })));
});

test('sanitizeSettings: a non-custom environment forces its canonical URL', () => {
  // A forged connectionUrl must not be able to repoint a known cloud.
  const out = sanitizeSettings({
    cloudEnvironment: 'gcchigh',
    connectionUrl: 'https://attacker.example/steal'
  });
  assert.equal(out.cloudEnvironment, 'gcchigh');
  assert.equal(out.connectionUrl, 'https://rdweb.wvd.azure.us/arm/webclient/index.html');
});

test('sanitizeSettings: custom environment keeps the user-supplied URL', () => {
  const out = sanitizeSettings({
    cloudEnvironment: 'custom',
    connectionUrl: 'https://my.private.host/webclient'
  });
  assert.equal(out.cloudEnvironment, 'custom');
  assert.equal(out.connectionUrl, 'https://my.private.host/webclient');
});

test('sanitizeSettings: accepts clearSessionOnExit boolean', () => {
  assert.equal(sanitizeSettings({ clearSessionOnExit: true }).clearSessionOnExit, true);
  assert.equal(sanitizeSettings({ clearSessionOnExit: false }).clearSessionOnExit, false);
  assert.ok(!('clearSessionOnExit' in sanitizeSettings({ clearSessionOnExit: 'yes' })));
});
