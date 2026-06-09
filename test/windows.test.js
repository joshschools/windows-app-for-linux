'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isPopupWindow, getRdpWindowDimensions } = require('../src/windows');

test('isPopupWindow: new-popup disposition is an auth popup', () => {
  assert.equal(isPopupWindow('', 'new-popup'), true);
});

test('isPopupWindow: features containing popup', () => {
  assert.equal(isPopupWindow('popup=yes,width=500,height=600', ''), true);
});

test('isPopupWindow: small width/height (<800) treated as auth popup', () => {
  assert.equal(isPopupWindow('width=500,height=700', ''), true);
});

test('isPopupWindow: large windows are RDP sessions, not auth popups', () => {
  assert.equal(isPopupWindow('width=1920,height=1080', ''), false);
  assert.equal(isPopupWindow('width=1024,height=768', 'new-window'), false);
});

test('isPopupWindow: empty/missing features on default disposition', () => {
  assert.equal(isPopupWindow(undefined, 'new-window'), false);
  assert.equal(isPopupWindow('', 'foreground-tab'), false);
});

test('getRdpWindowDimensions: uses full work area up to max bounds', () => {
  assert.deepEqual(getRdpWindowDimensions({ width: 2560, height: 1440 }), {
    width: 2560,
    height: 1440
  });
  assert.deepEqual(getRdpWindowDimensions({ width: 400, height: 300 }), {
    width: 400,
    height: 300
  });
});

test('buildRendererResizeNotifyScript: embeds content dimensions', () => {
  const { buildRendererResizeNotifyScript } = require('../src/windows');
  const script = buildRendererResizeNotifyScript(1920, 1080);
  assert.match(script, /1920/);
  assert.match(script, /1080/);
  assert.match(script, /viewport/);
  assert.match(script, /rdp-host-resize/);
});
