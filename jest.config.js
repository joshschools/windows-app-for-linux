module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  // Preload tests require a real Chromium renderer — run manually with electron-mocha
  testPathIgnorePatterns: ['/node_modules/', '/test/browser/'],
};
