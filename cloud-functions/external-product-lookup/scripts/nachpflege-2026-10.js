#!/usr/bin/env node
/**
 * Nachpflege Oktober 2026 — Bestand an das neue Speichermodell der
 * Produktsuche angleichen (Entscheidung Patrick 04.10.2026: „Produkte wirklich
 * bei uns aufnehmen, mit einem Timestamp; älter als 2 Monate → aktualisieren,
 * wenn das Produkt wieder hochkommt").
 *
 * WAS ES TUT (nur ergänzen, was fehlt — Regeln in scripts/nachpflegePlan.js):
 *  1. external_products (alle):
 *     - storedAt   = Anlagezeit des Dokuments (createTime). Achtung: Dokumente,
 *                    die früher per force gelöscht und neu angelegt wurden,
 *                    tragen die Zeit der Neuanlage.
 *     - fetchedAt  = Datenstand der Quelle (OFF-API: Abrufzeit; Suche:
 *                    fetchedAt/scrapedAt der Kopie, letzteres als Schätzung
 *                    mit fetchedAtGeschaetzt; REWE-Pipeline: null) plus
 *                    fetchedAtQuelle.
 *     - productName: der Platzhalter 'Produkt'/'Unbekannt' wird durch den
 *                    echten OpenFoodFacts-Namen aus raw.product_name (sonst
 *                    raw.generic_name) ersetzt — nur wenn dort einer steht;
 *                    dazu feldQuellen.name = 'openfood'. Dieselbe Rettung
 *                    macht lib/speichern.js beim nächsten Schreiben.
 *                    NICHT bei fremdem Altbestand der Suche (Prüfrunde 2,
 *                    lib/rohablage.js altbestandAbgelehnt): ein echter Name
 *                    über fremden Zutaten machte sie nur glaubwürdiger. Diese
 *                    Dokumente stehen in der Ergebnisdatei
 *                    (altbestandAbgelehnt); die Abfrage entfernt den fremden
 *                    Teil beim nächsten Scan und rettet den Namen im selben
 *                    Schreibvorgang.
 *  2. external_lookup_misses (nur offene: pending/processing):
 *     - scanTage (Untergrenze aus erstem/letztem Scan, scanTageGeschaetzt),
 *       letzterScanTag, rang = scanTage·1e13 + lastSeenAt.
 *     MUSS vor dem Ausrollen des neuen Prozessors laufen: der sortiert nach
 *     `rang`. Fälle ohne Rang erreicht er praktisch nicht (die hitCount-
 *     Ausweichabfrage läuft nur, wenn die nach rang scheitert oder zu wenig
 *     liefert) — deshalb Schritt 6 (NEU=1) direkt nach dem Ausrollen der
 *     Abfrage.
 *
 * WAS ES NICHT TUT: nichts löschen, keine Quelle abfragen, kein Geld ausgeben,
 * nichts in produkte/markenProdukte, nutritionscrape oder _meta schreiben.
 *
 * REIHENFOLGE beim Ausrollen (Gesamtablauf: external-misses-processor/README.md):
 *  1. Index status+rang, nutrition-scraper.
 *  2. Dieses Skript, NUR=misses: erst Trockenlauf, dann SCHREIBEN=1 NUR=misses.
 *  3. external-misses-processor ausrollen (sortiert nach `rang`).
 *  4. external-product-lookup ausrollen (neuer Schreibweg, öffnet alte Fälle
 *     wieder — das darf erst der neue Prozessor bearbeiten).
 *  5. Dieses Skript, NUR=produkte (SCHREIBEN=1). Nicht vor Schritt 4: der alte
 *     Abfrage-Code kann den Platzhalter 'Produkt' erneut über einen
 *     reparierten Namen schreiben und `source` ändern, ohne fetchedAt
 *     nachzuziehen.
 *  6. Pflicht, direkt danach: einmal SCHREIBEN=1 NEU=1 über alles —
 *     gefahrlos, füllt nur, was zwischendurch ohne Rang/Datenstand entstanden
 *     ist (sonst bearbeitet der Prozessor diese Fälle erst beim nächsten Scan).
 *
 * AUFRUF (aus cloud-functions/external-product-lookup, ADC des Nutzerkontos):
 *   node scripts/nachpflege-2026-10.js                  # Trockenlauf (Standard)
 *   SCHREIBEN=1 node scripts/nachpflege-2026-10.js      # schreibt
 * Weitere Umgebungsvariablen:
 *   ERGEBNIS=<pfad>   Ergebnisdatei (Standard: Temp-Ordner, je Modus eine Datei)
 *   NEU=1             vorhandene Ergebnisdatei ignorieren und von vorn beginnen
 *   NUR=produkte|misses   nur einen Teil
 *   BLOCK=500         Dokumente je Block; PARALLEL=10 gleichzeitige Schreibvorgänge
 *
 * SICHERHEIT
 *  - Jeder Schreibvorgang ist ein update mit Vorbedingung lastUpdateTime: hat
 *    jemand das Dokument zwischen Lesen und Schreiben geändert (Abfrage,
 *    Prozessor), wird es neu gelesen und neu geplant — nie blind überschrieben.
 *  - Wiederaufnehmbar: nach JEDEM Block steht der Stand in der Ergebnisdatei;
 *    ein neuer Aufruf macht hinter dem letzten Block weiter. Ein Lauf mit NEU=1
 *    ist gefahrlos: geschrieben wird nur, was fehlt.
 *  - Jede Änderung an external_products weckt onExternalProductUpdateForAssessment
 *    (ai-product-comparison). Der bewertet nur neu, wenn sich Nährwerte oder
 *    Zutaten ändern — das tut dieses Skript nie; jeder Aufruf endet sofort.
 *  - Unerwarteter Fehler → Ergebnisdatei schreiben, Abbruch mit Exit-Code 1.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const admin = require('firebase-admin');
const { planeProdukt, planeMiss, sichtProdukt, sichtMiss, felderZumSchreiben } = require('./nachpflegePlan');

// Nur für den Probelauf im Emulator: ein anderes Projekt ausschließlich mit
// dem Präfix demo- (Emulator-only) — ein Tippfehler trifft so nie ein echtes.
const PROJEKT = process.env.PROJEKT || 'markendetektive-895f7';
if (PROJEKT !== 'markendetektive-895f7' && !PROJEKT.startsWith('demo-')) {
  throw new Error(`PROJEKT=${PROJEKT}: nur markendetektive-895f7 oder ein demo-Projekt (Emulator)`);
}
const SCHREIBEN = process.env.SCHREIBEN === '1';
const MODUS = SCHREIBEN ? 'schreiben' : 'trocken';
const ERGEBNIS = process.env.ERGEBNIS || path.join(os.tmpdir(), `nachpflege-2026-10.${MODUS}.json`);
const BLOCK = Math.max(50, Math.min(Number(process.env.BLOCK) || 500, 1000));
const PARALLEL = Math.max(1, Math.min(Number(process.env.PARALLEL) || 10, 50));
const PHASEN = process.env.NUR ? [process.env.NUR] : ['produkte', 'misses'];
const BEISPIELE = 20;
const SECHZIG_TAGE_MS = 60 * 24 * 60 * 60 * 1000;

if (!admin.apps.length) admin.initializeApp({ projectId: PROJEKT });
const db = admin.firestore();
const { FieldPath, Timestamp } = admin.firestore;

const FELDER = {
  produkte: ['source', 'cachedAt', 'productName', 'storedAt', 'fetchedAt',
    'raw.product_name', 'raw.generic_name', 'raw.scrapedSource', 'raw.scrapedAt', 'raw.fetchedAt',
    'raw.merchant_company', 'raw.price_current', 'raw.thumbnails', 'raw.sourceShop', 'raw.scrapedUrl', 'raw.sourceUrl'],
  misses: ['status', 'firstSeenAt', 'lastSeenAt', 'processedAt', 'scanTage', 'letzterScanTag', 'rang'],
};
const SAMMLUNG = { produkte: 'external_products', misses: 'external_lookup_misses' };

/* ─────────────────────────── Ergebnisdatei ─────────────────────────── */

function leererStand() {
  const jetzt = new Date().toISOString();
  return {
    skript: 'nachpflege-2026-10', modus: MODUS, projekt: PROJEKT, gestartet: jetzt, aktualisiert: jetzt, fertig: false,
    phasen: {
      produkte: { cursor: null, fertig: false, gelesen: 0, zuSchreiben: 0, geschrieben: 0, neuGeplant: 0, veraendertUebersprungen: 0,
        storedAt: 0, fetchedAt: {}, fetchedAtGeschaetzt: 0, fetchedAtAelter60Tage: {}, nameRepariert: 0, platzhalterOhneErsatz: 0, schonVollstaendig: 0,
        altbestandAbgelehnt: {}, abgelehnt: [],
        beispiele: { namen: [], platzhalterOhneErsatz: [], fetchedAt: [] }, namen: [] },
      misses: { cursor: null, fertig: false, gelesen: 0, nachStatus: {}, offen: 0, zuSchreiben: 0, geschrieben: 0, neuGeplant: 0, veraendertUebersprungen: 0,
        scanTage: {}, zeitAusAnlage: 0, schonVollstaendig: 0, abgeschlossenAelter60Tage: {}, top: [] },
    },
  };
}

function ladeStand() {
  if (process.env.NEU === '1' || !fs.existsSync(ERGEBNIS)) return leererStand();
  const s = JSON.parse(fs.readFileSync(ERGEBNIS, 'utf8'));
  if (s.modus !== MODUS) throw new Error(`Ergebnisdatei ${ERGEBNIS} stammt aus Modus „${s.modus}" — anderen ERGEBNIS-Pfad wählen oder NEU=1`);
  return s;
}

function speichere(stand) {
  stand.aktualisiert = new Date().toISOString();
  const tmp = `${ERGEBNIS}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(stand, null, 1));
  fs.renameSync(tmp, ERGEBNIS);
}

const plus = (obj, k, n = 1) => { obj[k] = (obj[k] || 0) + n; };
const beispiel = (liste, wert) => { if (liste.length < BEISPIELE) liste.push(wert); };

/* ─────────────────────────── Plan je Dokument ─────────────────────────── */

const zeit = (snap) => (snap.createTime ? snap.createTime.toMillis() : null);
const sicht = (teil, snap) => (teil === 'produkte' ? sichtProdukt(snap.data(), zeit(snap), snap.id) : sichtMiss(snap.data(), zeit(snap)));
const plane = (teil, s) => (teil === 'produkte' ? planeProdukt(s) : planeMiss(s));
const updateAus = (teil, setzen) => felderZumSchreiben(teil, setzen, (ms) => Timestamp.fromMillis(ms));

/* ─────────────────────────── Zählen ─────────────────────────── */

function zaehleProdukt(st, snap, plan, jetzt) {
  st.gelesen += 1;
  // Platzhalter ohne echten Namen in raw.product_name: bleibt stehen (nur gezählt).
  if (plan.platzhalterOhneErsatz) {
    st.platzhalterOhneErsatz += 1;
    beispiel(st.beispiele.platzhalterOhneErsatz, snap.id);
  }
  if (plan.altbestandAbgelehnt) {
    // Ältere Ergebnisdateien kennen die Felder noch nicht (Wiederaufnahme).
    st.altbestandAbgelehnt = st.altbestandAbgelehnt || {};
    st.abgelehnt = st.abgelehnt || [];
    plus(st.altbestandAbgelehnt, plan.altbestandAbgelehnt);
    // Vollständige Liste: diese Dokumente bereinigt erst der nächste Scan.
    st.abgelehnt.push({ id: snap.id, grund: plan.altbestandAbgelehnt });
  }
  const u = updateAus('produkte', plan.setzen);
  if (!Object.keys(u).length) { st.schonVollstaendig += 1; return u; }
  st.zuSchreiben += 1;
  if (plan.setzen.storedAtMs != null) st.storedAt += 1;
  if ('fetchedAtMs' in plan.setzen) {
    const quelle = plan.quelle || 'nicht_zuzuordnen';
    plus(st.fetchedAt, quelle);
    if (plan.setzen.fetchedAtGeschaetzt) st.fetchedAtGeschaetzt += 1;
    // Kandidaten fürs Auffrischen beim nächsten Scan (Frist 60 Tage).
    if (plan.setzen.fetchedAtMs != null && jetzt - plan.setzen.fetchedAtMs > SECHZIG_TAGE_MS) plus(st.fetchedAtAelter60Tage, quelle);
    beispiel(st.beispiele.fetchedAt, { id: snap.id, quelle, fetchedAt: plan.setzen.fetchedAtMs == null ? null : new Date(plan.setzen.fetchedAtMs).toISOString(), geschaetzt: !!plan.setzen.fetchedAtGeschaetzt });
  }
  if (plan.nameRepariert) {
    st.nameRepariert += 1;
    // Vollständige Liste: das ist die einzige Spur, welche Namen geändert wurden.
    st.namen.push({ id: snap.id, alt: plan.nameRepariert.alt, neu: plan.nameRepariert.neu });
    beispiel(st.beispiele.namen, { id: snap.id, neu: plan.nameRepariert.neu });
  }
  return u;
}

function zaehleMiss(st, snap, plan, jetzt, s) {
  st.gelesen += 1;
  plus(st.nachStatus, s.status || 'ohne_status');
  if (!plan.offen) {
    // Abgeschlossen und älter als 60 Tage → würde beim nächsten Scan neu
    // gesucht (Abfrage, nicht dieses Skript; REWE-Daten ausgenommen).
    if (['resolved', 'no-data', 'error'].includes(s.status) && s.processedMs != null && jetzt - s.processedMs > SECHZIG_TAGE_MS) plus(st.abgeschlossenAelter60Tage, s.status);
    return {};
  }
  st.offen += 1;
  if (plan.zeitAusAnlage) st.zeitAusAnlage += 1;
  plus(st.scanTage, String(plan.scanTage));
  if (plan.rang != null) {
    st.top.push({ id: snap.id, scanTage: plan.scanTage, letzterScan: s.lastSeenMs ? new Date(s.lastSeenMs).toISOString() : null, rang: plan.rang });
    st.top.sort((a, b) => b.rang - a.rang);
    st.top.length = Math.min(st.top.length, BEISPIELE);
  }
  const u = updateAus('misses', plan.setzen);
  if (!Object.keys(u).length) { st.schonVollstaendig += 1; return u; }
  st.zuSchreiben += 1;
  return u;
}

/* ─────────────────────────── Schreiben ─────────────────────────── */

const NICHT_GEFUNDEN = 5; // gRPC NOT_FOUND — inzwischen gelöscht (alter force-Pfad)
const VORBEDINGUNG_VERLETZT = 9; // gRPC FAILED_PRECONDITION — inzwischen geändert

/**
 * Ein Dokument schreiben. Hat sich das Dokument seit dem Lesen geändert, wird
 * es frisch gelesen und neu geplant (höchstens einmal); danach nie blind.
 * Ein inzwischen gelöschtes Dokument wird nicht wieder angelegt.
 * @returns {'geschrieben'|'neu_geplant_nichts'|'veraendert'}
 */
async function schreibe(phase, snap, update) {
  try {
    await snap.ref.update(update, { lastUpdateTime: snap.updateTime });
    return 'geschrieben';
  } catch (e) {
    if (e.code === NICHT_GEFUNDEN) return 'neu_geplant_nichts';
    if (e.code !== VORBEDINGUNG_VERLETZT) throw e;
  }
  const frisch = await snap.ref.get();
  if (!frisch.exists) return 'neu_geplant_nichts';
  const u = updateAus(phase, plane(phase, sicht(phase, frisch)).setzen);
  if (!Object.keys(u).length) return 'neu_geplant_nichts';
  try {
    await frisch.ref.update(u, { lastUpdateTime: frisch.updateTime });
    return 'geschrieben';
  } catch (e) {
    if (e.code === VORBEDINGUNG_VERLETZT) return 'veraendert';
    if (e.code === NICHT_GEFUNDEN) return 'neu_geplant_nichts';
    throw e;
  }
}

async function schreibeBlock(phase, st, auftraege) {
  for (let i = 0; i < auftraege.length; i += PARALLEL) {
    const ergebnisse = await Promise.all(auftraege.slice(i, i + PARALLEL).map(([snap, u]) => schreibe(phase, snap, u)));
    for (const r of ergebnisse) {
      if (r === 'geschrieben') st.geschrieben += 1;
      else if (r === 'neu_geplant_nichts') st.neuGeplant += 1;
      else st.veraendertUebersprungen += 1;
    }
  }
}

/* ─────────────────────────── Ablauf ─────────────────────────── */

async function phase(name, stand) {
  const st = stand.phasen[name];
  if (st.fertig) { console.log(`[${name}] schon fertig — übersprungen`); return; }
  const jetzt = Date.now();
  for (;;) {
    let q = db.collection(SAMMLUNG[name]).select(...FELDER[name]).orderBy(FieldPath.documentId()).limit(BLOCK);
    if (st.cursor) q = q.startAfter(st.cursor);
    const s = await q.get();
    const auftraege = [];
    for (const snap of s.docs) {
      const ansicht = sicht(name, snap);
      const plan = plane(name, ansicht);
      const u = name === 'produkte' ? zaehleProdukt(st, snap, plan, jetzt) : zaehleMiss(st, snap, plan, jetzt, ansicht);
      if (Object.keys(u).length) auftraege.push([snap, u]);
    }
    if (SCHREIBEN && auftraege.length) await schreibeBlock(name, st, auftraege);
    if (s.docs.length) st.cursor = s.docs[s.docs.length - 1].id;
    if (s.docs.length < BLOCK) st.fertig = true;
    speichere(stand);
    process.stderr.write(`[${name}] gelesen ${st.gelesen}, zu schreiben ${st.zuSchreiben}${SCHREIBEN ? `, geschrieben ${st.geschrieben}` : ''}\n`);
    if (st.fertig) return;
  }
}

function bericht(stand) {
  const p = stand.phasen.produkte;
  const m = stand.phasen.misses;
  const z = (n) => Number(n || 0).toLocaleString('de-DE');
  const verb = SCHREIBEN ? 'geschrieben' : 'würde schreiben';
  console.log(`\n══ Nachpflege 2026-10 · ${SCHREIBEN ? 'GESCHRIEBEN' : 'TROCKENLAUF (nichts geschrieben)'} · Ergebnis: ${ERGEBNIS}`);
  if (PHASEN.includes('produkte')) {
    console.log(`external_products: ${z(p.gelesen)} gelesen, ${verb} an ${z(p.zuSchreiben)}${SCHREIBEN ? ` (geschrieben ${z(p.geschrieben)}, neu geplant ohne Änderung ${z(p.neuGeplant)}, zwischendurch verändert ${z(p.veraendertUebersprungen)})` : ''}; schon vollständig ${z(p.schonVollstaendig)}`);
    console.log(`  storedAt: ${z(p.storedAt)} · fetchedAt nach Quelle: ${JSON.stringify(p.fetchedAt)} (davon geschätzt ${z(p.fetchedAtGeschaetzt)})`);
    console.log(`  fetchedAt älter als 60 Tage (Auffrisch-Kandidaten beim nächsten Scan): ${JSON.stringify(p.fetchedAtAelter60Tage)}`);
    console.log(`  Name repariert aus raw.product_name: ${z(p.nameRepariert)} · Platzhalter ohne echten Namen (bleibt): ${z(p.platzhalterOhneErsatz)}`);
    console.log(`  fremder Altbestand (Name NICHT gerettet, bereinigt beim nächsten Scan): ${JSON.stringify(p.altbestandAbgelehnt || {})}`);
    console.log(`  Beispiele Namen: ${p.beispiele.namen.slice(0, 5).map((b) => `${b.id} → ${b.neu}`).join(' | ')}`);
  }
  if (PHASEN.includes('misses')) {
    console.log(`external_lookup_misses: ${z(m.gelesen)} gelesen, Status ${JSON.stringify(m.nachStatus)}`);
    console.log(`  offen ${z(m.offen)}, ${verb} an ${z(m.zuSchreiben)}${SCHREIBEN ? ` (geschrieben ${z(m.geschrieben)}, neu geplant ${z(m.neuGeplant)}, verändert ${z(m.veraendertUebersprungen)})` : ''}; schon vollständig ${z(m.schonVollstaendig)}; ohne Scan-Zeit (Anlagezeit genommen) ${z(m.zeitAusAnlage)}`);
    console.log(`  scanTage (Untergrenze): ${JSON.stringify(m.scanTage)}`);
    console.log(`  abgeschlossen, älter als 60 Tage (würden beim nächsten Scan neu gesucht): ${JSON.stringify(m.abgeschlossenAelter60Tage)}`);
    console.log(`  Top-Rang: ${m.top.slice(0, 5).map((t) => `${t.id} (${t.scanTage} Tage, ${String(t.letzterScan).slice(0, 10)})`).join(' | ')}`);
  }
}

async function main() {
  let stand;
  try {
    stand = ladeStand();
  } catch (e) {
    console.error(`FEHLER: ${e && e.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Nachpflege 2026-10 · Modus ${MODUS} · Projekt ${PROJEKT} · Block ${BLOCK} · Ergebnis ${ERGEBNIS}`);
  const abbruch = () => { speichere(stand); console.error('\nabgebrochen — Stand gespeichert, erneuter Aufruf macht weiter'); process.exit(130); };
  process.on('SIGINT', abbruch);
  try {
    for (const name of PHASEN) {
      if (!SAMMLUNG[name]) throw new Error(`NUR=${name} unbekannt (produkte|misses)`);
      await phase(name, stand);
    }
    stand.fertig = PHASEN.every((n) => stand.phasen[n].fertig);
    speichere(stand);
    bericht(stand);
  } catch (e) {
    speichere(stand);
    console.error(`\nFEHLER: ${e && e.message} — Stand gespeichert in ${ERGEBNIS}; erneuter Aufruf macht hinter dem letzten Block weiter.`);
    process.exitCode = 1;
  }
}

main();
