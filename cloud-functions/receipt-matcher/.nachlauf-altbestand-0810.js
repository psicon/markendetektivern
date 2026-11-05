'use strict';

/**
 * Einmal-Skript: Altbestand der Bon-Artikel-Zuordnung in den Nachlauf planen
 * (Prüfbefund 08.10.2026).
 *
 * Problem: Der Nachlauf (nachlauf.js, geplante Funktion matchNachlauf) holt nur
 * Zeilen nach, für die der NEUE Matcher einen Eintrag anlegt. Der alte Matcher
 * schrieb in der Störung ab 01.10. jeden Pick-Fehler, auch jeden Zeitabbruch,
 * als 'pick-failed' (ohne `pickAttempts`). Diese Zeilen tragen `matchVersion`,
 * kein Leser fasst sie ohne force mehr an, und 'pick-failed' steht bewusst nicht
 * in NACHLAUF_GRUENDE. Ohne dieses Skript bleiben sie ohne Zuordnung.
 *
 * ENTSCHEIDUNG PATRICK OFFEN: liegen lassen oder einmal nachplanen. Standard ist
 * deshalb ein TROCKENLAUF: liest nur, schreibt nichts, gibt Zahlen je Art und
 * Tag aus.
 *
 * Trockenlauf 08.10.2026 (161.390 Zeilen gelesen, MIT_OHNE_STAND=1): alte
 * 'pick-failed' insgesamt 5.316 (Juli 621, August 855, September 2.161,
 * Oktober bis 08.10. 1.679), davon ab AB=2026-10-01 1.679; der Anstieg beginnt
 * schon am 15.09. (vorher 0–67 je Tag, ab dann werktags meist 107–182, im
 * Oktober bis 427; Wochenenden deutlich weniger).
 * 'ohne-stand' 11 (6 ab 01.10.), 'trigger-ausnahme' 0. Mit AB=2026-10-01 und
 * MIT_OHNE_STAND=1: 1.685 Zeilen, 85 Takte ≈ 21 h Nachlauf. Ein früheres AB
 * (z. B. 2026-09-15) nimmt den September mit — auch das entscheidet Patrick.
 * Die alten Zeilen tragen keinen Fehlertext: Zeitabbruch und echter 400 sind
 * nicht zu unterscheiden.
 *
 * Was es tut (nur mit SCHREIBEN=1):
 *  • liest purchased_products über collectionGroup seitenweise nach __name__
 *    (wie matchBacklogManual; eine Sammelabfrage auf matchError gibt es live
 *    nicht — nur normKey hat einen Sammel-Index),
 *  • wählt die Zeilen mit `altbestandArt` aus nachlauf.js (dieselbe Regel, die
 *    der Nachlauf beim Übernehmen prüft),
 *  • legt je Zeile in EINER Transaktion einen Eintrag
 *    `receiptMatchNachlauf/{uid}__{ppId}` mit `altbestand: true` an (create —
 *    ein bestehender Eintrag bleibt unberührt) und setzt `matchNachlauf:
 *    'geplant'` an der Zeile; die Zeile wird in der Transaktion frisch gelesen.
 *  • verteilt die Fälligkeit: ALTBESTAND_JE_TAKT Einträge je 15-Minuten-Takt,
 *    älteste zuerst; frische Fehler haben im selben Durchgang weiter Platz.
 * Danach ordnet matchNachlauf die Zeilen zu — IMMER mit noClose (kein
 * nachträgliches Abhaken von Einkaufszetteln), höchstens drei Versuche je
 * Zeile. Echte 400er kosten genau einen weiteren Versuch (danach steht
 * `pickAttempts` an der Zeile, der Eintrag verschwindet).
 *
 * Zeilen ohne matchVersion NIE über matchReceiptManual nachholen: dort fehlt
 * noClose, ein heutiger Einkaufszettel-Eintrag würde zu einem alten Bon
 * abgehakt.
 *
 * Reihenfolge: ERST receipt-matcher mit nachlauf.js (altbestand) ausrollen,
 * DANN dieses Skript schreibend. Ein älterer Stand räumt die Einträge sofort
 * als „erledigt“ (kein Schaden, nur wirkungslos). Ausschalten des Nachlaufs
 * ohne Deploy: `_meta/zuordnungNachlauf` = { aktiv: false }. Rückweg für den
 * Altbestand allein: Einträge in receiptMatchNachlauf mit `altbestand == true`
 * löschen (Abfrage auf einer normalen Collection, Index automatisch); das
 * `matchNachlauf: 'geplant'` an der Zeile ist nur ein Vermerk.
 *
 * Aufruf (im Ordner cloud-functions/receipt-matcher, ADC des Nutzerkontos):
 *   node .nachlauf-altbestand-0810.js                  Trockenlauf, Art pick-failed-alt
 *   MIT_OHNE_STAND=1 node .nachlauf-altbestand-0810.js zusätzlich 'ohne-stand' und
 *                                                      'trigger-ausnahme' (Kopf nachlauf.js)
 *   SCHREIBEN=1 node .nachlauf-altbestand-0810.js      plant wirklich (nur mit Freigabe)
 * Weitere Umgebungsvariablen:
 *   AB=2026-10-01         frühester Tag (UTC-Tagesbeginn); pick-failed-alt nach matchedAt,
 *                         die anderen Arten nach der Anlage der Zeile (createTime)
 *   MIN_ALTER_MIN=120     ohne-stand/trigger-ausnahme erst, wenn die Zeile so alt ist
 *                         (ein laufender Trigger ist sonst noch nicht fertig)
 *   SEITE=1000            Dokumente je Leseseite
 *   MAX_SEITEN            nur zum Probieren: nach so vielen Seiten aufhören
 *   PARALLEL=8            gleichzeitige Transaktionen beim Schreiben
 * Kosten: ein Lesevorgang je purchased_products-Dokument (08.10.2026: 161.375),
 * beim Schreiben je Zeile 2 Lese- und 2 Schreibvorgänge. Danach je Zeile
 * höchstens drei Nachlauf-Versuche (Alias-Treffer kosten keinen Gemini-Aufruf).
 *
 * Ergebnisdatei (nur beim Schreiben): .nachlauf-altbestand-0810.result.json —
 * die Kandidaten stehen darin VOR dem ersten Schreibvorgang, das Ergebnis je
 * Zeile wird nach jedem Block nachgetragen. Enthält Nutzer-IDs: nicht teilen,
 * nicht einchecken (firebase.json schließt .*.js/.*.json vom Deploy aus).
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const N = require('./nachlauf');

const PROJEKT = 'markendetektive-895f7';
const SCHREIBEN = process.env.SCHREIBEN === '1';
const MIT_OHNE_STAND = process.env.MIT_OHNE_STAND === '1';
const AB_TEXT = process.env.AB || '2026-10-01';
const AB_MS = Date.parse(`${AB_TEXT}T00:00:00Z`);
const MIN_ALTER_MS = (Number(process.env.MIN_ALTER_MIN) || 120) * 60_000;
const SEITE = Math.min(Math.max(parseInt(process.env.SEITE, 10) || 1000, 50), 5000);
const MAX_SEITEN = parseInt(process.env.MAX_SEITEN, 10) || Infinity;
const PARALLEL = Math.min(Math.max(parseInt(process.env.PARALLEL, 10) || 8, 1), 32);
const MAX_FEHLER = 5;
const ERGEBNIS = path.join(__dirname, '.nachlauf-altbestand-0810.result.json');

const ARTEN = new Set([N.ALTBESTAND_ART.PICK_FAILED_ALT, ...(MIT_OHNE_STAND ? [N.ALTBESTAND_ART.OHNE_STAND, N.ALTBESTAND_ART.TRIGGER_AUSNAHME] : [])]);

const tsMs = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v instanceof Date ? v.getTime() : null);
const tagBerlin = (ms) => (ms == null ? 'unbekannt' : new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date(ms)));

/**
 * Zeitpunkt, nach dem eine Zeile beurteilt wird: der Fehler des alten Matchers
 * nach matchedAt (wann er geschrieben wurde), die anderen nach der Anlage.
 */
function zeitpunkt(art, d, doc) {
  if (art === N.ALTBESTAND_ART.PICK_FAILED_ALT) return tsMs(d.matchedAt);
  return tsMs(doc.createTime);
}

async function lesen(db, jetzt) {
  const bericht = { gelesen: 0, seiten: 0, arten: {}, tage: {} };
  const kandidaten = [];
  let letzte = null;
  for (;;) {
    if (bericht.seiten >= MAX_SEITEN) {
      bericht.abgebrochenNachSeiten = bericht.seiten;
      break;
    }
    let q = db
      .collectionGroup('purchased_products')
      .orderBy('__name__')
      .select('matchStatus', 'matchError', 'matchVersion', 'pickAttempts', 'matchedAt', 'rewardEligible')
      .limit(SEITE);
    if (letzte) q = q.startAfter(letzte);
    const snap = await q.get();
    bericht.seiten++;
    for (const doc of snap.docs) {
      bericht.gelesen++;
      const d = doc.data();
      const art = N.altbestandArt(d);
      if (!art) continue;
      const ms = zeitpunkt(art, d, doc);
      const a = (bericht.arten[art] = bericht.arten[art] || { gesamt: 0, abAb: 0, vorAb: 0, zuJung: 0, zeitUnbekannt: 0 });
      a.gesamt++;
      const tage = (bericht.tage[art] = bericht.tage[art] || {});
      const tag = tagBerlin(ms);
      tage[tag] = (tage[tag] || 0) + 1;
      if (ms == null) {
        a.zeitUnbekannt++;
        continue;
      }
      if (ms < AB_MS) {
        a.vorAb++;
        continue;
      }
      if (art !== N.ALTBESTAND_ART.PICK_FAILED_ALT && ms > jetzt - MIN_ALTER_MS) {
        a.zuJung++;
        continue;
      }
      a.abAb++;
      if (ARTEN.has(art)) kandidaten.push({ ppPath: doc.ref.path, art, ms });
    }
    if (bericht.seiten % 20 === 0) console.error(`… ${bericht.gelesen} gelesen, ${kandidaten.length} Kandidaten`);
    if (snap.size < SEITE) break;
    letzte = snap.docs[snap.docs.length - 1];
  }
  // Älteste zuerst: sie warten am längsten.
  kandidaten.sort((x, y) => x.ms - y.ms || (x.ppPath < y.ppPath ? -1 : 1));
  for (const t of Object.values(bericht.tage)) {
    for (const k of Object.keys(t).sort()) {
      const v = t[k];
      delete t[k];
      t[k] = v;
    }
  }
  return { bericht, kandidaten };
}

async function planeEine(db, k, index, jetzt) {
  const eintragRef = db.collection(N.NACHLAUF_COLLECTION).doc(N.nachlaufDocId(k.ppPath));
  const ppRef = db.doc(k.ppPath);
  return db.runTransaction(async (tx) => {
    const [e, p] = await tx.getAll(eintragRef, ppRef);
    if (e.exists) return 'schon_geplant';
    if (!p.exists) return 'zeile_fehlt';
    const plan = N.planeAltbestand({ ppPath: k.ppPath, pp: p.data(), index, jetzt, arten: ARTEN });
    if (!plan) return 'nicht_mehr_offen';
    tx.create(eintragRef, plan.daten);
    tx.set(ppRef, plan.ppFelder, { merge: true });
    return 'geplant';
  });
}

function speichern(stand) {
  fs.writeFileSync(ERGEBNIS, JSON.stringify(stand, null, 1));
}

async function schreiben(db, kandidaten, jetzt, bericht) {
  const stand = {
    gestartet: new Date(jetzt).toISOString(),
    ab: AB_TEXT,
    arten: [...ARTEN],
    bericht,
    kandidaten: kandidaten.map((k) => ({ ppPath: k.ppPath, art: k.art, ergebnis: null })),
  };
  speichern(stand); // VOR dem ersten Schreibvorgang
  const zaehler = {};
  let fehler = 0;
  for (let i = 0; i < kandidaten.length; i += PARALLEL) {
    const block = kandidaten.slice(i, i + PARALLEL);
    const r = await Promise.allSettled(block.map((k, j) => planeEine(db, k, i + j, jetzt)));
    r.forEach((x, j) => {
      const ergebnis = x.status === 'fulfilled' ? x.value : `fehler: ${x.reason && (x.reason.code || x.reason.message)}`;
      stand.kandidaten[i + j].ergebnis = ergebnis;
      const schluessel = x.status === 'fulfilled' ? ergebnis : 'fehler';
      zaehler[schluessel] = (zaehler[schluessel] || 0) + 1;
      if (x.status !== 'fulfilled') fehler++;
    });
    speichern(stand);
    if (fehler >= MAX_FEHLER) {
      console.error(`Abbruch nach ${fehler} Fehlern (Block ab Nr. ${i}). Stand in ${ERGEBNIS}.`);
      stand.abbruch = `fehler_${fehler}`;
      speichern(stand);
      break;
    }
  }
  stand.zaehler = zaehler;
  stand.fertig = new Date().toISOString();
  speichern(stand);
  return zaehler;
}

async function main() {
  if (!Number.isFinite(AB_MS)) throw new Error(`AB ungültig: ${AB_TEXT}`);
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJEKT });
  const db = admin.firestore();
  const jetzt = Date.now();
  console.error(`${SCHREIBEN ? 'SCHREIBEN' : 'TROCKENLAUF'} · ab ${AB_TEXT} · Arten: ${[...ARTEN].join(', ')}`);

  const bestehend = (await db.collection(N.NACHLAUF_COLLECTION).count().get()).data().count;
  const { bericht, kandidaten } = await lesen(db, jetzt);
  const takte = Math.ceil(kandidaten.length / N.ALTBESTAND_JE_TAKT);
  const ausgabe = {
    modus: SCHREIBEN ? 'schreiben' : 'trockenlauf',
    ab: AB_TEXT,
    arten: [...ARTEN],
    bestehendeNachlaufEintraege: bestehend,
    ...bericht,
    kandidaten: kandidaten.length,
    verteilung: { jeTakt: N.ALTBESTAND_JE_TAKT, takte, stunden: Math.round(((takte * N.TAKT_MS) / 3_600_000) * 10) / 10 },
    beispiele: kandidaten.slice(0, 5).map((k) => ({ ppPath: k.ppPath.replace(/^users\/[^/]+/, 'users/…'), art: k.art, tag: tagBerlin(k.ms) })),
  };
  if (!SCHREIBEN) {
    console.log(JSON.stringify(ausgabe, null, 1));
    console.error('Trockenlauf: nichts geschrieben. Schreiben nur mit SCHREIBEN=1 (Entscheidung Patrick).');
    return;
  }
  ausgabe.ergebnis = await schreiben(db, kandidaten, jetzt, bericht);
  console.log(JSON.stringify(ausgabe, null, 1));
}

if (require.main === module) {
  main().catch((e) => {
    console.error('FEHLER', e.code || '', e.message);
    process.exit(1);
  });
}

module.exports = { zeitpunkt, ARTEN };
