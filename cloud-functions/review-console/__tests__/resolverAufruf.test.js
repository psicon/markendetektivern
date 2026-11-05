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

  // Vierte Prüfrunde 06.10.2026: der gesehene Stand der Zeile „Doppel-Prüfung"
  // geht nur bei einer Freigabe und nur als Zahl an den Resolver.
  describe('doppelStand', () => {
    const echt = global.fetch;
    let urls;
    beforeEach(() => {
      urls = [];
      global.fetch = async (url, opt) => {
        urls.push({ url: new URL(url), opt });
        return { ok: true, status: 200, text: async () => '{"ok":true,"status":"approved"}' };
      };
    });
    afterEach(() => { global.fetch = echt; });

    it('Freigabe mit Stand → Parameter gesetzt, Schlüssel nur im Header', async () => {
      await expect(resolverAufruf({ receiptId: 'r1', decision: 'approve', doppelStand: 1791290687965, schluessel: 'k' }))
        .resolves.toMatchObject({ ok: true, status: 'approved' });
      expect(urls[0].url.searchParams.get('doppelStand')).toBe('1791290687965');
      expect(urls[0].url.searchParams.get('key')).toBeNull();
      expect(urls[0].opt.headers).toEqual({ 'x-admin-key': 'k' });
    });

    it('ohne Stand, ungültiger Stand oder keine Freigabe → kein Parameter', async () => {
      await resolverAufruf({ receiptId: 'r1', decision: 'approve', schluessel: 'k' });
      await resolverAufruf({ receiptId: 'r1', decision: 'approve', doppelStand: 'abc', schluessel: 'k' });
      await resolverAufruf({ receiptId: 'r1', decision: 'approve', doppelStand: '', schluessel: 'k' });
      await resolverAufruf({ receiptId: 'r1', decision: 'reject', doppelStand: 5, schluessel: 'k' });
      expect(urls.map((u) => u.url.searchParams.get('doppelStand'))).toEqual([null, null, null, null]);
    });
  });
});
