// Lieferanschriften aus Online-Bestellungen entfernen (Entscheidung Patrick
// 04.10.2026: „Lieferanschriften von Online-Bestellungen nicht mehr als Filiale
// speichern"). Bis Prompt v1.4 landete bei Online-Rechnungen die Liefer- bzw.
// Rechnungsanschrift des KUNDEN als „Filialadresse" am Bon — bei
// bon_mtu6wj0anmcck4 mit Vor- und Nachnamen. Von dort wanderte sie in
// receipts.store, den Spiegel, purchased_products und users.region.
//
// Standard ist ein TROCKENLAUF: liest, schreibt nichts. Ausgabe nur „Feld
// belegt / Länge" — NIE einen Wert (keine Anschrift im Log).
//
//   node .bereinige-lieferanschrift-0410.js                 Trockenlauf für IDS
//   IDS=a,b node .bereinige-lieferanschrift-0410.js         andere Bons
//   SCHREIBEN=1 node .bereinige-lieferanschrift-0410.js     wirklich bereinigen (nur nach OK von Patrick)
//   node .bereinige-lieferanschrift-0410.js --suche         weitere Kandidaten auflisten (nur IDs/Anzahl)
//
// Je Ziel-Bon wird die GANZE Menge bereinigt: der Bon selbst und jeder weitere
// Bon DERSELBEN Person mit derselben Anschrift (store.street + store.zip oder
// ocr.parsed.storeAddress) — Prüfrunde 04.10.: zu bon_mtu6wj0anmcck4 gehörten
// drei weitere dm-Online-Rechnungen derselben Minute mit derselben
// Wohnanschrift, dazu 10 Positionen und users.region. Steht dieselbe Anschrift
// auch bei ANDEREN Personen, ist es eher eine Firmen- als eine Wohnanschrift:
// dann wird nichts geschrieben, außer mit GETEILT_OK=1 (vorher ansehen).
//
// Was bereinigt wird, je Bon der Menge:
//   receipts/{id}                 ocr.parsed.merchantSubtitle, ocr.parsed.storeAddress → null,
//                                 store → null; dazu JEDES weitere Textfeld im Dokument, das die
//                                 Zusatzzeile wortgleich enthält (z. B. ein Zwischenstand)
//   users/{uid}/cashback_status   storeCity, storeZip → null
//   users/{uid}/purchased_products (receiptId == id)  storeStreet, storeZip, storeCity → null
//   users/{uid}.region            wenn region.receiptId in der Menge liegt → gelöscht
// Nach dem Schreiben wird die ganze Menge nachgelesen und dasselbe Raster
// noch einmal geprüft.
//
// Was dieses Skript NICHT erreicht (an Patrick melden, nichts ohne sein OK):
//   - Backups und Point-in-Time-Recovery enthalten die Anschrift bis zu ihrem
//     Ablauf.
//   - BigQuery: `users` wird von zwei Extensions exportiert
//     (ext-firestore-bigquery-export → users_firestore_export.users_raw_changelog,
//     ext-firestore-users → Datensatz analytics). Das Löschen von users.region
//     fügt dort nur eine neue Changelog-Zeile hinzu; die alten Zeilen mit PLZ
//     und Ort der Lieferanschrift bleiben (geprüft 04.10. für
//     region.receiptId = bon_mtu6wj0anmcck4, bon_mufriw81t4szhp,
//     bon_mu3skdaujbkd2p). Entfernen ginge nur per DML in beiden Datensätzen
//     (z. B. JSON_REMOVE auf data.region für genau diese receiptIds) — eigene
//     Entscheidung, nicht Teil dieses Skripts.
'use strict';

const admin = require('firebase-admin');
const { onlineStichwort } = require('./lib/belegart');

if (!admin.apps.length) admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const SCHREIBEN = process.env.SCHREIBEN === '1';
const GETEILT_OK = process.env.GETEILT_OK === '1';
const SUCHE = process.argv.includes('--suche');
const IDS = String(process.env.IDS || 'bon_mtu6wj0anmcck4').split(',').map((s) => s.trim()).filter(Boolean);

// Lieferdienste und Online-Händler, die (noch) keiner unserer Märkte sind.
const LIEFERDIENST_RE = /picnic|knuspr|amazon|flink|getir|wolt|bringmeister|lieferando|mytime|shop.?apotheke/i;

const laenge = (v) => (v == null ? 0 : typeof v === 'string' ? v.length : JSON.stringify(v).length);
const belegt = (v) => (v == null ? 'leer' : `belegt (${laenge(v)} Zeichen)`);

/** Alle Pfade eines Objekts, deren Text die Zusatzzeile enthält (ohne Werte). */
function pfadeMit(obj, nadel, pfad = '', out = []) {
  if (!nadel || nadel.length < 8 || obj == null) return out;
  if (typeof obj === 'string') {
    if (obj.includes(nadel)) out.push(pfad);
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => pfadeMit(v, nadel, `${pfad}[${i}]`, out));
    return out;
  }
  if (typeof obj === 'object' && typeof obj.toMillis !== 'function') {
    for (const [k, v] of Object.entries(obj)) pfadeMit(v, nadel, pfad ? `${pfad}.${k}` : k, out);
  }
  return out;
}

/**
 * Stand eines Bons. `nadelVorher` = die Zusatzzeile aus dem Stand VOR dem
 * Schreiben: danach ist ocr.parsed.merchantSubtitle null, und ohne sie fände
 * die Nachkontrolle Restkopien nie (Prüfrunde 3).
 */
async function bestand(id, nadelVorher = null) {
  const ref = db.doc(`receipts/${id}`);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const d = snap.data();
  const uid = d.userId;
  const parsed = (d.ocr && d.ocr.parsed) || {};
  const nadel = nadelVorher || (typeof parsed.merchantSubtitle === 'string' ? parsed.merchantSubtitle : null);
  const [spiegel, positionen, user] = await Promise.all([
    uid ? db.doc(`users/${uid}/cashback_status/${id}`).get() : null,
    uid ? db.collection(`users/${uid}/purchased_products`).where('receiptId', '==', id).get() : null,
    uid ? db.doc(`users/${uid}`).get() : null,
  ]);
  const zusaetzlich = pfadeMit(d, nadel).filter((p) => p !== 'ocr.parsed.merchantSubtitle');
  return { ref, d, uid, parsed, nadel, spiegel, positionen, user, zusaetzlich };
}

/** Vergleichsschlüssel einer Anschrift (nie ausgegeben): Straße + PLZ, normalisiert. */
function anschriftSchluessel(street, zip) {
  const st = String(street ?? '').toLowerCase().replace(/str(\.|a(ss|ß)e)/g, 'str').replace(/[^a-z0-9äöüß]/g, '');
  const z = String(zip ?? '').replace(/\D/g, '');
  return st && z ? `${st}|${z}` : null;
}
function anschriftenVon(d) {
  const p = (d.ocr && d.ocr.parsed) || {};
  const out = new Set();
  const a = d.store ? anschriftSchluessel(d.store.street, d.store.zip) : null;
  const b = p.storeAddress ? anschriftSchluessel(p.storeAddress.street, p.storeAddress.zip) : null;
  if (a) out.add(a);
  if (b) out.add(b);
  return out;
}

/**
 * Die Menge zu einem Ziel-Bon: er selbst + Bons derselben Person mit derselben
 * Anschrift. Dazu, wie viele ANDERE Personen dieselbe Anschrift tragen.
 */
async function mengeZu(id) {
  const snap = await db.doc(`receipts/${id}`).get();
  if (!snap.exists) return null;
  const d = snap.data();
  const uid = d.userId;
  const ziel = anschriftenVon(d);
  const ids = [id];
  let andereNutzer = 0;
  if (uid && ziel.size) {
    const eigene = await db.collection('receipts').where('userId', '==', uid)
      .select('store', 'ocr.parsed.storeAddress').get();
    for (const doc of eigene.docs) {
      if (doc.id === id) continue;
      const a = anschriftenVon(doc.data());
      if ([...a].some((k) => ziel.has(k))) ids.push(doc.id);
    }
    // Andere Personen mit derselben Anschrift (je PLZ eine Abfrage).
    const plz = new Set([...ziel].map((k) => k.split('|')[1]));
    const fremd = new Set();
    for (const zip of plz) {
      const q = await db.collection('receipts').where('store.zip', '==', zip).select('userId', 'store').get();
      for (const doc of q.docs) {
        const x = doc.data();
        if (!x.userId || x.userId === uid) continue;
        if (ziel.has(anschriftSchluessel(x.store && x.store.street, x.store && x.store.zip))) fremd.add(x.userId);
      }
    }
    andereNutzer = fremd.size;
  }
  return { uid, ids, andereNutzer };
}

function bericht(id, b) {
  const s = b.spiegel && b.spiegel.exists ? b.spiegel.data() : {};
  const posMitAdresse = b.positionen ? b.positionen.docs.filter((p) => p.get('storeStreet') || p.get('storeZip') || p.get('storeCity')).length : 0;
  const region = b.user && b.user.exists ? b.user.get('region') : null;
  console.log(JSON.stringify({
    id,
    status: b.d.status || null,
    belegart: b.parsed.belegart ?? null,
    onlineStichwort: onlineStichwort(b.parsed),
    'ocr.parsed.merchantSubtitle': belegt(b.parsed.merchantSubtitle),
    'ocr.parsed.storeAddress': belegt(b.parsed.storeAddress),
    store: belegt(b.d.store),
    weitereFelderMitZusatzzeile: b.zusaetzlich,
    'spiegel.storeCity': belegt(s.storeCity),
    'spiegel.storeZip': belegt(s.storeZip),
    positionen: b.positionen ? b.positionen.size : 0,
    positionenMitAdresse: posMitAdresse,
    regionZeigtAufDiesenBon: Boolean(region && region.receiptId === id),
  }));
  return posMitAdresse;
}

/** Ist an diesem Bon nach dem Bereinigen noch etwas belegt? */
function nochBelegt(b, rest) {
  return Boolean(b.parsed.merchantSubtitle || b.parsed.storeAddress || b.d.store || rest > 0 || b.zusaetzlich.length);
}

async function bereinigen(id, b, mengeIds) {
  const update = {
    'ocr.parsed.merchantSubtitle': null,
    'ocr.parsed.storeAddress': null,
    store: null,
    bereinigtLieferanschrift: { at: FieldValue.serverTimestamp(), grund: 'online_bestellung_lieferanschrift', quelle: 'Entscheidung Patrick 04.10.2026' },
  };
  // Weitere Kopien der Zusatzzeile (nur einfache Pfade ohne Listen-Index;
  // Listen-Einträge würden das Ersetzen der ganzen Liste verlangen).
  const mitListe = [];
  for (const p of b.zusaetzlich) {
    if (p.includes('[')) mitListe.push(p);
    else update[p] = null;
  }
  if (mitListe.length) {
    // Bleibt nach dem Lauf stehen → der Lauf darf nicht grün enden.
    console.error(JSON.stringify({ id, warnung: 'Zusatzzeile steckt in Listen — von Hand prüfen', pfade: mitListe }));
    process.exitCode = 1;
  }
  await b.ref.update(update);
  if (b.spiegel && b.spiegel.exists) await b.spiegel.ref.set({ storeCity: null, storeZip: null }, { merge: true });
  if (b.positionen) {
    const batch = db.batch();
    b.positionen.docs.forEach((p) => batch.set(p.ref, { storeStreet: null, storeZip: null, storeCity: null }, { merge: true }));
    if (b.positionen.size) await batch.commit();
  }
  const region = b.user && b.user.exists ? b.user.get('region') : null;
  if (region && mengeIds.includes(region.receiptId)) await b.user.ref.update({ region: FieldValue.delete() });
}

async function suche() {
  // Nur lesen; Felder per select, damit nicht ganze Bons übertragen werden.
  const snap = await db.collection('receipts')
    .select('status', 'userId', 'bonTime', 'merchant.raw', 'merchant.id', 'ocr.parsed.merchant', 'ocr.parsed.merchantSubtitle', 'ocr.parsed.belegart', 'store')
    .get();
  const nutzerJeAnschrift = new Map();
  for (const doc of snap.docs) {
    const d = doc.data();
    const k = d.store ? anschriftSchluessel(d.store.street, d.store.zip) : null;
    if (!k || !d.userId) continue;
    if (!nutzerJeAnschrift.has(k)) nutzerJeAnschrift.set(k, new Set());
    nutzerJeAnschrift.get(k).add(d.userId);
  }
  const treffer = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    const parsed = { merchant: d.ocr?.parsed?.merchant ?? d.merchant?.raw ?? null, merchantSubtitle: d.ocr?.parsed?.merchantSubtitle ?? null, belegart: d.ocr?.parsed?.belegart ?? null, bonTime: d.bonTime ?? null };
    // Vier Signale: Belegart (ab v1.5), Stichwort im Kopf, ein Lieferdienst
    // als Händler bei unbekanntem Markt (Picnic/Knuspr … — kein unserer Märkte,
    // aber die Anschrift im Kopf ist die des Kunden; Prüfrunde 04.10.:
    // bon_mu3skdaujbkd2p fehlte sonst) und — nur als Verdacht — Drogerie-Bon
    // ohne Uhrzeit mit Filiale.
    const roh = `${d.merchant?.raw ?? ''} ${d.ocr?.parsed?.merchant ?? ''}`;
    const art = parsed.belegart === 'online_bestellung' ? 'belegart'
      : onlineStichwort(parsed) ? 'stichwort'
        : (!d.merchant?.id || d.merchant.id === 'unknown') && d.store && LIEFERDIENST_RE.test(roh) ? 'lieferdienst'
          : ['dm', 'rossmann', 'mueller'].includes(d.merchant?.id) && !d.bonTime && d.store ? 'verdacht_drogerie_ohne_uhrzeit'
            : null;
    if (!art) continue;
    const k = d.store ? anschriftSchluessel(d.store.street, d.store.zip) : null;
    treffer.push({
      id: doc.id, art, status: d.status || null, markt: d.merchant?.id || null,
      storeBelegt: Boolean(d.store), zusatzzeileBelegt: Boolean(parsed.merchantSubtitle),
      // Wie viele Personen tragen dieselbe Anschrift? > 1 = eher Firmenanschrift, vor dem Bereinigen ansehen.
      anschriftNutzer: k && nutzerJeAnschrift.has(k) ? nutzerJeAnschrift.get(k).size : 0,
    });
  }
  console.log(JSON.stringify({ geprueft: snap.size, kandidaten: treffer.length, mitFiliale: treffer.filter((t) => t.storeBelegt).length }));
  for (const t of treffer) console.log(JSON.stringify(t));
}

(async () => {
  if (SUCHE) return suche();
  console.log(JSON.stringify({ modus: SCHREIBEN ? 'SCHREIBEN' : 'TROCKENLAUF', ids: IDS.length }));
  for (const id of IDS) {
    const menge = await mengeZu(id);
    if (!menge) { console.log(JSON.stringify({ id, fehlt: true })); continue; }
    // Nur Anzahl und IDs — keine Anschrift.
    console.log(JSON.stringify({ ziel: id, menge: menge.ids, gleicheAnschriftBeiAnderenNutzern: menge.andereNutzer }));
    const bestaende = [];
    for (const mid of menge.ids) {
      const b = await bestand(mid);
      if (!b) continue;
      bericht(mid, b);
      bestaende.push([mid, b]);
    }
    if (!SCHREIBEN) continue;
    if (menge.andereNutzer > 0 && !GETEILT_OK) {
      console.error(JSON.stringify({ ziel: id, uebersprungen: 'Anschrift auch bei anderen Personen — eher Firmenanschrift; ansehen, dann GETEILT_OK=1' }));
      process.exitCode = 1;
      continue;
    }
    for (const [mid, b] of bestaende) await bereinigen(mid, b, menge.ids);
    console.log('NACHGELESEN');
    const nadelVon = new Map(bestaende.map(([mid, b]) => [mid, b.nadel]));
    for (const mid of menge.ids) {
      const nach = await bestand(mid, nadelVon.get(mid) || null);
      if (!nach) continue;
      const rest = bericht(mid, nach);
      const region = nach.user && nach.user.exists ? nach.user.get('region') : null;
      if (nochBelegt(nach, rest) || (region && menge.ids.includes(region.receiptId))) {
        console.error(JSON.stringify({ id: mid, fehler: 'nach dem Bereinigen noch belegt' }));
        process.exitCode = 1;
      }
    }
  }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
