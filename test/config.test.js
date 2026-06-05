'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeSettings,
  mergeConfig,
  DEFAULT_CONFIG,
  LOG_LEVELS,
  WINDOW_BOUNDS
} = require('../src/config');

test('sanitizeSettings: keeps valid values', () => {
  const out = sanitizeSettings({
    connectionUrl: 'https://windows.cloud.microsoft/',
    userAgent: 'Custom UA',
    windowWidth: 1280,
    windowHeight: 720,
    logLevel: LOG_LEVELS.DEBUG
  });
  assert.deepEqual(out, {
    connectionUrl: 'https://windows.cloud.microsoft/',
    userAgent: 'Custom UA',
    windowWidth: 1280,
    windowHeight: 720,
    logLevel: LOG_LEVELS.DEBUG
  });
});

test('sanitizeSettings: trims strings and drops empty/whitespace-only ones', () => {
  const out = sanitizeSettings({ connectionUrl: '  https://x.microsoft.com  ', userAgent: '   ' });
  assert.equal(out.connectionUrl, 'https://x.microsoft.com');
  assert.ok(!('userAgent' in out));
});

test('sanitizeSettings: rejects out-of-range window sizes', () => {
  const tooSmall = sanitizeSettings({ windowWidth: 10, windowHeight: 10 });
  assert.deepEqual(tooSmall, {});
  const tooBig = sanitizeSettings({
    windowWidth: WINDOW_BOUNDS.width.max + 1,
    windowHeight: WINDOW_BOUNDS.height.max + 1
  });
  assert.deepEqual(tooBig, {});
});

test('sanitizeSettings: accepts boundary window sizes and rounds floats', () => {
  const out = sanitizeSettings({
    windowWidth: WINDOW_BOUNDS.width.min,
    windowHeight: WINDOW_BOUNDS.height.max
  });
  assert.equal(out.windowWidth, WINDOW_BOUNDS.width.min);
  assert.equal(out.windowHeight, WINDOW_BOUNDS.height.max);
  assert.equal(sanitizeSettings({ windowWidth: 1000.7 }).windowWidth, 1001);
});

test('sanitizeSettings: coerces numeric strings (as the dialog sends them)', () => {
  const out = sanitizeSettings({ windowWidth: '1600', windowHeight: '900' });
  assert.equal(out.windowWidth, 1600);
  assert.equal(out.windowHeight, 900);
});

test('sanitizeSettings: rejects NaN, non-numeric, and invalid log levels', () => {
  assert.deepEqual(sanitizeSettings({ windowWidth: 'wide', windowHeight: NaN }), {});
  assert.deepEqual(sanitizeSettings({ logLevel: 99 }), {});
  assert.deepEqual(sanitizeSettings({ logLevel: 'DEBUG' }), {});
});

test('sanitizeSettings: tolerates non-object input', () => {
  assert.deepEqual(sanitizeSettings(null), {});
  assert.deepEqual(sanitizeSettings(undefined), {});
  assert.deepEqual(sanitizeSettings('nope'), {});
  assert.deepEqual(sanitizeSettings(123), {});
});

test('mergeConfig: a malformed loaded value cannot clobber a good default', () => {
  const merged = mergeConfig(DEFAULT_CONFIG, {
    windowWidth: -5,            // invalid -> ignored
    connectionUrl: '',          // empty -> ignored
    userAgent: 'My UA'          // valid -> applied
  });
  assert.equal(merged.windowWidth, DEFAULT_CONFIG.windowWidth);
  assert.equal(merged.connectionUrl, DEFAULT_CONFIG.connectionUrl);
  assert.equal(merged.userAgent, 'My UA');
});

test('mergeConfig: does not mutate the base config', () => {
  const base = Object.assign({}, DEFAULT_CONFIG);
  const snapshot = JSON.stringify(base);
  mergeConfig(base, { windowWidth: 1600 });
  assert.equal(JSON.stringify(base), snapshot);
});

test('mergeConfig: ignores unknown keys', () => {
  const merged = mergeConfig(DEFAULT_CONFIG, { evil: 'rm -rf', __proto__: { polluted: true } });
  assert.ok(!('evil' in merged));
  assert.equal({}.polluted, undefined, 'prototype must not be polluted');
});
