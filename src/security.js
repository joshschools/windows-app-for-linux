'use strict';

// Host suffixes trusted to RECEIVE SENSITIVE PERMISSIONS (camera, microphone,
// etc.). Kept intentionally narrow and limited to Microsoft-OPERATED hosts.
//
// NOTE: bare `windows.net` and `azure.com` are deliberately NOT here. Those
// suffixes match customer-controllable hosts such as *.blob.core.windows.net
// (any Azure Storage account / static website) and *.cloudapp.azure.com (any
// customer VM), which anyone can host content on. Granting them sensitive
// permissions would be a real escalation path. The specific Azure Virtual
// Desktop gateway suffixes used by the government clouds are listed explicitly
// instead.
const TRUSTED_HOST_SUFFIXES = [
  // Commercial
  'microsoft.com',        // covers wvd.microsoft.com, rdweb.wvd.microsoft.com
  'microsoftonline.com',  // commercial sign-in
  'cloud.microsoft',      // windows.cloud.microsoft (Windows App web)
  // US Government clouds (GCC High / DoD)
  'microsoftonline.us',   // government sign-in
  'wvd.azure.us',         // GCC High AVD gateway/web client
  'wvd.microsoft.us'      // DoD AVD gateway/web client
];

// Host suffixes allowed to load IN-APP (navigation / new windows). Broader than
// the permission list because the Microsoft sign-in flow pulls from auth/CDN
// domains. Anything not matching is opened in the external browser instead of
// in an in-app (and, for new windows, unsandboxed) Electron window.
const ALLOWED_NAV_HOST_SUFFIXES = TRUSTED_HOST_SUFFIXES.concat([
  'msauth.net',
  'msftauth.net',
  'live.com',
  'office.com',
  'office365.com',
  'msocdn.com'
]);

function hostMatchesSuffix(host, suffixes) {
  if (!host) return false;
  const h = host.toLowerCase();
  return suffixes.some(s => h === s || h.endsWith('.' + s));
}

function hostnameOf(originOrUrl) {
  if (!originOrUrl || typeof originOrUrl !== 'string') return null;
  try {
    return new URL(originOrUrl).hostname.toLowerCase();
  } catch (err) {
    return null;
  }
}

// True if the origin/URL belongs to a trusted Microsoft host that may be granted
// sensitive permissions.
function isTrustedOrigin(originOrUrl) {
  return hostMatchesSuffix(hostnameOf(originOrUrl), TRUSTED_HOST_SUFFIXES);
}

// True if the URL is an http(s) URL to a known Microsoft host and may be loaded
// in-app. Non-http(s) schemes and unknown hosts return false.
function isAllowedNavigationUrl(originOrUrl) {
  if (!originOrUrl || typeof originOrUrl !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(originOrUrl);
  } catch (err) {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  return hostMatchesSuffix(parsed.hostname, ALLOWED_NAV_HOST_SUFFIXES);
}

module.exports = {
  TRUSTED_HOST_SUFFIXES,
  ALLOWED_NAV_HOST_SUFFIXES,
  isTrustedOrigin,
  isAllowedNavigationUrl
};
