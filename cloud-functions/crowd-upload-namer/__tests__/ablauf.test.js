'use strict';

/**
 * Sperre, Nachlauf-Zeitplan und Felder je Ausgang (src/ablauf.js).
 * Firestore ist eine kleine Attrappe im Speicher (Transaktion = Lesen,
 * gesammelte Updates am Ende anwenden).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  WARTEZEITEN_MS, MAX_VERSUCH, SPERRE_MS, LAUF_SPERRE_MS,
  planNachFehlschlag, erstlaufUrteil, nachlaufUrteil, ausgangFelder,
  erstlaufBeginnen, erstlaufAbschliessen, nachlaufUebernehmen, nachlaufAbschliessen, nachlauf,
} = require('../src/ablauf');

const MIN = 60 * 1000;
const T0 = Date.parse('2026-09-26T10:00:00Z');
const LOESCHEN = Symbol('loeschen');
const ts = (ms) => ({ toMillis: () => ms, ms });
const werte = { stamp: () => 'STAMP', ts, loeschen: () => LOESCHEN };

const ANTWORT = { productName: 'Milsani Gouda jung', confidence: 0.9, priceCents: 199, manufacturer: 'DMK', priceImageKind: 'kassenbon', receiptZip: '40472', receiptCity: 'Düsseldorf' };
const GELESEN = { art: 'gelesen', parsed: ANTWORT, versuche: 1, gesendet: ['front', 'preis', 'hersteller'], defekt: [] };
const e429 = () => Object.assign(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'), { status: 429, versuche: 3 });
const FEHLER_429 = { art: 'fehler', fehler: e429(), versuche: 3, gesendet: ['front'], defekt: [] };

function fakeDb(docs) {
  const store = new Map(Object.entries(docs).map(([id, d]) => [id, { ...d }]));
  const anwenden = (id, felder) => {
    const d = store.get(id);
    for (const [k, v] of Object.entries(felder)) {
      if (v === LOESCHEN) delete d[k];
      else d[k] = v;
    }
  };
  return {
    store,
    ref: (id) => ({ id }),
    fehlerBeiTransaktion: false,
    async runTransaction(fn) {
      if (this.fehlerBeiTransaktion) throw new Error('UNAVAILABLE');
      const updates = [];
      const tx = {
        get: async (r) => ({ exists: store.has(r.id), data: () => (store.has(r.id) ? { ...store.get(r.id) } : undefined) }),
        update: (r, f) => updates.push([r.id, f]),
      };
      const res = await fn(tx);
      updates.forEach(([id, f]) => anwenden(id, f));
      return res;
    },
    collection: () => ({
      where: (feld, op, wert) => ({
        limit: (n) => ({
          get: async () => ({
            docs: [...store.entries()]
              .filter(([, d]) => d[feld] && d[feld].toMillis() <= wert.toMillis())
              .slice(0, n)
              .map(([id]) => ({ ref: { id } })),
          }),
        }),
      }),
    }),
  };
}

test('Zeitplan: 15 min → 1 h → 3 h → 8 h, danach Schluss', () => {
  assert.deepEqual(WARTEZEITEN_MS.map((m) => m / MIN), [15, 60, 180, 480]);
  assert.equal(MAX_VERSUCH, 5);
  assert.deepEqual([1, 2, 3, 4].map((v) => planNachFehlschlag(v, T0).abMs - T0), WARTEZEITEN_MS);
  assert.equal(planNachFehlschlag(5, T0), null);
});

test('Erstlauf-Sperre: jede junge fremde Sperre zählt (auch bei gleicher Event-ID), die eigene nicht', () => {
  const jung = { eventId: 'a', lauf: 'L1', at: ts(T0 - 4 * MIN) };
  assert.equal(erstlaufUrteil(null, T0), 'weg');
  assert.equal(erstlaufUrteil({ productNameOcrAt: 'x' }, T0), 'erledigt');
  // Zweite Zustellung derselben Nachricht = anderer Aufruf.
  assert.equal(erstlaufUrteil({ namerLauf: jung }, T0, 'L2'), 'laeuft');
  // Wiederholte Anmelde-Transaktion desselben Aufrufs.
  assert.equal(erstlaufUrteil({ namerLauf: jung }, T0, 'L1'), 'frei');
  assert.equal(erstlaufUrteil({ namerLauf: { ...jung, at: ts(T0 - LAUF_SPERRE_MS - 1) } }, T0, 'L2'), 'frei');
  assert.equal(erstlaufUrteil({}, T0, 'L2'), 'frei');
  // Nachlauf hat übernommen: auch eine späte Zustellung liest nicht mehr.
  assert.equal(erstlaufUrteil({ namerLauf: { ...jung, at: ts(T0 - 60 * MIN) }, namerNachlesenVersuch: 2 }, T0, 'L2'), 'nachlauf');
});

test('Nachlauf-Urteil', () => {
  const faellig = { namerNachlesenAb: ts(T0 - 1), productNameOcrAt: 'x', productNameOcrFehler: { grund: '429' }, namerNachlesenVersuch: 1 };
  assert.deepEqual(nachlaufUrteil(faellig, T0), { aktion: 'uebernehmen', versuch: 2 });
  assert.equal(nachlaufUrteil({ ...faellig, namerNachlesenAb: ts(T0 + 1) }, T0).aktion, 'nicht_faellig');
  assert.equal(nachlaufUrteil({ ...faellig, productNameOcr: 'Gouda' }, T0).aktion, 'erledigt');
  assert.equal(nachlaufUrteil({ ...faellig, productNameOcrFehler: undefined }, T0).aktion, 'erledigt');
  assert.equal(nachlaufUrteil({ ...faellig, namerNachlesenVersuch: 5 }, T0).aktion, 'erschoepft');
  // Entschiedene Fälle fasst der Nachlauf nicht an.
  assert.equal(nachlaufUrteil({ ...faellig, status: 'approved' }, T0).aktion, 'entschieden');
  assert.equal(nachlaufUrteil({ ...faellig, status: 'rejected' }, T0).aktion, 'entschieden');
  assert.equal(nachlaufUrteil({ ...faellig, status: 'pending' }, T0).aktion, 'uebernehmen');
  // Erstlauf abgestürzt (nur Sicherheitsnetz, kein Ergebnis) → übernehmen.
  assert.deepEqual(nachlaufUrteil({ namerNachlesenAb: ts(T0 - 1), namerLauf: {} }, T0), { aktion: 'uebernehmen', versuch: 2 });
});

test('Felder Erstlauf: Erfolg setzt Name, löscht das Sicherheitsnetz', () => {
  const { felder } = ausgangFelder(GELESEN, { versuch: 1, frisch: { status: 'pending', productName: null }, jetzt: T0, werte });
  assert.equal(felder.productNameOcr, 'Milsani Gouda jung');
  assert.equal(felder.productName, 'Milsani Gouda jung');
  assert.equal(felder.priceReceipt.zip, '40472');
  assert.equal(felder.namerNachlesenAb, LOESCHEN);
  assert.equal(felder.productNameOcrAt, 'STAMP');
  assert.equal('productNameOcrFehler' in felder, false);
  assert.equal('productNameOcrNachgelesenAt' in felder, false);
});

test('Felder Erstlauf: vorübergehender Fehler plant den Nachlauf und sichert den Erstfehler', () => {
  const { felder } = ausgangFelder(FEHLER_429, { versuch: 1, frisch: {}, jetzt: T0, werte });
  assert.equal(felder.productNameOcr, null);
  assert.equal(felder.productNameOcrFehler.voruebergehend, true);
  assert.equal(felder.productNameOcrFehler.versuche, 3);
  assert.deepEqual(felder.productNameOcrFehlerErst, felder.productNameOcrFehler);
  assert.equal(felder.namerNachlesenAb.toMillis(), T0 + 15 * MIN);
  assert.equal(felder.namerNachlesenVersuch, 1);
});

test('Felder Erstlauf: alle Fotos defekt → Vermerk bilder_defekt, kein Nachlauf', () => {
  const defekt = [{ slot: 'front', groesse: 1048576, grund: 'jpeg_ohne_bildende' }];
  const { felder } = ausgangFelder({ art: 'bilder_defekt', versuche: 0, gesendet: [], defekt }, { versuch: 1, frisch: {}, jetzt: T0, werte });
  assert.equal(felder.productNameOcrFehler.grund, 'bilder_defekt');
  assert.equal(felder.productNameOcrFehler.voruebergehend, false);
  assert.deepEqual(felder.productNameOcrBildDefekt, defekt);
  assert.equal(felder.namerNachlesenAb, LOESCHEN);
  assert.equal('productNameOcrFehlerErst' in felder, false);
});

test('Felder Erstlauf: endgültiger Dekodierfehler → kein Nachlauf', () => {
  const fehler = Object.assign(new Error('bild_nicht_dekodierbar: 400'), { voruebergehend: false });
  const { felder } = ausgangFelder({ art: 'fehler', fehler, versuche: 3, gesendet: ['front'], defekt: [] }, { versuch: 1, frisch: {}, jetzt: T0, werte });
  assert.equal(felder.namerNachlesenAb, LOESCHEN);
  assert.equal('namerNachlesenVersuch' in felder, false);
});

test('Felder Erstlauf: keine Namer-Fotos → wie bisher ohne Fehlervermerk', () => {
  const { felder } = ausgangFelder({ art: 'ohne_bild', versuche: 0, gesendet: [], defekt: [] }, { versuch: 1, frisch: {}, jetzt: T0, werte });
  assert.deepEqual(felder, { productNameOcrAt: 'STAMP', productNameOcr: null, namerNachlesenAb: LOESCHEN });
});

test('Felder: Hersteller nur, wenn das Herstellerfoto mitgelesen wurde', () => {
  const ersatz = { ...GELESEN, gesendet: ['front', 'preis', 'rueckseite'], defekt: [{ slot: 'hersteller', groesse: 1048576, grund: 'jpeg_ohne_bildende' }] };
  const { felder } = ausgangFelder(ersatz, { versuch: 1, frisch: { status: 'pending' }, jetzt: T0, werte });
  assert.equal(felder.manufacturerOcr, null);
  assert.equal(felder.productNameOcr, 'Milsani Gouda jung');
  assert.deepEqual(felder.productNameOcrBildDefekt, ersatz.defekt);
  assert.deepEqual(ausgangFelder(GELESEN, { versuch: 1, frisch: {}, jetzt: T0, werte }).felder.manufacturerOcr, { name: 'DMK', source: 'hersteller' });
});

test('Felder Nachlauf: Erfolg markiert, löscht Vermerk und Termin, Erstfehler bleibt', () => {
  const frisch = { status: 'pending', productName: '', productNameOcrAt: 'alt', productNameOcrFehler: {}, productNameOcrFehlerErst: {} };
  const { felder } = ausgangFelder(GELESEN, { versuch: 2, frisch, jetzt: T0, werte });
  assert.equal(felder.productNameOcrNachgelesenAt, 'STAMP');
  assert.equal(felder.productNameOcrFehler, LOESCHEN);
  assert.equal(felder.namerNachlesenAb, LOESCHEN);
  assert.equal('productNameOcrAt' in felder, false);
  assert.equal('productNameOcrFehlerErst' in felder, false);
  assert.equal(felder.productName, 'Milsani Gouda jung');
});

test('Felder Nachlauf: schon entschieden → kein nachträglicher productName; Nutzereingabe gewinnt', () => {
  const entschieden = ausgangFelder(GELESEN, { versuch: 2, frisch: { status: 'approved', productNameOcrAt: 'alt' }, jetzt: T0, werte }).felder;
  assert.equal('productName' in entschieden, false);
  assert.equal(entschieden.productNameOcr, 'Milsani Gouda jung');
  const nutzer = ausgangFelder(GELESEN, { versuch: 2, frisch: { status: 'pending', productName: 'Mein Käse' }, jetzt: T0, werte }).felder;
  assert.equal('productName' in nutzer, false);
});

test('ganzer Zeitplan: Erstlauf + 4 Nachläufe scheitern → 5 Leseversuche, dann Schluss', () => {
  let doc = { status: 'pending' };
  const anwenden = (f) => {
    doc = { ...doc };
    for (const [k, v] of Object.entries(f)) {
      if (v === LOESCHEN) delete doc[k];
      else doc[k] = v;
    }
  };
  let jetzt = T0;
  anwenden(ausgangFelder(FEHLER_429, { versuch: 1, frisch: doc, jetzt, werte }).felder);
  const termine = [doc.namerNachlesenAb.toMillis() - jetzt];
  let versuche = 1;
  for (;;) {
    jetzt = doc.namerNachlesenAb.toMillis();
    const u = nachlaufUrteil(doc, jetzt);
    if (u.aktion !== 'uebernehmen') break;
    versuche++;
    anwenden({ namerNachlesenVersuch: u.versuch, namerNachlesenAb: ts(jetzt + SPERRE_MS) });
    anwenden(ausgangFelder(FEHLER_429, { versuch: u.versuch, frisch: doc, jetzt, werte }).felder);
    if (!doc.namerNachlesenAb) break;
    termine.push(doc.namerNachlesenAb.toMillis() - jetzt);
  }
  assert.equal(versuche, 5);
  assert.deepEqual(termine, WARTEZEITEN_MS);
  assert.equal('namerNachlesenAb' in doc, false);
  assert.equal(doc.productNameOcrFehler.voruebergehend, true); // Vermerk bleibt für die Morgenrunde
});

test('Erstlauf-Sperre in der Transaktion: zweite Zustellung tut nichts; Firestore-Aussetzer liest trotzdem', async () => {
  const db = fakeDb({ a: { status: 'pending', images: {} } });
  const r1 = await erstlaufBeginnen({ db, ref: db.ref('a'), eventId: 'e1', jetzt: T0, werte });
  assert.equal(r1.urteil, 'frei');
  assert.equal(typeof r1.lauf, 'string');
  assert.equal(db.store.get('a').namerLauf.eventId, 'e1');
  assert.equal(db.store.get('a').namerLauf.lauf, r1.lauf);
  assert.equal(db.store.get('a').namerNachlesenAb.toMillis(), T0 + SPERRE_MS);
  // Doppelte Zustellung (gleiche Event-ID, neuer Aufruf) → nichts tun.
  const r2 = await erstlaufBeginnen({ db, ref: db.ref('a'), eventId: 'e1', jetzt: T0 + 4 * MIN, werte });
  assert.equal(r2.urteil, 'laeuft');
  // Wiederholte Transaktion desselben Aufrufs → läuft weiter.
  const r2b = await erstlaufBeginnen({ db, ref: db.ref('a'), eventId: 'e1', jetzt: T0, werte, lauf: r1.lauf });
  assert.equal(r2b.urteil, 'frei');
  db.fehlerBeiTransaktion = true;
  const r3 = await erstlaufBeginnen({ db, ref: db.ref('a'), eventId: 'e2', jetzt: T0, werte });
  assert.equal(r3.urteil, 'frei');
  assert.equal(r3.ohneSperre, true);
  assert.equal(r3.lauf, null);
});

test('Erstlauf schreibt nur mit eigenem Anspruch und gegen den frischen Stand', async () => {
  const db = fakeDb({ a: { status: 'pending', images: {} } });
  const { lauf } = await erstlaufBeginnen({ db, ref: db.ref('a'), eventId: 'e1', jetzt: T0, werte });
  // Inzwischen hat der Nutzer selbst einen Namen eingetragen → der gewinnt.
  db.store.get('a').productName = 'Mein Käse';
  const r = await erstlaufAbschliessen({ db, ref: db.ref('a'), lauf, ausgang: GELESEN, jetzt: T0, werte });
  assert.equal(r.status, 'geschrieben');
  assert.equal(db.store.get('a').productName, 'Mein Käse');
  assert.equal(db.store.get('a').productNameOcr, 'Milsani Gouda jung');
  assert.equal('namerNachlesenAb' in db.store.get('a'), false);

  // Fremder Aufruf hält die Sperre → nichts schreiben.
  const db2 = fakeDb({ b: { status: 'pending', namerLauf: { eventId: 'e1', lauf: 'ANDERER', at: ts(T0) } } });
  assert.equal((await erstlaufAbschliessen({ db: db2, ref: db2.ref('b'), lauf: 'MEINER', ausgang: FEHLER_429, jetzt: T0, werte })).status, 'fremd');
  assert.equal('productNameOcrAt' in db2.store.get('b'), false);

  // Nachlauf hat übernommen und schon gelesen → eine verspätete Zustellung überschreibt nichts.
  const db3 = fakeDb({ c: { status: 'pending', namerLauf: { lauf: 'MEINER', at: ts(T0) }, namerNachlesenVersuch: 2, productNameOcr: 'Gouda' } });
  assert.equal((await erstlaufAbschliessen({ db: db3, ref: db3.ref('c'), lauf: 'MEINER', ausgang: FEHLER_429, jetzt: T0, werte })).status, 'fremd');
  assert.equal(db3.store.get('c').productNameOcr, 'Gouda');
  assert.equal(db3.store.get('c').namerNachlesenVersuch, 2);

  // Ohne Sperre gelesen: schreibt, außer ein anderer Lauf war schneller.
  const db4 = fakeDb({ d: { status: 'pending' }, e: { status: 'pending', productNameOcrAt: 'x', productNameOcr: 'Gouda' } });
  assert.equal((await erstlaufAbschliessen({ db: db4, ref: db4.ref('d'), lauf: null, ausgang: GELESEN, jetzt: T0, werte })).status, 'geschrieben');
  assert.equal((await erstlaufAbschliessen({ db: db4, ref: db4.ref('e'), lauf: null, ausgang: FEHLER_429, jetzt: T0, werte })).status, 'schon_gelesen');
  assert.equal(db4.store.get('e').productNameOcr, 'Gouda');

  // Dokument gelöscht → kein Geisterdokument.
  assert.equal((await erstlaufAbschliessen({ db: db4, ref: db4.ref('weg'), lauf: null, ausgang: GELESEN, jetzt: T0, werte })).status, 'weg');
  assert.equal(db4.store.has('weg'), false);
});

test('Nachlauf übernimmt einen abgestürzten Erstlauf und vermerkt das für die Messung', async () => {
  const db = fakeDb({ a: { status: 'pending', namerLauf: { eventId: 'e1', at: ts(T0 - 30 * MIN) }, namerNachlesenAb: ts(T0 - 10 * MIN) } });
  const u = await nachlaufUebernehmen({ db, ref: db.ref('a'), jetzt: T0, werte });
  assert.equal(u.aktion, 'uebernehmen');
  assert.equal(u.versuch, 2);
  const d = db.store.get('a');
  assert.equal(d.namerNachlesenVersuch, 2);
  assert.equal(d.namerNachlesenAb.toMillis(), T0 + SPERRE_MS);
  assert.equal(d.productNameOcrFehlerErst.grund, 'erstlauf_abgebrochen');
});

test('Nachlauf: während des Lesens entschieden → nichts nachtragen, Termin räumen', async () => {
  const db = fakeDb({ a: { status: 'approved', productNameOcrAt: 'x', productNameOcrFehler: {}, namerNachlesenVersuch: 2, namerNachlesenAb: ts(T0) } });
  const r = await nachlaufAbschliessen({ db, ref: db.ref('a'), versuch: 2, ausgang: GELESEN, jetzt: T0, werte });
  assert.equal(r.status, 'entschieden');
  const d = db.store.get('a');
  assert.equal(d.productNameOcr, undefined);
  assert.equal(d.priceOcr, undefined);
  assert.equal('namerNachlesenAb' in d, false);
});

test('Abschließen nur mit eigenem Anspruch', async () => {
  const db = fakeDb({ a: { status: 'pending', productNameOcrAt: 'x', productNameOcrFehler: {}, namerNachlesenVersuch: 3 } });
  assert.equal((await nachlaufAbschliessen({ db, ref: db.ref('a'), versuch: 2, ausgang: GELESEN, jetzt: T0, werte })).status, 'fremd');
  assert.equal(db.store.get('a').productNameOcr, undefined);
  const r = await nachlaufAbschliessen({ db, ref: db.ref('a'), versuch: 3, ausgang: GELESEN, jetzt: T0, werte });
  assert.equal(r.status, 'geschrieben');
  assert.equal(db.store.get('a').productNameOcr, 'Milsani Gouda jung');
  assert.equal('productNameOcrFehler' in db.store.get('a'), false);
});

function faelligerFall(extra = {}) {
  return { status: 'pending', images: { front: 'f' }, productNameOcrAt: 'x', productNameOcrFehler: { grund: '429' }, namerNachlesenVersuch: 1, namerNachlesenAb: ts(T0 - MIN), ...extra };
}
const ohneSchlaf = async () => {};

test('Nachlauf-Durchgang: liest fällige, räumt erledigte/erschöpfte, lässt künftige in Ruhe', async () => {
  const db = fakeDb({
    faellig: faelligerFall(),
    schonGelesen: faelligerFall({ productNameOcr: 'Gouda' }),
    erschoepft: faelligerFall({ namerNachlesenVersuch: 5 }),
    entschieden: faelligerFall({ status: 'approved' }),
    spaeter: faelligerFall({ namerNachlesenAb: ts(T0 + MIN) }),
    fertig: { status: 'pending', productNameOcrAt: 'x', productNameOcr: 'Käse' },
  });
  const gelesen = [];
  const bericht = await nachlauf({
    db, werte, jetzt: () => T0, schlafen: ohneSchlaf, zufall: () => 0,
    lesen: async (daten, { id }) => { gelesen.push(id); return GELESEN; },
  });
  assert.deepEqual(gelesen, ['faellig']);
  assert.deepEqual({ ...bericht }, { gefunden: 4, gelesen: 1, fehlgeschlagen: 0, verworfen: 0, uebersprungen: 3, fehlerIntern: 0, abbruch: null });
  assert.equal(db.store.get('faellig').productNameOcr, 'Milsani Gouda jung');
  assert.equal(db.store.get('faellig').productNameOcrNachgelesenAt, 'STAMP');
  assert.equal('namerNachlesenAb' in db.store.get('faellig'), false);
  assert.equal('namerNachlesenAb' in db.store.get('schonGelesen'), false);
  assert.equal('namerNachlesenAb' in db.store.get('erschoepft'), false);
  assert.equal('namerNachlesenAb' in db.store.get('entschieden'), false);
  assert.equal(db.store.get('entschieden').productNameOcr, undefined);
  assert.equal(db.store.get('spaeter').namerNachlesenAb.toMillis(), T0 + MIN);
});

test('Nachlauf-Durchgang: gescheiterter Versuch wird nach Plan neu terminiert', async () => {
  const db = fakeDb({ a: faelligerFall() });
  const bericht = await nachlauf({ db, werte, jetzt: () => T0, schlafen: ohneSchlaf, lesen: async () => FEHLER_429 });
  assert.equal(bericht.fehlgeschlagen, 1);
  const d = db.store.get('a');
  assert.equal(d.namerNachlesenVersuch, 2);
  assert.equal(d.namerNachlesenAb.toMillis(), T0 + 60 * MIN);
  assert.equal('productNameOcrFehlerErst' in d, false);
});

test('Nachlauf-Durchgang: nach 3 × 429 in Folge nichts Neues mehr', async () => {
  const docs = {};
  for (let i = 0; i < 5; i++) docs[`d${i}`] = faelligerFall();
  const db = fakeDb(docs);
  const bericht = await nachlauf({
    db, werte, jetzt: () => T0, schlafen: ohneSchlaf, parallel: 1,
    lesen: async (daten, { beobachter }) => {
      for (let v = 0; v < 3; v++) beobachter({ ok: false, fehler: e429() });
      return FEHLER_429;
    },
  });
  assert.equal(bericht.abbruch, 'mengenlimit');
  assert.equal(bericht.fehlgeschlagen, 1);
  // Die übrigen bleiben fällig für den nächsten Takt.
  assert.equal([...db.store.values()].filter((d) => d.namerNachlesenAb.toMillis() <= T0).length, 4);
});

test('Nachlauf-Durchgang: ein Erfolg zwischendurch setzt den 429-Zähler zurück', async () => {
  const docs = {};
  for (let i = 0; i < 3; i++) docs[`d${i}`] = faelligerFall();
  const db = fakeDb(docs);
  let n = 0;
  const bericht = await nachlauf({
    db, werte, jetzt: () => T0, schlafen: ohneSchlaf, parallel: 1,
    lesen: async (daten, { beobachter }) => {
      n++;
      beobachter({ ok: false, fehler: e429() });
      beobachter({ ok: false, fehler: e429() });
      beobachter({ ok: true });
      return GELESEN;
    },
  });
  assert.equal(n, 3);
  assert.equal(bericht.abbruch, null);
});

test('Nachlauf-Durchgang: nach der Startgrenze nichts Neues mehr', async () => {
  const docs = {};
  for (let i = 0; i < 3; i++) docs[`d${i}`] = faelligerFall();
  const db = fakeDb(docs);
  let uhr = T0;
  const bericht = await nachlauf({
    db, werte, jetzt: () => uhr, schlafen: ohneSchlaf, parallel: 1, neueBisMs: 4 * MIN,
    lesen: async () => { uhr += 3 * MIN; return GELESEN; },
  });
  assert.equal(bericht.gelesen, 2);
  assert.equal(bericht.abbruch, 'zeit');
});

test('Nachlauf-Durchgang: Fehler an einem Dokument hält die anderen nicht auf', async () => {
  const db = fakeDb({ a: faelligerFall(), b: faelligerFall() });
  const bericht = await nachlauf({
    db, werte, jetzt: () => T0, schlafen: ohneSchlaf, parallel: 1,
    lesen: async (daten, { id }) => { if (id === 'a') throw new Error('kaputt'); return GELESEN; },
  });
  assert.equal(bericht.fehlerIntern, 1);
  assert.equal(bericht.gelesen, 1);
  // Der Versuch ist gezählt, die Sperre verfällt von selbst.
  assert.equal(db.store.get('a').namerNachlesenVersuch, 2);
  assert.equal(db.store.get('a').namerNachlesenAb.toMillis(), T0 + SPERRE_MS);
});
