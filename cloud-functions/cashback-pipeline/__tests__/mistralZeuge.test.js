'use strict';
// Parallelbetrieb Mistral-Zeuge (09.10.2026): Vergleich, Normalisierung, kein Wurf.
const { zeugeAusfuehren, vergleich, normalisieren, preisAnteil } = require('../lib/mistralZeuge');

const antwort = (anno, ok = true, status = 200) => async () => ({
  ok, status, text: async () => JSON.stringify({ model: 'mistral-ocr-4-1', usage_info: { pages_processed: 1 }, document_annotation: JSON.stringify(anno) }),
});
const ocr = { parsed: { totalCents: 1059, bonDate: '2026-09-29', bonTime: '17:43', items: [{ priceCents: 30 }, { priceCents: 1029 }] },
  robust: { reads: [{ totalCents: 1059, bonDate: '2026-09-29', bonTime: '17:43' }] } };

describe('mistralZeuge', () => {
  test('normalisieren entfernt Endsumme und Beträge über der Summe aus den Positionen', () => {
    const n = normalisieren({ haendler: 'Netto', datum: '2026-09-29', uhrzeit: '17:43 Uhr', endsumme_cent: 1059, positionen: [{ preis_cent: 30 }, { preis_cent: 1029 }, { preis_cent: 1059 }, { preis_cent: 2000 }] });
    expect(n).toEqual({ markt: 'Netto', datum: '2026-09-29', zeit: '17:43', summe: 1059, preise: [30, 1029] });
  });
  test('vergleich: einig nur bei gleicher Summe und gleichem Datum, Uhrzeit nur wenn beide haben', () => {
    const z = { summe: 1059, datum: '2026-09-29', zeit: '17:43', preise: [30, 1029] };
    expect(vergleich(z, { summe: 1059, datum: '2026-09-29', zeit: '17:43', preise: [30, 1029] })).toMatchObject({ einigGeld: true, preisAnteil: 1 });
    expect(vergleich(z, { summe: 1060, datum: '2026-09-29', zeit: '17:43' }).einigGeld).toBe(false);
    expect(vergleich(z, { summe: 1059, datum: '2026-09-29', zeit: '15:43' }).einigGeld).toBe(false);
    expect(vergleich(z, { summe: 1059, datum: '2026-09-29', zeit: null }).einigGeld).toBe(true);
  });
  test('preisAnteil zählt als Multimenge', () => {
    expect(preisAnteil([99, 99, 150], [99, 150])).toBeCloseTo(0.667, 2);
  });
  test('zeugeAusfuehren: ok mit Vergleich gegen Endergebnis und erste Lesung', async () => {
    const z = await zeugeAusfuehren({ bytes: Buffer.from('x'), mimeType: 'image/jpeg', ocr, key: 'k',
      fetchImpl: antwort({ haendler: 'Netto', datum: '2026-09-29', uhrzeit: '17:43', endsumme_cent: 1059, positionen: [{ name: 'a', preis_cent: 30 }, { name: 'b', preis_cent: 1029 }] }) });
    expect(z.status).toBe('ok');
    expect(z.gegenFinal.einigGeld).toBe(true);
    expect(z.gegenErsteLesung.einigGeld).toBe(true);
    expect(JSON.stringify(z)).not.toMatch(/"name"/); // keine Artikelnamen gespeichert
  });
  test('zeugeAusfuehren wirft nie: HTTP-Fehler, Netzfehler, kein Schlüssel, Online-Bestellung', async () => {
    await expect(zeugeAusfuehren({ bytes: Buffer.from('x'), ocr, key: 'k', fetchImpl: antwort({}, false, 500) })).resolves.toMatchObject({ status: 'fehler' });
    await expect(zeugeAusfuehren({ bytes: Buffer.from('x'), ocr, key: 'k', fetchImpl: async () => { throw new Error('netz'); } })).resolves.toMatchObject({ status: 'fehler' });
    await expect(zeugeAusfuehren({ bytes: Buffer.from('x'), ocr, key: '' })).resolves.toMatchObject({ status: 'kein_schluessel' });
    let gerufen = false;
    await expect(zeugeAusfuehren({ bytes: Buffer.from('x'), ocr, key: 'k', istOnline: () => true, fetchImpl: async () => { gerufen = true; } })).resolves.toMatchObject({ status: 'online_ausgelassen' });
    expect(gerufen).toBe(false);
  });
});
