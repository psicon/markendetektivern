'use strict';
const { aktionZumZeitpunkt } = require('../lib/campaignZeit');

// Die echten Grenzen der September-/Oktober-Aktionen 2026.
const SEP = { id: 'september-2026', kind: 'receipt', active: true, startAt: Date.parse('2026-08-31T21:59:59Z'), endAt: Date.parse('2026-09-30T21:59:59Z'), budgetRemainingCents: 14000 };
const OKT = { id: 'oktober-2026', kind: 'receipt', active: true, startAt: Date.parse('2026-09-30T21:59:59Z'), endAt: Date.parse('2026-10-31T22:59:59Z'), budgetRemainingCents: 35600 };
const FOTO = { id: 'produkt-fotos-oktober-2026', kind: 'product_photos', active: true, startAt: OKT.startAt, endAt: OKT.endAt, budgetRemainingCents: 1 };

describe('aktionZumZeitpunkt', () => {
  it('Eingang 00:01 am 01.10. → Oktober-Aktion', () => {
    expect(aktionZumZeitpunkt([SEP, OKT, FOTO], Date.parse('2026-09-30T22:01:00Z'))?.id).toBe('oktober-2026');
  });
  it('Eingang im September → September', () => {
    expect(aktionZumZeitpunkt([SEP, OKT], Date.parse('2026-09-15T10:00:00Z'))?.id).toBe('september-2026');
  });
  it('nur Aktionen der verlangten Art', () => {
    expect(aktionZumZeitpunkt([FOTO], Date.parse('2026-10-05T10:00:00Z'), 'receipt')).toBeNull();
  });
  it('ohne Restbudget → nicht gewählt', () => {
    expect(aktionZumZeitpunkt([{ ...OKT, budgetRemainingCents: 0 }], Date.parse('2026-10-05T10:00:00Z'))).toBeNull();
  });
  it('vor dem Zeitpunkt gestoppt → nicht gewählt; danach gestoppt → gilt', () => {
    const t = Date.parse('2026-10-05T10:00:00Z');
    expect(aktionZumZeitpunkt([{ ...OKT, deactivatedAt: t - 1000 }], t)).toBeNull();
    expect(aktionZumZeitpunkt([{ ...OKT, deactivatedAt: t + 1000 }], t)?.id).toBe('oktober-2026');
  });
  it('active:false oder ohne Zeitfenster → nie', () => {
    const t = Date.parse('2026-10-05T10:00:00Z');
    expect(aktionZumZeitpunkt([{ ...OKT, active: false }], t)).toBeNull();
    expect(aktionZumZeitpunkt([{ ...OKT, endAt: null }], t)).toBeNull();
  });
  it('mehrere passende → frühestes Ende zuerst', () => {
    const kurz = { ...OKT, id: 'aktionswoche', endAt: Date.parse('2026-10-07T21:59:59Z') };
    expect(aktionZumZeitpunkt([OKT, kurz], Date.parse('2026-10-05T10:00:00Z'))?.id).toBe('aktionswoche');
  });
});
