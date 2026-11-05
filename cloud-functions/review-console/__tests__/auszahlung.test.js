'use strict';
const { baueAuszahlung, kontoArt, istTestLink, ueberSchwelleSeit } = require('../src/auszahlung');

const TAG = 24 * 60 * 60 * 1000;
const JETZT = Date.parse('2026-10-01T08:00:00Z');
const n = (uid, cents, konto = 'konto') => ({ uid, cents, konto });
const earn = (cents, tageZurueck, balanceAfter) => ({ type: 'earn', cents, at: JETZT - tageZurueck * TAG, balanceAfter });

describe('kontoArt — wer darf auszahlen?', () => {
  it('Konto mit E-Mail → konto', () => {
    expect(kontoArt({ providerData: [{ providerId: 'apple.com' }], email: 'a@b.de' })).toBe('konto');
  });
  it('Konto ohne E-Mail → ohne_email (requestPayout lehnt mit email_fehlt ab)', () => {
    expect(kontoArt({ providerData: [{ providerId: 'phone' }], email: undefined })).toBe('ohne_email');
  });
  it('anonym → gast', () => {
    expect(kontoArt({ providerData: [], email: undefined })).toBe('gast');
  });
  it('gesperrt oder nicht gefunden → unbekannt', () => {
    expect(kontoArt({ providerData: [{ providerId: 'password' }], email: 'a@b.de', disabled: true })).toBe('unbekannt');
    expect(kontoArt(null)).toBe('unbekannt');
  });
});

describe('istTestLink — Testumgebung von Tremendous', () => {
  it('testflight-Host ist Test, echter Host nicht, Unsinn nicht', () => {
    expect(istTestLink('https://testflight.tremendous.com/rewards/payout/abc')).toBe(true);
    expect(istTestLink('https://www.tremendous.com/rewards/payout/abc')).toBe(false);
    expect(istTestLink(null)).toBe(false);
    expect(istTestLink('kein link')).toBe(false);
  });
});

describe('baueAuszahlung — Summen und Gruppen', () => {
  const nutzer = [
    n('reif-konto', 1250), n('reif-gast', 1000, 'gast'), // genau die Schwelle zählt als reif
    n('nah', 950), n('nah-grenze', 800), // 8 € ist „nah dran"
    n('mitte', 500), n('klein', 120), n('winzig', 3), n('null', 0), n('negativ', -40),
  ];
  const a = baueAuszahlung({ jetzt: JETZT, schwelleCents: 1000, nutzer });

  it('Gesamtsumme nur über positive Guthaben', () => {
    expect(a.gesamt).toEqual({ personen: 7, cents: 1250 + 1000 + 950 + 800 + 500 + 120 + 3 });
  });
  it('reif ab genau der Schwelle, nah ab 80 %, Rest darunter — überschneidungsfrei', () => {
    expect(a.reif).toEqual({ personen: 2, cents: 2250 });
    expect(a.nah).toEqual({ personen: 2, cents: 1750 });
    expect(a.darunter).toEqual({ personen: 3, cents: 623 });
    expect(a.reif.cents + a.nah.cents + a.darunter.cents).toBe(a.gesamt.cents);
  });
  it('reif aufgeteilt nach Konto-Art: ein Gast kann nicht auszahlen', () => {
    expect(a.reifNachKonto.konto).toEqual({ personen: 1, cents: 1250 });
    expect(a.reifNachKonto.gast).toEqual({ personen: 1, cents: 1000 });
  });
  it('Stufen decken alle Guthaben genau einmal ab', () => {
    expect(a.stufen.map((s) => s.vonCents)).toEqual([0, 100, 200, 400, 600, 800, 1000]);
    expect(a.stufen.at(-1).bisCents).toBeNull();
    expect(a.stufen.reduce((s, x) => s + x.personen, 0)).toBe(a.gesamt.personen);
    expect(a.stufen.reduce((s, x) => s + x.cents, 0)).toBe(a.gesamt.cents);
    expect(a.stufen[6]).toMatchObject({ personen: 2, cents: 2250 });
    expect(a.stufen[5]).toMatchObject({ personen: 2, cents: 1750 });
  });
  it('Anteil unter 40 % der Schwelle', () => {
    expect(a.anteilUnterVierzigProzent).toBeCloseTo(123 / a.gesamt.cents, 6);
  });
  it('Stufen wandern mit der Schwelle', () => {
    const b = baueAuszahlung({ jetzt: JETZT, schwelleCents: 2000, nutzer });
    expect(b.stufen.map((s) => s.vonCents)).toEqual([0, 200, 400, 800, 1200, 1600, 2000]);
    expect(b.reif.personen).toBe(0);
  });
  it('Kachel „nah dran" und Balken nutzen dieselbe gerundete Grenze (Schwelle 1003)', () => {
    const c = baueAuszahlung({ jetzt: JETZT, schwelleCents: 1003, nutzer: [n('x', 802)] });
    expect(c.nahAbCents).toBe(802);
    expect(c.nah.personen).toBe(1);
    expect(c.stufen.find((s) => s.vonCents === 802).personen).toBe(1);
  });
  it('unbekannte Konto-Art wird als unbekannt gezählt, nicht verschluckt', () => {
    const c = baueAuszahlung({ jetzt: JETZT, schwelleCents: 1000, nutzer: [n('x', 1500, 'quatsch')] });
    expect(c.reifNachKonto.unbekannt).toEqual({ personen: 1, cents: 1500 });
  });
});

describe('Testkonten und Testauszahlungen werden getrennt ausgewiesen', () => {
  const ledger = new Map([
    ['testkonto', [
      { type: 'admin_adjust', cents: 10000, at: JETZT - 90 * TAG, balanceAfter: 10000, reason: 'admin_test_credit_golive_v1' },
      { type: 'payout', cents: 1000, at: JETZT - 20 * TAG, balanceAfter: 9000, payoutId: 'p-test' },
    ]],
    ['echt', [earn(1200, 10, 1200)]],
  ]);
  const a = baueAuszahlung({
    jetzt: JETZT, schwelleCents: 1000, ledger,
    nutzer: [n('testkonto', 9000), n('echt', 1200)],
    auszahlungen: [
      { uid: 'testkonto', status: 'sent', cents: 1000, at: JETZT - 20 * TAG, testLink: false }, // echtes Geld, aber Testkonto
      { uid: 'alt', status: 'sent', cents: 1000, at: JETZT - 100 * TAG, testLink: true }, // Testumgebung
      { uid: 'kunde', status: 'sent', cents: 1100, at: JETZT - 3 * TAG, testLink: false },
    ],
  });
  it('Guthaben des Testkontos steht nicht in den Kunden-Zahlen, aber sichtbar daneben', () => {
    expect(a.test).toEqual({ personen: 1, cents: 9000 });
    expect(a.gesamt).toEqual({ personen: 1, cents: 1200 });
    expect(a.reif).toEqual({ personen: 1, cents: 1200 });
  });
  it('Testumgebung (kein Geld) und echte Auszahlungen an ein Testkonto getrennt', () => {
    expect(a.auszahlungen.versandt).toEqual({ anzahl: 1, cents: 1100 });
    expect(a.auszahlungen.testumgebung).toEqual({ anzahl: 1, cents: 1000 });
    expect(a.auszahlungen.anTestkonto).toEqual({ anzahl: 1, cents: 1000 });
    expect(a.auszahlungen.empfaenger).toBe(1);
  });
  it('Testkonto erscheint in der Liste, gekennzeichnet, nicht in der Vorschau', () => {
    expect(a.liste.find((z) => z.kuerzel === 'testko').test).toBe(true);
    expect(a.vorschau30).toEqual({ personen: 0, cents: 0 });
  });
});

describe('Liste der Personen ab der Hälfte der Schwelle', () => {
  const ledger = new Map([
    ['reif', [earn(600, 60, 600), earn(500, 20, 1100), earn(100, 5, 1200)]],
    ['nah', [earn(900, 40, 900), earn(90, 10, 990), { type: 'reverse', cents: 30, at: JETZT - 9 * TAG, balanceAfter: 960 }]],
    ['ruht', [earn(700, 90, 700)]],
    ['neu', [earn(600, 3, 600)]], // erst seit 3 Tagen dabei
    ['ausgezahlt', [
      earn(1500, 50, 1500),
      { type: 'payout', cents: 1500, at: JETZT - 45 * TAG, balanceAfter: 0, payoutId: 'p1' },
      { type: 'admin_adjust', cents: 1500, at: JETZT - 44 * TAG, balanceAfter: 1500, payoutId: 'p1', reason: 'payout_failed_refund' },
      earn(20, 2, 1520),
    ]],
    ['teil', [
      earn(3000, 40, 3000),
      { type: 'payout', cents: 1000, at: JETZT - 15 * TAG, balanceAfter: 2000, payoutId: 'p2' }, // Teil-Auszahlung
    ]],
  ]);
  ledger.set('wieder', [
    earn(1000, 50, 1000),
    { type: 'payout', cents: 1000, at: JETZT - 25 * TAG, balanceAfter: 0, payoutId: 'p3' },
    earn(300, 10, 300),
  ]);
  ledger.set('nurgescheitert', [
    earn(300, 20, 300),
    { type: 'payout', cents: 300, at: JETZT - 19 * TAG, balanceAfter: 0, payoutId: 'p4' },
    { type: 'admin_adjust', cents: 300, at: JETZT - 19 * TAG, balanceAfter: 300, payoutId: 'p4', reason: 'payout_failed_refund' },
  ]);
  const a = baueAuszahlung({
    jetzt: JETZT, schwelleCents: 1000, ledger,
    nutzer: [n('nah', 960), n('reif', 1200), n('ruht', 700), n('klein', 499), n('ausgezahlt', 1520), n('neu', 600), n('teil', 2000),
      n('wieder', 300), n('nurgescheitert', 300)],
  });
  const zeile = (k) => a.liste.find((z) => z.kuerzel === k.slice(0, 6));

  it('ab 50 % der Schwelle plus Wiederholer; Reife zuerst, dann wer am schnellsten dran ist, „ruht" zuletzt', () => {
    expect(a.liste.map((z) => z.kuerzel)).toEqual(['teil', 'ausgez', 'reif', 'neu', 'nah', 'wieder', 'ruht']);
    expect(a.liste.every((z) => !('uid' in z))).toBe(true);
  });
  it('eine nur gescheiterte Auszahlung macht niemanden zum Wiederholer', () => {
    expect(a.liste.some((z) => z.kuerzel === 'nurges')).toBe(false);
  });
  it('verdient in 30 Tagen = Gutschriften minus Stornos, ohne Auszahlungen und Rückbuchungen', () => {
    expect(zeile('reif').verdient30).toBe(600);
    expect(zeile('nah').verdient30).toBe(60);
    expect(zeile('ausgezahlt').verdient30).toBe(20);
    expect(zeile('ruht').verdient30).toBe(0);
  });
  it('Prognose aus dem Tempo — junge Konten über ihre tatsächliche Zeit (mind. 7 Tage)', () => {
    expect(zeile('nah').tageBisSchwelle).toBe(20); // 40 ct fehlen, 60 ct / 30 Tage
    expect(zeile('neu').tageBisSchwelle).toBe(5); // 400 ct fehlen, 600 ct / 7 Tage
    expect(zeile('ruht').tageBisSchwelle).toBeNull();
    expect(zeile('reif').tageBisSchwelle).toBe(0);
  });
  it('„wartet seit": Übertritt über die Schwelle oder letzte Teil-Auszahlung', () => {
    expect(zeile('reif').wartetSeit).toBe(JETZT - 20 * TAG);
    expect(zeile('teil').wartetSeit).toBe(JETZT - 15 * TAG);
    expect(zeile('nah').wartetSeit).toBeNull();
  });
  it('eine gescheiterte, zurückgebuchte Auszahlung ist weder „letzte Auszahlung" noch Unterbrechung', () => {
    expect(zeile('ausgezahlt').letzteAuszahlung).toBeNull();
    expect(zeile('ausgezahlt').wartetSeit).toBe(JETZT - 50 * TAG);
    expect(zeile('teil').letzteAuszahlung).toBe(JETZT - 15 * TAG);
  });
  it('Vorschau 30 Tage: wer die Schwelle NEU erreicht (ohne die schon Reifen), je Schwelle gerechnet', () => {
    // neu (5 Tage), nah (20 Tage), wieder (700 ct fehlen, 300 ct/30 Tage → 70 Tage) → nur zwei
    expect(zeile('wieder').tageBisSchwelle).toBe(70);
    expect(a.vorschau30).toEqual({ personen: 2, cents: 2000 });
  });
});

describe('ueberSchwelleSeit', () => {
  it('ohne balanceAfterCents keine Aussage', () => {
    expect(ueberSchwelleSeit([{ type: 'earn', cents: 2000, at: 1 }], 1000)).toBeNull();
  });
});

describe('Auszahlungen', () => {
  const a = baueAuszahlung({
    jetzt: JETZT, schwelleCents: 1000, nutzer: [],
    auszahlungen: [
      { uid: 'a', status: 'sent', cents: 1000, at: JETZT - 5 * TAG },
      { uid: 'b', status: 'delivered', cents: 1500, at: JETZT - 40 * TAG },
      { uid: 'c', status: 'requested', cents: 1200, at: JETZT - TAG },
      { uid: 'f', status: 'requested', cents: 1000, at: JETZT - 2 * 60 * 1000 }, // gerade unterwegs
      { uid: 'g', status: 'requested', cents: 1000, at: JETZT - TAG, testLink: true }, // Testumgebung
      { uid: 'd', status: 'failed', cents: 10, at: JETZT - 3 * TAG },
      { uid: 'e', status: 'failed', cents: 900, at: JETZT - 90 * TAG },
    ],
  });
  it('versandt, letzte 30 Tage, hängend, gescheitert nur der letzten 30 Tage', () => {
    expect(a.auszahlungen.versandt).toEqual({ anzahl: 2, cents: 2500 });
    expect(a.auszahlungen.letzte30).toEqual({ anzahl: 1, cents: 1000 });
    expect(a.auszahlungen.haengt).toEqual({ anzahl: 1, cents: 1200 });
    expect(a.auszahlungen.gescheitert30).toEqual({ anzahl: 1, cents: 10 });
    expect(a.auszahlungen.empfaenger).toBe(2);
  });
});
