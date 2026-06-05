const { app } = require('electron');
const path = require('path');
const fs = require('fs');

let strings = {};

function load() {
  const locale = app.getLocale().split('-')[0];
  const dir = path.join(__dirname, 'locales');
  const localeFile = path.join(dir, `${locale}.json`);
  const fallback = path.join(dir, 'en.json');
  const file = fs.existsSync(localeFile) ? localeFile : fallback;
  try {
    strings = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    strings = {};
  }
}

function t(key) {
  return strings[key] ?? key;
}

module.exports = { load, t };
