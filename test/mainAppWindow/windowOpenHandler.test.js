const { isAuthUrl, isAvdUrl } = require('../../app/mainAppWindow/helpers');

describe('isAuthUrl', () => {
  it('detects login.microsoftonline.com', () => {
    expect(isAuthUrl('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')).toBe(true);
  });

  it('detects login.live.com', () => {
    expect(isAuthUrl('https://login.live.com/oauth20_authorize.srf')).toBe(true);
  });

  it('detects login.microsoft.com', () => {
    expect(isAuthUrl('https://login.microsoft.com/foo')).toBe(true);
  });

  it('detects account.live.com', () => {
    expect(isAuthUrl('https://account.live.com/proofs/Add')).toBe(true);
  });

  it('detects aadcdn.msftauth.net', () => {
    expect(isAuthUrl('https://aadcdn.msftauth.net/resource.js')).toBe(true);
  });

  it('rejects windows.cloud.microsoft', () => {
    expect(isAuthUrl('https://windows.cloud.microsoft/#/devices')).toBe(false);
  });

  it('rejects unrelated domains', () => {
    expect(isAuthUrl('https://example.com')).toBe(false);
  });

  it('handles malformed URLs without throwing', () => {
    expect(() => isAuthUrl('not-a-url')).not.toThrow();
    expect(isAuthUrl('not-a-url')).toBe(false);
  });

  it('handles empty string without throwing', () => {
    expect(() => isAuthUrl('')).not.toThrow();
    expect(isAuthUrl('')).toBe(false);
  });
});

describe('isAvdUrl', () => {
  it('detects AVD session URLs', () => {
    expect(isAvdUrl('https://windows.cloud.microsoft/webclient/avd/abc-123-guid')).toBe(true);
  });

  it('does not match portal URL', () => {
    expect(isAvdUrl('https://windows.cloud.microsoft/#/devices')).toBe(false);
  });

  it('does not match partial webclient path', () => {
    expect(isAvdUrl('https://windows.cloud.microsoft/webclient/')).toBe(false);
  });
});
