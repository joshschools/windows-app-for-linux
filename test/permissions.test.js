'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { shouldGrantPermission } = require('../src/permissions');

test('grants supported permissions to trusted Microsoft origins', () => {
  assert.equal(shouldGrantPermission('media', 'https://windows.cloud.microsoft/'), true);
  assert.equal(shouldGrantPermission('notifications', 'https://portal.azure.com/'), true);
  assert.equal(shouldGrantPermission('pointerLock', 'https://rdweb.wvd.microsoft.com/'), true);
});

test('denies permissions to untrusted origins and denies unknown permissions', () => {
  assert.equal(shouldGrantPermission('media', 'https://example.com/'), false);
  assert.equal(shouldGrantPermission('clipboard-read', 'https://windows.cloud.microsoft/'), false);
  assert.equal(shouldGrantPermission(undefined, 'https://windows.cloud.microsoft/'), false);
});

test('the internal device check can access media but nothing else', () => {
  const internal = { internalMediaCheck: true };
  assert.equal(shouldGrantPermission('media', 'file:///media-check.html', internal), true);
  assert.equal(shouldGrantPermission('camera', 'file:///media-check.html', internal), true);
  assert.equal(shouldGrantPermission('geolocation', 'file:///media-check.html', internal), false);
  assert.equal(shouldGrantPermission('media', 'file:///media-check.html'), false);
});
