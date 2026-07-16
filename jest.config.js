module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  // Preload tests require a real Chromium renderer — run manually with electron-mocha
  testPathIgnorePatterns: ['/node_modules/', '/test/browser/'],
  // dist/*.snap build artifacts share the snapshot file extension — keep Jest out of dist/
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  watchPathIgnorePatterns: ['<rootDir>/dist/'],
};
