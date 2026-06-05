const { permissionAllowed, stripCspReportOnly } = require('../../app/mainAppWindow/helpers');

describe('permissionAllowed', () => {
  const granted = ['camera', 'microphone', 'notifications', 'media', 'display-capture', 'clipboard-read', 'clipboard-sanitized-write'];
  const denied = ['geolocation', 'fullscreen', 'pointerLock', 'unknown-permission'];

  granted.forEach(perm => {
    it(`grants ${perm}`, () => {
      expect(permissionAllowed(perm)).toBe(true);
    });
  });

  denied.forEach(perm => {
    it(`denies ${perm}`, () => {
      expect(permissionAllowed(perm)).toBe(false);
    });
  });
});

describe('stripCspReportOnly', () => {
  it('removes lowercase content-security-policy-report-only', () => {
    const headers = {
      'content-type': 'text/html',
      'content-security-policy-report-only': 'default-src https:',
    };
    const result = stripCspReportOnly(headers);
    expect(result['content-security-policy-report-only']).toBeUndefined();
    expect(result['content-type']).toBe('text/html');
  });

  it('removes capitalized Content-Security-Policy-Report-Only', () => {
    const headers = { 'Content-Security-Policy-Report-Only': 'default-src https:' };
    const result = stripCspReportOnly(headers);
    expect(result['Content-Security-Policy-Report-Only']).toBeUndefined();
  });

  it('does not mutate the original object', () => {
    const headers = { 'content-security-policy-report-only': 'value' };
    stripCspReportOnly(headers);
    expect(headers['content-security-policy-report-only']).toBe('value');
  });

  it('passes through unrelated headers unchanged', () => {
    const headers = { 'content-type': 'application/json', 'x-frame-options': 'DENY' };
    expect(stripCspReportOnly(headers)).toEqual(headers);
  });

  it('handles empty headers object', () => {
    expect(stripCspReportOnly({})).toEqual({});
  });
});
