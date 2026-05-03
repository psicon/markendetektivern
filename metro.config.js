// Metro config — disables watchman because stuck watchman zombies (macOS
// kernel UE state) were causing Metro to hang silently on every bundle
// request. With useWatchman: false, Metro falls back to polling-based
// file watching. Slightly slower on file changes, but actually works.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.useWatchman = false;

module.exports = config;
