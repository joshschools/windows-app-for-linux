const AUTH_DOMAINS = [
  'login.microsoftonline.com',
  'login.live.com',
  'login.microsoft.com',
  'account.live.com',
  'aadcdn.msftauth.net',
];

function isAuthUrl(url) {
  try {
    return AUTH_DOMAINS.some(d => new URL(url).hostname.endsWith(d));
  } catch {
    return false;
  }
}

function isAvdUrl(url) {
  return url.includes('windows.cloud.microsoft/webclient/avd/');
}

const ALLOWED_PERMISSIONS = [
  'camera', 'microphone', 'notifications', 'media',
  'display-capture', 'clipboard-read', 'clipboard-sanitized-write',
];

function permissionAllowed(permission) {
  return ALLOWED_PERMISSIONS.includes(permission);
}

function stripCspReportOnly(headers) {
  const result = { ...headers };
  delete result['content-security-policy-report-only'];
  delete result['Content-Security-Policy-Report-Only'];
  return result;
}

function handleRenderProcessGone(details, reload) {
  if (details.reason !== 'clean-exit') reload();
}

function createAboutBlankInterceptor(openExternal) {
  let count = 0;
  function handler(details, callback) {
    const { url, resourceType } = details;
    if (url === 'about:blank') {
      count++;
      callback({ cancel: true });
      return;
    }
    if (count > 0 && resourceType === 'mainFrame' && url.startsWith('https://')) {
      count = 0;
      openExternal(url);
      callback({ cancel: true });
      return;
    }
    count = 0;
    callback({});
  }
  handler.getCount = () => count;
  return handler;
}

module.exports = {
  isAuthUrl,
  isAvdUrl,
  permissionAllowed,
  stripCspReportOnly,
  handleRenderProcessGone,
  createAboutBlankInterceptor,
};
