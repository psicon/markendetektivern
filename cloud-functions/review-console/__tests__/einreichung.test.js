'use strict';
/**
 * Prüfkonsole, Produktfotos (src/einreichung.js): Zeile, Vorprüfung, EAN-
 * Nachbarn, Warteschlange. Maßstab ist die Morgenrunde — beide müssen über
 * denselben Fall dasselbe sagen (Befund 26.09.2026).
 */
const {
  rowOf, stripPolicy, precheckOf, precheckFuerFall, nachbarnAus, nachbarnVon, gruppiereNachEan, eanIndex, baueFotoListe, bildDefektOf, safeStatus, rundeOffenOf,
} = require('../src/einreichung');
const { eanSchluessel } = require('../src/werte');

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

  it('ohne gelesenen Preis: Vorprüfung bleibt ok, aber mit Hinweis (Preis-Pflicht 26.09.)', () => {
    const ohne = rowOf(doc('k', basis({ productNameOcr: 'Skyr', ean: GUELTIG })));
    expect(precheckOf(ohne, [])).toMatchObject({ verdict: 'ok', hinweise: ['preis_nicht_gelesen'] });
    const mit = rowOf(doc('m', basis({ productNameOcr: 'Skyr', ean: GUELTIG, priceRescueOcr: { priceCents: 129 } })));
    expect(precheckOf(mit, []).hinweise).toEqual([]);
  });

  it('ohne Nachlesung: kein Name, Barcode fehlt', () => {
    const r = rowOf(doc('k', basis({})));
    expect(precheckOf(r, []).reasons).toEqual(['ean_fehlt', 'kein_produktname']);
  });

  it('nur nachgelesene EAN wird gegen Doppel geprüft (vorher nie)', () => {
    const ref = rowOf(doc('ref', basis({ ean: GUELTIG, productNameOcr: 'Skyr', status: 'approved' })));
    const k = rowOf(doc('k', basis({ productNameOcr: 'Skyr', eanRescueOcr: GUELTIG, createdAt: T0 + STUNDE })));
    expect(precheckOf(k, [ref])).toMatchObject({ verdict: 'locked', reasons: ['sperre_woche_gleicher_nutzer'] });
  });

  it('Wochen-Regel (02.10.2026): weder geretteter Preis noch Hersteller lösen die Sperre', () => {
    const ref = rowOf(doc('ref', basis({ ean: GUELTIG, productNameOcr: 'Gouda', status: 'approved', priceOcr: { priceCents: 199 }, manufacturerOcr: { name: 'Kaufland Stiftung & Co. KG' } })));
    const preis = rowOf(doc('k1', basis({ ean: GUELTIG, productNameOcr: 'Gouda', createdAt: T0 + STUNDE, priceRescueOcr: { priceCents: 229, priceImageKind: 'preisschild' } })));
    const hersteller = rowOf(doc('k2', basis({ ean: GUELTIG, productNameOcr: 'Gouda', createdAt: T0 + STUNDE, manufacturerRescueOcr: { name: 'DMK' } })));
    expect(precheckOf(preis, [ref]).verdict).toBe('locked');
    expect(precheckOf(hersteller, [ref]).verdict).toBe('locked');
    // 3 Tage später: auch gesperrt; 8 Tage später: frei.
    expect(precheckOf(rowOf(doc('k3', basis({ ean: GUELTIG, productNameOcr: 'Gouda', createdAt: T0 + 72 * STUNDE }))), [ref]).verdict).toBe('locked');
    expect(precheckOf(rowOf(doc('k4', basis({ ean: GUELTIG, productNameOcr: 'Gouda', createdAt: T0 + 192 * STUNDE }))), [ref]).verdict).toBe('ok');
  });
});

describe('precheckOf: gesperrte Konten und Barcode-Foto (Entscheidungen Patrick 02.10.2026)', () => {
  const sauber = (extra = {}) => rowOf(doc('k', basis({ ean: GUELTIG, productNameOcr: 'Skyr', priceOcr: { priceCents: 129 }, ...extra })));

  it('gesperrtes Konto → locked mit konto_gesperrt vorne, auch bei sonst sauberem Fall', () => {
    expect(precheckOf(sauber(), [], { kontoSperre: 'gesperrt' })).toMatchObject({ verdict: 'locked', reasons: ['konto_gesperrt'], kontoSperre: 'gesperrt' });
  });
  it('Sperrliste nicht lesbar → hold, nie ok', () => {
    expect(precheckOf(sauber(), [], { kontoSperre: 'unbekannt' })).toMatchObject({ verdict: 'hold', reasons: ['kontosperre_unbekannt'] });
  });
  it('kein Eintrag → wie bisher', () => {
    expect(precheckOf(sauber(), [], { kontoSperre: null })).toMatchObject({ verdict: 'ok', reasons: [] });
  });
  it('Barcode-Foto mit anderer Nummer → hold ean_abweichend; Rohwert bleibt sichtbar', () => {
    const r = sauber({ eanFotoOcr: { ean: ANDERE } });
    expect(r.eanFoto).toMatchObject({ art: 'abweichend', gelesen: ANDERE, gespeichert: GUELTIG });
    expect(precheckOf(r, [])).toMatchObject({ verdict: 'hold', reasons: ['ean_abweichend'] });
  });
  it('… und die Doppel-Regel unter der Foto-Nummer: eigene Freigabe binnen 7 Tagen wird gemeldet', () => {
    const r = sauber({ eanFotoOcr: { ean: ANDERE }, createdAt: T0 + 2 * STUNDE });
    const unterFoto = [rowOf(doc('alt', basis({ ean: ANDERE, productNameOcr: 'Skyr', status: 'approved', createdAt: T0 })))];
    const pre = precheckOf(r, [], { fotoEanRows: unterFoto });
    expect(pre.reasons).toEqual(['ean_abweichend', 'foto_nummer_doppelt']);
    expect(pre.dupFoto).toMatchObject({ verdict: 'locked', priorId: 'alt' });
  });
  it('gleiche Nummer oder nicht lesbar → kein Einfluss', () => {
    expect(precheckOf(sauber({ eanFotoOcr: { ean: GUELTIG } }), []).verdict).toBe('ok');
    expect(precheckOf(sauber({ eanFotoOcr: { ean: null } }), []).verdict).toBe('ok');
    // die zweite Lesung der Runde las die gespeicherte Nummer (befund gleich, ean = gespeichert)
    expect(precheckOf(sauber({ eanFotoOcr: { ean: GUELTIG, befund: 'gleich', grund: 'zweite_lesung' } }), []).verdict).toBe('ok');
  });
  it('zweite Lesung der Runde uneinig (befund unsicher) → hold ean_unsicher, nicht „bestätigte Abweichung" (Prüfrunde 02.10.)', () => {
    const r = sauber({ eanFotoOcr: { ean: ANDERE, befund: 'unsicher', zweit: '4001382088125' } });
    expect(r.eanFoto).toMatchObject({ art: 'unsicher', gelesen: ANDERE, zweit: '4001382088125' });
    const pre = precheckOf(r, [], { fotoEanRows: [] });
    expect(pre).toMatchObject({ verdict: 'hold', reasons: ['ean_unsicher'] });
    expect(pre.dupFoto).toBeUndefined();
  });
  it('Warteschlange reicht die Kontosperre je Person durch; gesperrte stehen am Ende und zählen getrennt', () => {
    const l = baueFotoListe([
      doc('k', basis({ ean: GUELTIG, productNameOcr: 'Skyr', createdAt: T0 })),
      doc('j', basis({ userId: 'u2', ean: ANDERE, productNameOcr: 'Quark', createdAt: T0 + STUNDE })),
    ], new Map(), {}, '', (uid) => (uid === 'u1' ? 'gesperrt' : null));
    expect(l.rows.map((r) => r.id)).toEqual(['j', 'k']);
    expect(l.rows[1]).toMatchObject({ verdict: 'locked', reasons: ['konto_gesperrt'], gesperrt: true });
    expect(l.rows[0].gesperrt).toBeUndefined();
    expect(l.counts).toEqual({ ok: 1, locked: 1, gesperrt: 1 });
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

  it('gruppiereNachEan: je effektiver EAN (Schlüssel: GTIN in jeder Schreibweise), ohne EAN nicht dabei', () => {
    const g = gruppiereNachEan([gescannt, nachgelesen, beides, falsch, beides]);
    expect([...g.keys()].sort()).toEqual([eanSchluessel(ANDERE), eanSchluessel(GUELTIG)].sort());
    expect(nachbarnVon(g, GUELTIG).map((x) => x.id).sort()).toEqual(['a', 'b']);
    expect(nachbarnVon(g, ANDERE).map((x) => x.id)).toEqual(['c']);
    expect(nachbarnVon(g, null)).toEqual([]);
  });

  it('„0" + EAN-13 ist derselbe Artikel: Nachbar, Gruppe und Doppel-Regel (Prüfrunde 02.10.)', () => {
    const variante = doc('v', basis({ ean: '0' + GUELTIG }));
    expect(nachbarnAus([gescannt, variante], GUELTIG, 'a').map((x) => x.id)).toEqual(['v']);
    expect(nachbarnVon(gruppiereNachEan([gescannt, variante]), '0' + GUELTIG).map((x) => x.id).sort()).toEqual(['a', 'v']);
    // Freigabe unter der kurzen Schreibweise sperrt die lange binnen 7 Tagen
    const ref = rowOf(doc('ref', basis({ ean: GUELTIG, productNameOcr: 'Skyr', status: 'approved', createdAt: T0 })));
    const k = rowOf(doc('k', basis({ ean: '0' + GUELTIG, productNameOcr: 'Skyr', createdAt: T0 + 24 * STUNDE })));
    expect(precheckOf(k, nachbarnAus([doc('ref', basis({ ean: GUELTIG, status: 'approved', createdAt: T0 }))], k.anzeigeEan, 'k')).verdict).toBe('locked');
    expect(precheckOf(k, [ref])).toMatchObject({ verdict: 'locked', reasons: ['sperre_woche_gleicher_nutzer'] });
  });

  it('eanIndex der Warteschlange: nachgelesene EAN + Preis, nie der nachgelesene Hersteller', () => {
    const idx = eanIndex([
      doc('x', { userId: 'u1', eanRescueOcr: GUELTIG, status: 'approved', createdAt: T0, priceRescueOcr: { priceCents: 229 }, manufacturerOcr: null }),
      doc('y', { userId: 'u2', status: 'pending', createdAt: T0 }),
    ]);
    expect([...idx.keys()]).toEqual([eanSchluessel(GUELTIG)]);
    const e = nachbarnVon(idx, GUELTIG)[0];
    expect(e._policy).toMatchObject({ id: 'x', ean: GUELTIG, priceOcr: { priceCents: 229 }, manufacturerOcr: null });
    expect(e.ean).toBe(GUELTIG);
  });

  it('Server-Zeitpunkt (createTime) geht vor createdAt — ein verschobenes createdAt hebt die Sperre nicht auf (Prüfrunde 02.10.)', () => {
    const mitZeit = (id, x, createTime) => ({ id, data: () => x, createTime: { toMillis: () => createTime } });
    const ref = rowOf(mitZeit('ref', basis({ ean: GUELTIG, productNameOcr: 'Skyr', status: 'approved', createdAt: T0 }), T0));
    // Client behauptet, die neue Einreichung sei 30 Tage älter — der Server weiß: 1 Tag später.
    const k = rowOf(mitZeit('k', basis({ ean: GUELTIG, productNameOcr: 'Skyr', createdAt: T0 - 30 * 24 * STUNDE }), T0 + 24 * STUNDE));
    expect(k._policy.createdAt).toBe(T0 + 24 * STUNDE);
    expect(k.createdAt).toBe(T0 - 30 * 24 * STUNDE); // Anzeige bleibt das Feld
    expect(precheckOf(k, [ref]).verdict).toBe('locked');
    expect(nachbarnVon(eanIndex([mitZeit('ref', { userId: 'u1', ean: GUELTIG, status: 'approved', createdAt: T0 - 90 * 24 * STUNDE }, T0)]), GUELTIG)[0]._policy.createdAt).toBe(T0);
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

describe('Befunde der Morgenrunde in der Konsole (Prüfrunde 2, 02.10.2026)', () => {
  const sauber = (extra = {}) => rowOf(doc('k', basis({ ean: GUELTIG, productNameOcr: 'Skyr', priceOcr: { priceCents: 129 }, ...extra })));
  const runde = (ro) => ({ review: { rundeOffen: { grund: ro.sperrend && ro.sperrend[0], lauf: '2026-10-02_080000', at: { toMillis: () => T0 }, ...ro } } });

  it('Foto eines anderen Kontos / ältere offene Einreichung mit gleichem Foto → hold (vorher: „ok" mit Freigabe-Taste)', () => {
    for (const code of ['foto_fremdes_konto', 'foto_aeltere_offen', 'bilder_wiederverwendet', 'ean_abweichend', 'ean_unsicher']) {
      expect(precheckOf(sauber(runde({ sperrend: [code] })), [])).toMatchObject({ verdict: 'hold', reasons: [code] });
    }
  });
  it('mehrere Befunde, jeder einmal; zusammen mit dem eigenen Barcode-Befund der Konsole nicht doppelt', () => {
    const r = sauber({ ...runde({ sperrend: ['ean_abweichend', 'foto_fremdes_konto', 'ean_abweichend'] }), eanFotoOcr: { ean: ANDERE, befund: 'abweichend' } });
    expect(precheckOf(r, [])).toMatchObject({ verdict: 'hold', reasons: ['ean_abweichend', 'foto_fremdes_konto'] });
  });
  it('ein strengeres Urteil bleibt (locked, incomplete); gesperrtes Konto geht vor', () => {
    const ref = rowOf(doc('ref', basis({ ean: GUELTIG, productNameOcr: 'Skyr', status: 'approved', createdAt: T0 - STUNDE })));
    expect(precheckOf(sauber(runde({ sperrend: ['foto_fremdes_konto'] })), [ref])).toMatchObject({ verdict: 'locked', reasons: ['sperre_woche_gleicher_nutzer', 'foto_fremdes_konto'] });
    expect(precheckOf(sauber({ ...runde({ sperrend: ['foto_fremdes_konto'] }), images: { front: 'a' } }), []).verdict).toBe('incomplete');
    expect(precheckOf(sauber(runde({ sperrend: ['foto_fremdes_konto'] })), [], { kontoSperre: 'gesperrt' })).toMatchObject({ verdict: 'locked', reasons: ['konto_gesperrt', 'foto_fremdes_konto'] });
  });
  it('nur Information (Bildprüfung gescheitert, Ort auffällig …) oder unbekannte Codes → blockiert nicht', () => {
    expect(precheckOf(sauber(runde({ grund: 'bild_audit_gescheitert', sperrend: [] })), [])).toMatchObject({ verdict: 'ok', reasons: [] });
    expect(precheckOf(sauber(runde({ grund: 'x', sperrend: ['erfunden', 42, null] })), [])).toMatchObject({ verdict: 'ok', reasons: [] });
  });
  it('gilt nur für offene Einreichungen', () => {
    expect(precheckOf(sauber({ ...runde({ sperrend: ['foto_fremdes_konto'] }), status: 'approved' }), []).verdict).toBe('ok');
  });
  it('rundeOffenOf: bereinigt (Werte landen in der Oberfläche)', () => {
    expect(rundeOffenOf({})).toBeNull();
    expect(rundeOffenOf({ review: { precheck: {} } })).toBeNull();
    expect(rundeOffenOf({ review: { rundeOffen: { grund: 'foto_fremdes_konto', hinweis: 'h'.repeat(400), sperrend: ['foto_fremdes_konto', '<img>'], geplant: 'boese', lauf: 'L', trocken: 'ja', at: { toMillis: () => 5 } } } }))
      .toEqual({ grund: 'foto_fremdes_konto', geplant: null, hinweis: 'h'.repeat(300), zurueckgehalten: null, sperrend: ['foto_fremdes_konto'], lauf: 'L', trocken: false, at: 5 });
    expect(sauber(runde({ sperrend: ['ean_unsicher'] })).rundeOffen).toMatchObject({ sperrend: ['ean_unsicher'], lauf: '2026-10-02_080000' });
  });
  it('Warteschlange: der Fall steht als „zurückhalten" mit Grund da', () => {
    const l = baueFotoListe([doc('k', basis({ ean: GUELTIG, productNameOcr: 'Skyr', ...runde({ sperrend: ['foto_fremdes_konto'] }) }))], new Map(), {}, '');
    expect(l.rows[0]).toMatchObject({ verdict: 'hold', reasons: ['foto_fremdes_konto'] });
  });
});

describe('Barcode-Befund der Runde hält in der Konsole (Prüfrunde 2, 02.10.2026)', () => {
  const sauber = (extra = {}) => rowOf(doc('k', basis({ ean: GUELTIG, productNameOcr: 'Skyr', priceOcr: { priceCents: 129 }, ...extra })));
  it('gespeichert unsicher mit ungültiger erster Lesung (zweifelhaft) → ean_unsicher, Rohziffern sichtbar', () => {
    const r = sauber({ eanFotoOcr: { ean: '4013602313647', befund: 'unsicher', zweit: null } });
    expect(r.eanFoto).toMatchObject({ art: 'unsicher', gelesen: null, roh: '4013602313647' });
    expect(precheckOf(r, [])).toMatchObject({ verdict: 'hold', reasons: ['ean_unsicher'] });
  });
  it('gespeichert abweichend, heute nicht mehr nachrechenbar → hält trotzdem (als unsicher)', () => {
    // z. B. eine Regeländerung: gespeichert bleibt der Befund, bis ein Mensch entscheidet
    const r = sauber({ eanFotoOcr: { ean: '2112345000008', befund: 'abweichend' }, ean: '2112345001500' });
    expect(r.eanFoto.art).toBe('unsicher');
    expect(precheckOf(r, []).verdict).toBe('hold');
  });
  it('ohne gespeicherten Befund: ungültige Lesung weit weg von der gespeicherten → unsicher (die Konsole kann nicht nachlesen)', () => {
    expect(precheckOf(sauber({ eanFotoOcr: { ean: '40614648' } }), [])).toMatchObject({ verdict: 'hold', reasons: ['ean_unsicher'] });
    // nah dran (eine Ziffer) → kein Urteil
    expect(precheckOf(sauber({ eanFotoOcr: { ean: '4061464833828' } }), []).verdict).toBe('ok');
  });
  it('mit zwei Lesungen aufgehoben → ok, alter Befund sichtbar', () => {
    const r = sauber({ eanFotoOcr: { ean: GUELTIG, befund: 'gleich', grund: 'vorbefund_aufgehoben', bestaetigt: true, vorher: { befund: 'unsicher', ean: ANDERE, lauf: 'L' } } });
    expect(r.eanFoto).toMatchObject({ art: 'gleich', vorher: { befund: 'unsicher', ean: ANDERE } });
    expect(precheckOf(r, []).verdict).toBe('ok');
  });
});
