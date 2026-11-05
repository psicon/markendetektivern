'use strict';
/**
 * Live-Schatten gegen den ECHTEN Firestore-Emulator (Aufruf: __emu__/jest.config.js).
 * Echt sind hier Firestore (Transaktionen, createTime, Abfragen, Zeitstempel)
 * und damit der Übergang „Namer fertig“, die Übernahme bei doppelter
 * Zustellung und der Nachweis, dass am Bestand nichts geschrieben wird
 * (updateTime). Gemockt sind nur Storage, das Modell und der Strichcode-Leser —
 * kein Aufruf verlässt die Maschine.
 */
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Nur gegen den Firestore-Emulator (FIRESTORE_EMULATOR_HOST fehlt) — siehe __emu__/jest.config.js');
if (!String(process.env.GCLOUD_PROJECT || '').startsWith('demo-')) throw new Error('Nur mit einem demo-Projekt (GCLOUD_PROJECT)');

const mockLage = { audit: 0 };
const mockListe = new Map();
jest.mock('firebase-admin', () => {
  const echt = jest.requireActual('firebase-admin');
  const storage = () => ({
    bucket: () => ({
      getFiles: async () => [[...mockListe.entries()].map(([name, m]) => ({ name, md5Hash: m.md5, size: String(m.size) })), null],
      file: (p) => ({
        getMetadata: async () => { const m = mockListe.get(p); if (!m) throw new Error('No such object'); return [{ md5Hash: m.md5, size: String(m.size) }]; },
        download: async (opts) => (opts ? [require('../__tests__/helpers/bildKopfDaten').jpeg(3000, 4000)] : [Buffer.from(p)]),
      }),
    }),
  });
  return new Proxy(echt, { get: (t, k) => (k === 'storage' ? storage : t[k]) });
});
jest.mock('firebase-functions/logger', () => ({ info: () => {}, warn: () => {}, error: () => {} }));
jest.mock('@google/genai', () => ({
  GoogleGenAI: function GoogleGenAI() {
    return {
      models: {
        generateContent: async ({ contents }) => {
          const parts = contents[0].parts;
          const text = parts.map((p) => p.text || '').join('\n');
          if (!text.includes('Du prüfst eine Produkt-Einreichung')) throw new Error('unerwarteter Aufruf');
          mockLage.audit++;
          // Etwas Laufzeit, damit sich zwei gleichzeitige Zustellungen wirklich überlappen.
          await new Promise((r) => setTimeout(r, 300));
          const eanPfad = parts.filter((p) => p.fileData).map((p) => p.fileData.fileUri).find((u) => u.includes('/ean'));
          return { text: JSON.stringify({ echt: true, loseWare: false, traegtAngaben: true, gleicheAnsicht: false, preisSichtbar: true, eanFoto: eanPfad.split('/')[6], grund: 'ok' }) };
        },
      },
    };
  },
}));
jest.mock('../src/strichcode', () => ({ ...jest.requireActual('../src/strichcode'), liesBild: async () => ({ gelesen: [] }) }));

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { GoogleGenAI } = require('@google/genai');
const ls = require('../src/liveSchatten');
const { SCHATTEN_COL } = require('../src/liveSchattenBericht');

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const EAN = '4061464833821';
const SLOTS = ['front', 'rueckseite', 'hersteller', 'ean', 'naehrwerte', 'zutaten', 'preis'];
const werte = { stamp: () => FieldValue.serverTimestamp() };
const ALT = Date.now() - 90 * 24 * 60 * 60 * 1000;
const lauf = (id, extra = {}) => ls.schattenFall({ db, id, projekt: 'demo', bucketName: 'b', ai: new GoogleGenAI(), kontoErstellt: async () => ALT, werte, ...extra });

async function leeren() {
  for (const c of await db.listCollections()) await db.recursiveDelete(c);
  mockListe.clear();
  mockLage.audit = 0;
}
/** Wie die App (productSubmit.ts): Dokument mit Server-Zeitpunkt, danach schreibt der Namer. */
async function einreichen(id, { uid = 'u1', ean = EAN } = {}) {
  const images = Object.fromEntries(SLOTS.map((s) => [s, `crowduploads/${uid}/${id}/${s === 'ean' ? ean : s}/${s}.jpg`]));
  for (const s of SLOTS) mockListe.set(images[s], { md5: `md5_${id}_${s}`, size: 200000 + s.length });
  await db.doc(`crowd_uploads/${id}`).set({ userId: uid, ean, status: 'pending', marketId: 'rewe', marketName: 'rewe', images, productName: null, createdAt: FieldValue.serverTimestamp() });
}
/** Namer: Anspruch (namerNachlesenAb gesetzt), dann Ergebnis (productNameOcrAt, Anspruch gelöscht) — wie crowd-upload-namer src/ablauf.js. */
async function namer(id) {
  const ref = db.doc(`crowd_uploads/${id}`);
  const v0 = (await ref.get()).data();
  await ref.update({ namerLauf: { lauf: 'x', at: admin.firestore.Timestamp.now() }, namerNachlesenAb: admin.firestore.Timestamp.fromMillis(Date.now() + 20 * 60 * 1000) });
  const v1 = (await ref.get()).data();
  await ref.update({ productNameOcr: `Produkt ${id}`, productNameOcrAt: FieldValue.serverTimestamp(), priceOcr: { priceCents: 129 }, manufacturerOcr: { name: 'Hersteller GmbH' }, namerNachlesenAb: FieldValue.delete() });
  const v2 = (await ref.get()).data();
  return [v0, v1, v2];
}
const einstellenIn = (liste) => async (daten, name) => {
  if (liste.some((e) => e.name === name)) { const e = new Error('exists'); e.code = 'functions/task-already-exists'; throw e; }
  liste.push({ daten, name });
};

beforeEach(async () => {
  await leeren();
  await db.doc('cashback_config/v1').set({ fotoWorker: true, zweifelFreigabe: false, fotoLive: 'shadow', fotoLiveAnteil: 1 });
});
afterAll(async () => { await leeren(); await admin.app().delete(); });

describe('Live-Schatten im Firestore-Emulator', () => {
  it('Trigger: genau beim Übergang „Namer fertig“ ein Auftrag, bei jedem anderen Update keiner', async () => {
    await einreichen('a');
    const [v0, v1, v2] = await namer('a');
    const auftraege = [];
    const fall = (vorher, nachher) => ls.ausloeserFall({ db, id: 'a', vorher, nachher, einstellen: einstellenIn(auftraege) });
    expect(await fall(v0, v1)).toBe('kein_uebergang'); // Namer hat gerade angefangen
    expect(await fall(v1, v2)).toBe('eingestellt'); // Namer fertig
    expect(await fall(v1, v2)).toBe('schon_eingestellt'); // doppelte Zustellung
    await db.doc('crowd_uploads/a').update({ probableLocation: { quelle: 'kassenbon' } });
    const v3 = (await db.doc('crowd_uploads/a').get()).data();
    expect(await fall(v2, v3)).toBe('kein_uebergang'); // spätere Updates
    expect(auftraege).toEqual([{ daten: { id: 'a' }, name: ls.auftragsName('a') }]);
    await db.doc('cashback_config/v1').set({ fotoLive: false }, { merge: true });
    expect(await ls.ausloeserFall({ db, id: 'b', vorher: v1, nachher: v2, einstellen: einstellenIn(auftraege) })).toBe('aus');
  });

  it('Arbeiter: rechnet mit der Morgenrunde, schreibt NUR crowd_live_schatten — die Einreichung bleibt Byte für Byte (updateTime) gleich', async () => {
    await einreichen('a');
    await einreichen('b', { uid: 'u2', ean: '4000417025005' });
    await namer('a');
    await namer('b');
    const vorher = await db.doc('crowd_uploads/a').get();
    const vorherB = await db.doc('crowd_uploads/b').get();
    expect(await lauf('a')).toEqual({ status: 'fertig', ergebnis: 'freigeben' });
    const nachher = await db.doc('crowd_uploads/a').get();
    expect(nachher.updateTime.isEqual(vorher.updateTime)).toBe(true);
    expect(nachher.data()).toEqual(vorher.data());
    expect((await db.doc('crowd_uploads/b').get()).updateTime.isEqual(vorherB.updateTime)).toBe(true);
    // Keine neue Sammlung außer der eigenen (kein Bericht, keine Buchung, kein Push).
    expect((await db.listCollections()).map((c) => c.id).sort()).toEqual(['cashback_config', 'crowd_live_schatten', 'crowd_uploads']);
    expect((await db.collection(SCHATTEN_COL).get()).docs.map((d) => d.id)).toEqual(['a']);
    const s = (await db.doc(`${SCHATTEN_COL}/a`).get()).data();
    expect(s).toMatchObject({ status: 'fertig', ergebnis: 'freigeben', modus: 'shadow', wuerdeLive: true, modellAufrufe: 1, regelVersion: expect.stringMatching(/^[0-9a-f]{10}$/) });
    // Ab Upload (Server-Zeitpunkt des Dokuments, createTime) gemessen.
    expect(s.uploadMs).toBe(vorher.createTime.toMillis());
    expect(s.gesamtMs).toBe(s.fertigMs - s.uploadMs);
    expect(s.fertigAt).toBeInstanceOf(admin.firestore.Timestamp);
    expect(mockLage.audit).toBe(1);
  });

  it('doppelte Zustellung gleichzeitig: genau ein Lauf rechnet', async () => {
    await einreichen('a');
    await namer('a');
    const r = await Promise.all([lauf('a'), lauf('a')]);
    // Genau einer rechnet; der andere sieht ihn laufen oder (wartete die Transaktion auf die Sperre) schon fertig.
    expect(r.filter((x) => x.ergebnis === 'freigeben').length).toBe(1);
    expect(r.filter((x) => !x.ergebnis).map((x) => x.status)).toEqual([expect.stringMatching(/^(laeuft|fertig)$/)]);
    expect(mockLage.audit).toBe(1);
    expect(await lauf('a')).toEqual({ status: 'fertig' });
    expect(mockLage.audit).toBe(1);
  });

  it('Betrugsschutz mit echter Abfrage je Person: über 20 in 24 h → Morgenrunde, kein Modellaufruf', async () => {
    for (let i = 0; i < 21; i++) await einreichen(`v${String(i).padStart(2, '0')}`, { ean: `40000000000${String(i).padStart(2, '0')}` });
    await einreichen('a');
    await namer('a');
    expect(await ls.einreichungen24h(db, 'u1', Date.now() + 1000)).toBe(22);
    expect(await lauf('a')).toEqual({ status: 'fertig', ergebnis: 'betrugsschutz' });
    expect((await db.doc(`${SCHATTEN_COL}/a`).get()).data()).toMatchObject({ grund: 'vielreicher', wuerdeMorgenrunde: 'betrugsschutz' });
    expect(mockLage.audit).toBe(0);
  });
});
