/**
 * Root-Jest-Config — Phase 1: Pure-Logic-Unit-Tests.
 *
 * Zwei Projekte unter einem `npm test`:
 *   • app — App-/lib-TS-Pure-Logik via ts-jest (node-Env, diagnostics:false →
 *     schnell + unabhängig vom strict-tsc-Gate; Typsicherheit deckt
 *     `tsc --noEmit` separat ab). KEIN RN-Runtime (Phase 1 ist pure Logik).
 *   • cf  — Cloud-Function-Logik (plain CommonJS-JS, kein Transform). Requires
 *     der CFs lösen aus deren eigenen node_modules auf.
 *
 * Komponenten-Tests (jest-expo / React Native Testing Library) kommen als
 * drittes Projekt in einer späteren Phase dazu.
 */
/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      displayName: 'app',
      testEnvironment: 'node',
      roots: ['<rootDir>/lib'],
      testMatch: ['**/__tests__/**/*.test.ts'],
      transform: {
        '^.+\\.tsx?$': ['ts-jest', { diagnostics: false }],
      },
      clearMocks: true,
      resetMocks: true,
    },
    {
      displayName: 'cf',
      testEnvironment: 'node',
      roots: [
        '<rootDir>/cloud-functions/ai-product-comparison',
        '<rootDir>/cloud-functions/external-product-lookup',
      ],
      testMatch: ['**/__tests__/**/*.test.js'],
      // Plain CommonJS — kein Transform (würde sonst die Expo-Babel-Config
      // mit console-strip auf den CF-Code anwenden).
      transform: {},
      clearMocks: true,
      resetMocks: true,
    },
  ],
};
