/**
 * Jest-Config NUR für die Emulator-Tests des Live-Schattens (src/liveSchatten.js).
 * Läuft bewusst GETRENNT vom normalen `npm test` (dort zählt nur
 * `__tests__/**\/*.test.js`) — diese Tests brauchen den Firestore-EMULATOR:
 *
 *   cd cloud-functions/review-console/__emu__ && \
 *   PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH" npx firebase-tools@15.15.0 \
 *     emulators:exec --only firestore --project demo-schatten --config firebase.json \
 *     "npx jest -c jest.config.js"
 *
 * (Java 11+ nötig; `demo-`-Projekt = nur Emulator, nie Produktion.)
 */
/** @type {import('jest').Config} */
module.exports = {
  displayName: 'live-schatten-emulator',
  testEnvironment: 'node',
  rootDir: '..',
  roots: ['<rootDir>/__emu__'],
  testMatch: ['**/*.emu.test.js'],
  transform: {},
  testTimeout: 60000,
};
