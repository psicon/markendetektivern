/**
 * Root-Jest-Config — Phase 1 (Pure-Logic) + Phase 2 (Service-Layer mit
 * Firestore-Mocks).
 *
 * Zwei Projekte unter einem `npm test`:
 *   • app — App-/lib-TS via ts-jest (node-Env, diagnostics:false → schnell +
 *     unabhängig vom strict-tsc-Gate; Typsicherheit deckt `tsc --noEmit`
 *     separat ab). Deckt Phase 1 (pure Utils) UND Phase 2 (Services) ab —
 *     letztere mocken die RN-Deps (@react-native-firebase/*, expo-*,
 *     react-native) per `jest.mock`, sodass die Service-Logik in Node läuft.
 *     `moduleNameMapper` löst den `@/`-Pfad-Alias auf (Services importieren
 *     intern via `@/lib/...`). `resetMocks: false`, weil die geteilten
 *     Mock-Factories (z.B. `__helpers__/rnfirestoreMock`) ihre Default-
 *     Implementierungen behalten müssen; `clearMocks` räumt nur Call-Counts.
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
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/$1',
      },
      clearMocks: true,
      resetMocks: false,
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
