'use strict';
/**
 * Prüfkonsole, Produktfotos (src/einreichung.js): Zeile, Vorprüfung, EAN-
 * Nachbarn, Warteschlange. Maßstab ist die Morgenrunde — beide müssen über
 * denselben Fall dasselbe sagen (Befund 26.09.2026).
 */
const {
  rowOf, stripPolicy, precheckOf, precheckFuerFall, nachbarnAus, gruppiereNachEan, eanIndex, baueFotoListe, bildDefektOf, safeStatus,
} = require('../src/einreichung');

const GUELTIG = '4061464833821';
const ANDERE = '4000417025005';
const STUNDE = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 25, 8, 0, 0);
const ALLE_FOTOS = { front: 'a', rueckseite: 'b', hersteller: 'c', ean: 'd', naehrwerte: 'e', zutaten: 'f', preis: 'g' };
const doc = (id, x) => ({ id, data: () => x });
const basis = (extra) => ({ userId: 'u1', marketId: 'm1', status: 'pending', createdAt: T0, images: ALLE_FOTOS, ...extra });

describe('rowOf: angezeigt wird der effektive Wert, mit Herkunft', () => {
  const x = basis({
    productName: null, productNameOcr: null, productNameRescueOcr: 'K-Classic Gouda gerieben',
    ean: null, eanRescueOcr: GUELTIG,
    priceImageKind: 'fehlt', priceRescueOcr: { priceCents: 229, currency: 'EUR', priceImageKind: 'preisschild' },
    manufacturerRescueOcr: { name: 'DMK Deutsches Milchkontor GmbH' },
  });
  const r = rowOf(doc('c1', x));

  it('Name, EAN, Preis, Preisbild und Hersteller aus der Nachlesung', () => {
    expect(r).toMatchObject({
      anzeigeName: 'K-Classic Gouda gerieben', anzeigeEan: GUELTIG, priceCents: 229,
      priceImageKindAnzeige: 'preisschild', manufacturer: 'DMK Deutsches Milchkontor GmbH',
      herkunft: { nameQuelle: 'nachgelesen', eanNachgelesen: true, preisNachgelesen: true, herstellerNachgelesen: true },
    });
  });

  it('Rohfelder bleiben unverändert', () => {
    expect(r).toMatchObject({ productName: null, productNameOcr: null, ean: null, priceImageKind: 'fehlt' });
  });

  it('die Doppel-Regel bekommt den nachgelesenen Preis, aber NICHT den nachgelesenen Hersteller', () => {
    expect(r._policy).toMatchObject({ ean: GUELTIG, priceOcr: { priceCents: 229 }, manufacturerOcr: null });
  });

  it('stripPolicy entfernt die internen Regel-Eingaben', () => {
    const aus = stripPolicy(r);
    expect(aus._policy).toBeUndefined();
    expect(aus._komplett).toBeUndefined();
    expect(aus.anzeigeName).toBe('K-Classic Gouda gerieben');
  });

  it('Namer-Werte gehen vor, Preisbild dann vom Namer', () => {
    const n = rowOf(doc('c2', basis({ productNameOcr: 'Namer', ean: ANDERE, priceOcr: { priceCents: 199 }, priceImageKind: 'kassenbon', manufacturerOcr: { name: 'Bauer' }, priceRescueOcr: { priceCents: 229, priceImageKind: 'preisschild' } })));
    expect(n).toMatchObject({ anzeigeName: 'Namer', anzeigeEan: ANDERE, priceCents: 199, priceImageKindAnzeige: 'kassenbon', manufacturer: 'Bauer' });
    expect(n.herkunft).toEqual({ nameQuelle: 'ocr', eanNachgelesen: false, preisNachgelesen: false, herstellerNachgelesen: false });
  });

  it('fremder Status wird „unknown" (landet in HTML-Attributen)', () => {
    expect(rowOf(doc('c3', basis({ status: '"><script>' }))).status).toBe('unknown');
    expect(safeStatus('approved')).toBe('approved');
  });
});

describe('precheckOf: dieselbe Semantik wie die Morgenrunde', () => {
  it('nachgelesener Name und nachgelesene EAN → vollständig', () => {
    const r = rowOf(doc('k', basis({ productNameRescueOcr: 'Milsani Skyr', eanRescueOcr: GUELTIG })));
    expect(precheckOf(r, [])).toMatchObject({ verdict: 'ok', reasons: [] });
  });

  it('ohne Nachlesung: kein Name, Barcode fehlt', () => {
    const r = rowOf(doc('k', basis({})));
    expect(precheckOf(r, []).reasons).toEqual(['ean_fehlt', 'kein_produktname']);
  });

  it('nur nachgelesene EAN wird gegen Doppel geprüft (vorher nie)', () => {
    const ref = rowOf(doc('ref', basis({ ean: GUELTIG, productNameOcr: 'Skyr', status: 'approved' })));
    const k = rowOf(doc('k', basis({ productNameOcr: 'Skyr', eanRescueOcr: GUELTIG, createdAt: T0 + STUNDE })));
    expect(precheckOf(k, [ref])).toMatchObject({ verdict: 'locked', reasons: ['sperre_30_tage_gleicher_nutzer'] });
  });

  it('geretteter Preis löst die Sperre, geretteter Hersteller nicht', () => {
    const ref = rowOf(doc('ref', basis({ ean: GUELTIG, productNameOcr: 'Gouda', status: 'approved', priceOcr: { priceCents: 199 }, manufacturerOcr: { name: 'Kaufland Stiftung & Co. KG' } })));
    const preis = rowOf(doc('k1', basis({ ean: GUELTIG, productNameOcr: 'Gouda', createdAt: T0 + STUNDE, priceRescueOcr: { priceCents: 229, priceImageKind: 'preisschild' } })));
    const hersteller = rowOf(doc('k2', basis({ ean: GUELTIG, productNameOcr: 'Gouda', createdAt: T0 + STUNDE, manufacturerRescueOcr: { name: 'DMK' } })));
    expect(precheckOf(preis, [ref]).verdict).toBe('ok');
    expect(precheckOf(hersteller, [ref]).verdict).toBe('locked');
  });
});

describe('precheckFuerFall: entschiedene Fälle zeigen das gespeicherte Urteil', () => {
  const gespeichert = { verdict: 'ok', reasons: [] };
  it('freigegeben mit gespeichertem Urteil → gespeichert, gekennzeichnet', () => {
    const r = rowOf(doc('k', basis({ status: 'approved', review: { precheck: gespeichert, decidedBy: 'worker-fotorunde' } })));
    // Frisch gerechnet wäre das „unvollständig" (kein Name, keine EAN).
    expect(precheckFuerFall(r, [])).toMatchObject({ ...gespeichert, quelle: 'gespeichert' });
  });
  it('gespeichertes Urteil MIT Doppel-Befund → der gespeicherte bleibt', () => {
    const dup = { verdict: 'locked', reason: 'sperre_30_tage_gleicher_nutzer', priorId: 'alt', sameUser: true, lockUntil: T0, updatedFields: [] };
    const r = rowOf(doc('k', basis({ status: 'rejected', review: { precheck: { verdict: 'locked', reasons: [dup.reason], dup } } })));
    expect(precheckFuerFall(r, [])).toEqual({ verdict: 'locked', reasons: [dup.reason], dup, dupQuelle: 'gespeichert', quelle: 'gespeichert' });
  });
  it('Sperr-Ablehnung der Runde ohne gespeicherten Doppel-Befund → Referenz heute berechnet, Urteil bleibt', () => {
    // Stand der Runde bis 26.09.2026: precheck = {verdict, reasons}, kein dup.
    // Ohne Referenz fehlte beim Zurückholen die Zeile „Früher/Anders".
    const ref = rowOf(doc('ref', basis({ ean: GUELTIG, productNameOcr: 'Skyr', status: 'approved' })));
    const r = rowOf(doc('k', basis({
      ean: GUELTIG, productNameOcr: 'Skyr', createdAt: T0 + STUNDE, status: 'rejected', rejectReason: 'sperre_30_tage_gleicher_nutzer',
      review: { precheck: { verdict: 'locked', reasons: ['sperre_30_tage_gleicher_nutzer'] }, decidedBy: 'worker-fotorunde' },
    })));
    const pre = precheckFuerFall(r, [ref]);
    expect(pre).toMatchObject({ verdict: 'locked', reasons: ['sperre_30_tage_gleicher_nutzer'], quelle: 'gespeichert', dupQuelle: 'heute' });
    expect(pre.dup).toMatchObject({ priorId: 'ref', sameUser: true, updatedFields: [] });
  });
  it('gespeichertes Urteil „ok" behält sein Urteil, auch wenn der heutige Doppel-Befund anders lautet', () => {
    const ref = rowOf(doc('ref', basis({ ean: GUELTIG, productNameOcr: 'Skyr', status: 'approved' })));
    const r = rowOf(doc('k', basis({ ean: GUELTIG, productNameOcr: 'Skyr', createdAt: T0 + STUNDE, status: 'approved', review: { precheck: gespeichert } })));
    const pre = precheckFuerFall(r, [ref]);
    expect(pre).toMatchObject({ verdict: 'ok', reasons: [], dupQuelle: 'heute' });
    expect(pre.dup.priorId).toBe('ref');
  });
  it('entschieden ohne gespeichertes Urteil (alte Handentscheidung) → frisch, als nachträglich gekennzeichnet', () => {
    const r = rowOf(doc('k', basis({ status: 'rejected', review: { decidedBy: 'x', reason: 'unvollstaendig' } })));
    expect(precheckFuerFall(r, [])).toMatchObject({ verdict: 'incomplete', quelle: 'nachtraeglich' });
  });
  it('offen → immer frisch, auch mit Rest eines alten Urteils', () => {
    const r = rowOf(doc('k', basis({ review: { precheck: gespeichert } })));
    expect(precheckFuerFall(r, [])).toMatchObject({ verdict: 'incomplete', quelle: 'frisch' });
  });
});

describe('EAN-Nachbarn über beide Felder', () => {
  const gescannt = doc('a', basis({ ean: GUELTIG }));
  const nachgelesen = doc('b', basis({ eanRescueOcr: GUELTIG }));
  const beides = doc('c', basis({ ean: ANDERE, eanRescueOcr: GUELTIG })); // gehört zu ANDERE
  const falsch = doc('d', basis({ eanRescueOcr: '4061464833828' }));

  it('nachbarnAus: doppelt gefundene nur einmal, nur passende effektive EAN, ohne sich selbst', () => {
    const r = nachbarnAus([gescannt, nachgelesen, beides, gescannt, nachgelesen], GUELTIG, 'a');
    expect(r.map((x) => x.id)).toEqual(['b']);
  });

  it('gruppiereNachEan: je effektiver EAN, ohne EAN nicht dabei', () => {
    const g = gruppiereNachEan([gescannt, nachgelesen, beides, falsch, beides]);
    expect([...g.keys()].sort()).toEqual([ANDERE, GUELTIG].sort());
    expect(g.get(GUELTIG).map((x) => x.id).sort()).toEqual(['a', 'b']);
    expect(g.get(ANDERE).map((x) => x.id)).toEqual(['c']);
  });

  it('eanIndex der Warteschlange: nachgelesene EAN + Preis, nie der nachgelesene Hersteller', () => {
    const idx = eanIndex([
      doc('x', { userId: 'u1', eanRescueOcr: GUELTIG, status: 'approved', createdAt: T0, priceRescueOcr: { priceCents: 229 }, manufacturerOcr: null }),
      doc('y', { userId: 'u2', status: 'pending', createdAt: T0 }),
    ]);
    expect([...idx.keys()]).toEqual([GUELTIG]);
    const e = idx.get(GUELTIG)[0];
    expect(e._policy).toMatchObject({ id: 'x', ean: GUELTIG, priceOcr: { priceCents: 229 }, manufacturerOcr: null });
    expect(e.ean).toBe(GUELTIG);
  });
});

describe('baueFotoListe: Anzeige und Suche über effektive Werte', () => {
  const offen = [
    doc('p1', basis({ productNameRescueOcr: 'K-Classic Gouda', eanRescueOcr: GUELTIG, createdAt: T0 + 2 * STUNDE })),
    doc('p2', basis({ productName: 'Milsani Skyr', ean: ANDERE, createdAt: T0 + STUNDE })),
  ];
  const index = eanIndex([
    doc('ref', { userId: 'u1', ean: ANDERE, status: 'approved', createdAt: T0 }),
  ]);

  it('zeigt nachgelesenen Namen/EAN mit Kennzeichen, älteste zuerst, Urteil wie precheckOf', () => {
    const l = baueFotoListe(offen, index, {}, '');
    expect(l.rows.map((r) => r.id)).toEqual(['p2', 'p1']);
    expect(l.rows[1]).toMatchObject({ productName: 'K-Classic Gouda', ean: GUELTIG, nameNachgelesen: true, eanNachgelesen: true, verdict: 'ok' });
    expect(l.rows[0]).toMatchObject({ verdict: 'locked', nameNachgelesen: false });
    expect(l.counts).toEqual({ ok: 1, locked: 1 });
    expect(l.rows[0]._suche).toBeUndefined();
  });

  it('Suche findet nachgelesene Namen und EANs', () => {
    expect(baueFotoListe(offen, index, {}, 'gouda').rows.map((r) => r.id)).toEqual(['p1']);
    expect(baueFotoListe(offen, index, {}, GUELTIG.slice(0, 8)).rows.map((r) => r.id)).toEqual(['p1']);
  });

  it('Urteils-Filter', () => {
    expect(baueFotoListe(offen, index, { verdict: 'locked' }, '').rows.map((r) => r.id)).toEqual(['p2']);
  });
});

describe('bildDefektOf', () => {
  it('nur bekannte Slots, einmal je Slot, Grund gekürzt', () => {
    const x = { productNameOcrBildDefekt: [{ slot: 'hersteller', groesse: 1048576, grund: 'kein_bildende' }, { slot: '<img>', grund: 'x' }, 'preis', { slot: 'hersteller' }] };
    expect(bildDefektOf(x)).toEqual([{ slot: 'hersteller', grund: 'kein_bildende' }, { slot: 'preis', grund: null }]);
    expect(bildDefektOf({})).toEqual([]);
  });
});
