// Metro config — disables watchman because stuck watchman zombies (macOS
// kernel UE state) were causing Metro to hang silently on every bundle
// request. With useWatchman: false, Metro falls back to polling-based
// file watching. Slightly slower on file changes, but actually works.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const exclusionList = require('metro-config/src/defaults/exclusionList');

const config = getDefaultConfig(__dirname);

config.resolver.useWatchman = false;

// Hard-exclude `tools/` from Metro file scans + asset bundling.
//
// `tools/cashback-ocr-validation/` is a standalone Python tool (Phase-0
// receipt-OCR validator). It includes a Python venv (~400 MB of .so /
// .dylib / .pyc files) which Metro would otherwise crawl on every
// bundle request — that crashes file-watcher limits and slows dev
// startup. Asset bundling pattern `**/*` in app.json means without
// this block, Metro scans the venv during `expo build` too.
//
// Block both patterns: matched against absolute paths AND relative paths.
config.resolver.blockList = exclusionList([
  /.*\/tools\/.*/,
  /.*\\tools\\.*/, // Windows fallback (we're macOS but defensive)
]);

// And tell Metro's file-watcher not to descend into tools/
config.watchFolders = (config.watchFolders || []).filter(
  (f) => path.basename(f) !== 'tools'
);

module.exports = config;
