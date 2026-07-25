'use strict';

const { isTrustedOrigin } = require('./security');

const MEDIA_PERMISSIONS = new Set(['camera', 'microphone', 'media']);
const MICROSOFT_PERMISSIONS = new Set([
  ...MEDIA_PERMISSIONS,
  'notifications',
  'geolocation',
  'midi',
  'midisysex',
  'pointerlock',
  'fullscreen',
  'openexternal'
]);

function normalizePermission(permission) {
  return typeof permission === 'string' ? permission.toLowerCase() : '';
}

function shouldGrantPermission(permission, requestingUrl, { internalMediaCheck = false } = {}) {
  const normalized = normalizePermission(permission);

  if (internalMediaCheck) {
    return MEDIA_PERMISSIONS.has(normalized);
  }

  return MICROSOFT_PERMISSIONS.has(normalized) && isTrustedOrigin(requestingUrl);
}

module.exports = {
  MEDIA_PERMISSIONS,
  MICROSOFT_PERMISSIONS,
  shouldGrantPermission
};
