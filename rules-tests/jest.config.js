/**
 * Jest-Config NUR für die Firestore-Rules-Tests (Stufe 0, ClickUp 86cahgwmn).
 *
 * Läuft bewusst GETRENNT vom normalen `npm test` (Root-Config scoped auf
 * lib/ + cloud-functions/) — diese Tests brauchen den Firestore-EMULATOR:
 *
 *   npx firebase-tools@15.15.0 emulators:exec --only firestore \
 *     --project demo-rules-test "npx jest -c rules-tests/jest.config.js"
 *
 * (Java 11+ nötig; `demo-`-Projekt-Prefix = Emulator-only, nie Produktion.)
 */
/** @type {import('jest').Config} */
module.exports = {
  displayName: 'firestore-rules',
  testEnvironment: 'node',
  rootDir: '..',
  roots: ['<rootDir>/rules-tests'],
  testMatch: ['**/*.rules.test.js'],
  testTimeout: 20000,
};
