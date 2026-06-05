'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  isTrustedOrigin,
  isAllowedNavigationUrl,
  TRUSTED_HOST_SUFFIXES,
  ALLOWED_NAV_HOST_SUFFIXES
} = require('../src/security');

test('isTrustedOrigin: grants exact and subdomain Microsoft hosts', () => {
  assert.equal(isTrustedOrigin('https://microsoft.com/'), true);
  assert.equal(isTrustedOrigin('https://windows.cloud.microsoft/#/devices'), true);
  assert.equal(isTrustedOrigin('https://login.microsoftonline.com/'), true);
  assert.equal(isTrustedOrigin('https://foo.bar.azure.com/'), true);
  assert.equal(isTrustedOrigin('https://something.windows.net/'), true);
});

test('isTrustedOrigin: denies untrusted and look-alike hosts', () => {
  assert.equal(isTrustedOrigin('https://evil.com/'), false);
  // suffix must be on a dot boundary, not a substring match
  assert.equal(isTrustedOrigin('https://microsoft.com.evil.com/'), false);
  assert.equal(isTrustedOrigin('https://notmicrosoft.com/'), false);
  assert.equal(isTrustedOrigin('https://fakemicrosoft.com/'), false);
});

test('isTrustedOrigin: case-insensitive host matching', () => {
  assert.equal(isTrustedOrigin('https://WINDOWS.CLOUD.MICROSOFT/'), true);
  assert.equal(isTrustedOrigin('https://Login.MicrosoftOnline.Com/'), true);
});

test('isTrustedOrigin: rejects malformed / empty / non-string input', () => {
  assert.equal(isTrustedOrigin(''), false);
  assert.equal(isTrustedOrigin(null), false);
  assert.equal(isTrustedOrigin(undefined), false);
  assert.equal(isTrustedOrigin('not a url'), false);
  assert.equal(isTrustedOrigin(42), false);
  assert.equal(isTrustedOrigin({}), false);
});

test('isAllowedNavigationUrl: allows Microsoft auth/CDN hosts beyond the permission list', () => {
  assert.equal(isAllowedNavigationUrl('https://aadcdn.msauth.net/'), true);
  assert.equal(isAllowedNavigationUrl('https://logincdn.msftauth.net/'), true);
  assert.equal(isAllowedNavigationUrl('https://login.live.com/'), true);
  assert.equal(isAllowedNavigationUrl('https://windows.cloud.microsoft/'), true);
});

test('isAllowedNavigationUrl: denies unknown hosts (routed to external browser)', () => {
  assert.equal(isAllowedNavigationUrl('https://example.com/'), false);
  assert.equal(isAllowedNavigationUrl('https://phishing.evil/'), false);
});

test('isAllowedNavigationUrl: only http(s) schemes are loaded in-app', () => {
  assert.equal(isAllowedNavigationUrl('http://microsoft.com/'), true);
  assert.equal(isAllowedNavigationUrl('https://microsoft.com/'), true);
  assert.equal(isAllowedNavigationUrl('file:///etc/passwd'), false);
  assert.equal(isAllowedNavigationUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedNavigationUrl('data:text/html,<h1>x</h1>'), false);
  assert.equal(isAllowedNavigationUrl('ftp://microsoft.com/'), false);
});

test('isAllowedNavigationUrl: rejects malformed input', () => {
  assert.equal(isAllowedNavigationUrl(''), false);
  assert.equal(isAllowedNavigationUrl(null), false);
  assert.equal(isAllowedNavigationUrl('::::'), false);
});

test('nav allow-list is a superset of the permission trust list', () => {
  for (const suffix of TRUSTED_HOST_SUFFIXES) {
    assert.ok(
      ALLOWED_NAV_HOST_SUFFIXES.includes(suffix),
      `nav list missing trusted suffix ${suffix}`
    );
  }
});
