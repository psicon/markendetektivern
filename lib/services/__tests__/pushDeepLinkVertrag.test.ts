/**
 * Vertrag Server ↔ App: der Link einer Cashback-Nachricht muss in der App
 * dort ankommen, wo der Bon steht (17.09.2026).
 *
 * Vier Wochen lang schickte der Server einen Link, den die App nicht
 * verstand — beide Seiten waren für sich „richtig", nur nie gegeneinander
 * geprüft. Dieser Test lädt die ECHTE Server-Funktion und den ECHTEN
 * Resolver. Ändert jemand eine Seite, bricht er hier.
 */

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('react-native', () => ({ InteractionManager: { runAfterInteractions: (fn: () => void) => fn() } }));

import * as fs from 'fs';
import * as path from 'path';

import { resolveDeepLink } from '../pushDeepLinks';

// Plain CommonJS ohne Abhängigkeiten — direkt aus der Codebase der Function.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { bonDeepLink } = require('../../../cloud-functions/cashback-pipeline/lib/pushLinks');

const APP = path.resolve(__dirname, '../../../app');

describe('Cashback-Nachricht → Bon-Detailseite', () => {
  it.each([['abc123'], ['Zx9_-Q'], ['1']])('Bon %s wird zur Detailseite aufgelöst', (id) => {
    expect(resolveDeepLink(bonDeepLink(id))).toBe(`/cashback/pending/${id}`);
  });

  it('die Zielroute existiert in der App', () => {
    expect(fs.existsSync(path.join(APP, 'cashback/pending/[id].tsx'))).toBe(true);
  });

  it('der Server benutzt den Vertrag auch wirklich (kein eigener Link mehr)', () => {
    const push = fs.readFileSync(
      path.resolve(__dirname, '../../../cloud-functions/cashback-pipeline/lib/push.js'),
      'utf8',
    );
    expect(push).toMatch(/bonDeepLink\(payload\.cashbackId\)/);
    expect(push).not.toMatch(/markendetektivern?:\/\/cashback/);
  });
});
