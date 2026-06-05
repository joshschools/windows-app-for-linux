'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  keyEquals,
  isForceCloseShortcut,
  isFullscreenToggle,
  isDevToolsToggle
} = require('../src/shortcuts');

test('keyEquals: case-insensitive', () => {
  assert.equal(keyEquals({ key: 'w' }, 'W'), true);
  assert.equal(keyEquals({ key: 'W' }, 'w'), true);
  assert.equal(keyEquals({ key: 'a' }, 'b'), false);
});

test('keyEquals: tolerates missing/!string key', () => {
  assert.equal(keyEquals({}, 'w'), false);
  assert.equal(keyEquals(null, 'w'), false);
  assert.equal(keyEquals({ key: 5 }, '5'), false);
});

// Regression: the bug was comparing input.key === 'W', but Electron reports the
// lowercase 'w' without Shift, so Ctrl+W never matched.
test('isForceCloseShortcut: matches lowercase Ctrl+W (the original bug)', () => {
  assert.equal(isForceCloseShortcut({ control: true, key: 'w' }), true);
  assert.equal(isForceCloseShortcut({ control: true, key: 'q' }), true);
});

test('isForceCloseShortcut: matches Cmd+W/Cmd+Q on macOS', () => {
  assert.equal(isForceCloseShortcut({ meta: true, key: 'w' }), true);
  assert.equal(isForceCloseShortcut({ meta: true, key: 'q' }), true);
});

test('isForceCloseShortcut: matches uppercase too (Shift held)', () => {
  assert.equal(isForceCloseShortcut({ control: true, key: 'W' }), true);
});

test('isForceCloseShortcut: requires a modifier', () => {
  assert.equal(isForceCloseShortcut({ key: 'w' }), false);
  assert.equal(isForceCloseShortcut({ shift: true, key: 'w' }), false);
});

test('isForceCloseShortcut: ignores other keys', () => {
  assert.equal(isForceCloseShortcut({ control: true, key: 'a' }), false);
  assert.equal(isForceCloseShortcut({ control: true, key: 's' }), false);
});

test('isFullscreenToggle / isDevToolsToggle', () => {
  assert.equal(isFullscreenToggle({ key: 'F11' }), true);
  assert.equal(isFullscreenToggle({ key: 'f11' }), true);
  assert.equal(isFullscreenToggle({ key: 'F12' }), false);
  assert.equal(isDevToolsToggle({ key: 'F12' }), true);
  assert.equal(isDevToolsToggle({ key: 'F11' }), false);
});
