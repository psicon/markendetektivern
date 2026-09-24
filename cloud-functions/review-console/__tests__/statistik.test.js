'use strict';
const { baueStatistik, leereTage } = require('../src/statistik');

const JETZT = Date.parse('2026-09-24T10:00:00Z');
const T = (iso) => Date.parse(iso);

describe('leereTage', () => {
  it('liefert N aufeinanderfolgende Berliner Tage, heute zuletzt', () => {
    const t = leereTage(JETZT, 3);
    expect(t).toEqual(['2026-09-22', '2026-09-23', '2026-09-24']);
  });
  it('Zeitumstellung erzeugt keinen doppelten Tag', () => {
    const t = leereTage(Date.parse('2026-10-26T10:00:00Z'), 5);
    expect(new Set(t).size).toBe(t.length);
  });
});

describe('baueStatistik', () => {
  const fotos = [
    { id: 'a', status: 'approved', createdAt: T('2026-09-23T08:00:00Z'), reviewedAt: T('2026-09-24T07:00:00Z'), rejectReason: null },
    { id: 'b', status: 'approved', createdAt: T('2026-09-10T08:00:00Z'), reviewedAt: null, rejectReason: null }, // Altbestand ohne reviewedAt
    { id: 'c', status: 'rejected', createdAt: T('2026-09-23T09:00:00Z'), reviewedAt: T('2026-09-24T07:05:00Z'), rejectReason: 'unvollstaendig' },
    { id: 'd', status: 'pending', createdAt: T('2026-09-24T06:00:00Z'), reviewedAt: null, rejectReason: null },
    { id: 'e', status: 'approved', createdAt: T('2026-09-24T06:30:00Z'), reviewedAt: T('2026-09-24T07:10:00Z'), rejectReason: null }, // freigegeben, aber nicht gebucht (Deckel)
  ];
  const buchungen = new Map([
    ['a', { cents: 12, at: T('2026-09-24T07:00:05Z') }],
    ['b', { cents: 16, at: T('2026-09-11T09:00:00Z') }],
  ]);
  const bons = [
    { status: 'approved', createdAt: T('2026-09-24T06:00:00Z'), grund: null, cents: 8 },
    { status: 'no_reward', createdAt: T('2026-09-24T06:10:00Z'), grund: 'below_min_items', cents: 0 },
    { status: 'rejected', createdAt: T('2026-09-23T06:10:00Z'), grund: 'bon_too_old', cents: 0 },
    { status: 'review', createdAt: T('2026-09-23T06:20:00Z'), grund: null, cents: 0 },
  ];
  const s = baueStatistik({ jetzt: JETZT, tage: 30, fotos, fotoBuchungen: buchungen, bons });

  it('Foto-Geld kommt aus dem Ledger, nicht aus der Freigabe', () => {
    const heute = s.fotos.jeTag.find((t) => t.tag === '2026-09-24');
    expect(heute).toMatchObject({ freigegeben: 2, abgelehnt: 1, cents: 12, eingereicht: 2 });
  });
  it('Altbestand ohne reviewedAt zählt am Buchungstag', () => {
    expect(s.fotos.jeTag.find((t) => t.tag === '2026-09-11')).toMatchObject({ freigegeben: 1, cents: 16 });
  });
  it('Gründe, offene Fotos, Bons in Prüfung', () => {
    expect(s.fotos.gruende).toEqual({ unvollstaendig: 1 });
    expect(s.fotos.offen).toBe(1);
    expect(s.bons.inPruefung).toBe(1);
    expect(s.bons.gruende).toEqual({ below_min_items: 1, bon_too_old: 1 });
  });
  it('Bon-Geld nur für freigegebene Bons', () => {
    expect(s.bons.summe).toMatchObject({ eingereicht: 4, approved: 1, no_reward: 1, rejected: 1, sonst: 1, cents: 8 });
  });
  it('letzte 7 Tage sind eine Teilmenge', () => {
    expect(s.fotos.letzte7.freigegeben).toBeLessThanOrEqual(s.fotos.summe.freigegeben);
    expect(s.fotos.letzte7.freigegeben).toBe(2); // der 11.09. liegt außerhalb
  });
});
