'use strict';
const { gueltig, resolverAufruf } = require('../src/resolverAufruf');

describe('resolverAufruf', () => {
  it('nur Entscheidungen, die der Resolver kennt', () => {
    expect(gueltig('approve')).toBe(true);
    expect(gueltig('reject', 'duplicate_content_self')).toBe(true);
    expect(gueltig('reject', 'duplicate_content_cross_user')).toBe(true);
    expect(gueltig('reject', 'erfunden')).toBe(false);
    expect(gueltig('no_reward', 'daily_cap_reached')).toBe(true);
    expect(gueltig('no_reward', 'below_min_items')).toBe(false);
    expect(gueltig('no_reward', '')).toBe(false);
  });
  it('ohne Schlüssel kein Aufruf', async () => {
    await expect(resolverAufruf({ receiptId: 'x', decision: 'approve' })).resolves.toMatchObject({ ok: false, code: 'kein_schluessel' });
  });
});
