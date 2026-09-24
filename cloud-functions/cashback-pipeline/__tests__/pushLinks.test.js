'use strict';

/**
 * Der Deep-Link der Cashback-Nachricht (17.09.2026). Das Gegenstück in der
 * App prüft lib/services/__tests__/pushDeepLinkVertrag.test.ts.
 */

const { bonDeepLink } = require('../lib/pushLinks');

describe('bonDeepLink', () => {
  it('ist ein Pfad ohne Schema', () => {
    expect(bonDeepLink('abc123')).toBe('/cashback/pending/abc123');
    expect(bonDeepLink('abc123')).not.toMatch(/:\/\//);
  });

  it('nimmt auch Zahlen und kodiert Sonderzeichen', () => {
    expect(bonDeepLink(42)).toBe('/cashback/pending/42');
    expect(bonDeepLink('a/b c')).toBe('/cashback/pending/a%2Fb%20c');
  });
});
