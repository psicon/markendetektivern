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
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EINREICHUNGEN_LINK } = require('../../../cloud-functions/crowd-upload-reward/src/pushLinks');

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

/**
 * Derselbe Vertrag für die Vergütungs-Nachricht der Produktfotos
 * (12487v2akvp). Beim Bauen stand `/product-submit` NICHT in der Whitelist —
 * ohne diesen Test wäre der Link genauso still auf der Startseite gelandet
 * wie der Bon-Link vier Wochen lang.
 */
describe('Produktfoto-Vergütung → Liste der Einreichungen', () => {
  it('der Server-Link wird vom Resolver akzeptiert', () => {
    expect(resolveDeepLink(EINREICHUNGEN_LINK)).toBe('/product-submit');
  });

  it('die Zielroute existiert in der App', () => {
    expect(fs.existsSync(path.join(APP, 'product-submit/index.tsx'))).toBe(true);
  });

  it('der Server benutzt den Vertrag auch wirklich (kein eigener Link im Sendemodul)', () => {
    const push = fs.readFileSync(
      path.resolve(__dirname, '../../../cloud-functions/crowd-upload-reward/src/push.js'),
      'utf8',
    );
    expect(push).toMatch(/EINREICHUNGEN_LINK/);
    expect(push).not.toMatch(/markendetektivern?:\/\//);
  });
});
