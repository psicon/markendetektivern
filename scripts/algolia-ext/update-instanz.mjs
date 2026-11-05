#!/usr/bin/env node
// Aktualisiert GENAU EINE Instanz der Firebase-Extension
// algolia/firestore-algolia-search (Firestore -> Algolia-Sync) auf eine neue Version.
//
// Warum ein eigenes Skript statt `firebase ext:update` / `firebase deploy --only extensions`:
//  - `ext:update` schreibt seit firebase-tools 11 nur ein lokales Manifest und fragt neue
//    Parameter interaktiv ab; ausgerollt wird erst per `firebase deploy`.
//  - `firebase deploy --only extensions:<id>` filtert bei Manifest-Instanzen NICHT nach der
//    Instanz (firebase-tools 15.15: lib/deploy/extensions/prepare.js). Alle anderen
//    Instanzen des Projekts (25 von 26 Stück: BigQuery-Exporte, Backup, Bildverarbeitung, die
//    uebrigen Algolia-Syncs) landen in der Loesch-Liste. Nur die Voreinstellung "nein" der
//    Rueckfrage verhindert das Loeschen; ein `--force` loescht sie alle.
//  - Dieses Skript ruft denselben API-Aufruf wie firebase-tools auf
//    (extensionsApi.updateInstanceFromRegistry: PATCH instances/<id>, gleiche updateMask),
//    aber nur fuer die genannte Instanz. Parameter und Systemparameter werden 1:1 aus der
//    laufenden Instanz uebernommen.
//
// Einzige bewusste Parameteraenderung: DO_FULL_INDEXING wird auf "false" gesetzt.
// Die Extension startet bei JEDEM Versionswechsel (Lifecycle onUpdate) einen Vollindex,
// wenn DO_FULL_INDEXING "true" ist. Der schreibt jeden Datensatz per saveObjects neu und
// haengt dabei das Feld `lastmodified` als Objekt {_operation, value} an (gemessen am
// Index vetnummern: alle 16.013 Datensaetze tragen es aus dem Vollindex 2023). produkte
// und markenProdukte haben es heute nicht -> ein Vollindex wuerde 10.693 Datensaetze
// veraendern. Mit "false" bleibt der Index beim Update unberuehrt; der Echtzeit-Sync
// (executeIndexOperation) ist von dem Parameter nicht betroffen.
// Mit --vollindex-beibehalten bleibt der bisherige Wert stehen (nicht empfohlen).
//
// Risiko Firestore eur3: Beim Update wird der Gen1-Firestore-Trigger neu registriert.
// Laut github.com/algolia/firestore-algolia-search/issues/257 (08/2026) scheitert das in
// manchen eur3-Projekten ("... is in region eur3-europe-west1 which is not supported"),
// und die Funktion ist danach kaputt — auch ein Rueckweg braucht dieselbe Registrierung.
// Deshalb vor dem ersten echten Lauf die Gen1-Sonde aus dem Deploy-Rezept ausfuehren und
// mit einer Instanz anfangen, deren Index die App nicht nutzt.
//
// Aufruf (Projekt fest: markendetektive-895f7, gcloud muss angemeldet sein):
//   node scripts/algolia-ext/update-instanz.mjs <instanz> --plan                                (nur lesen)
//   node scripts/algolia-ext/update-instanz.mjs <instanz> --pruefen   --erwarte-version 1.2.0
//   node scripts/algolia-ext/update-instanz.mjs <instanz> --ausfuehren --erwarte-version 1.2.0
// Optionen:
//   --version <v>           Zielversion, Standard 1.3.0. Erlaubt: 1.3.0, 1.2.10 (Rueckweg).
//   --erwarte-version <v>   Pflicht bei --pruefen/--ausfuehren: die Version, die JETZT in der
//                           Konfiguration steht. Mit --aus-fehlerzustand auch als Liste
//                           "1.2.0,1.3.0" erlaubt (siehe unten).
//   --aus-fehlerzustand     Erlaubt Rueckweg/Wiederholung an einer Instanz im Zustand ERRORED
//                           (nach einem gescheiterten Update). NUR fuer ERRORED: an einer
//                           ACTIVE-Instanz bricht das Skript ab, DEPLOYING/UNINSTALLING/PAUSED
//                           bleiben immer gesperrt. Weil nicht belegt ist, ob nach einem
//                           Fehlschlag die alte oder die Zielversion in der Konfiguration steht,
//                           darf --erwarte-version hier beide nennen ("1.2.0,1.3.0"); welche
//                           tatsaechlich dastand, steht im Protokoll.
//   --protokoll <ordner>    Vorher/Nachher-JSON, Standard <tmpdir>/algolia-ext-protokoll
//
// --plan liest nur (Instanz + Funktionen) und zeigt den geplanten Aufruf; sendet nichts.
//   Es laeuft in JEDEM Zustand (auch ERRORED) und ist der erste Schritt jedes Rueckwegs:
//   Zustand, Fehlermeldung und eingetragene Version ablesen, dann handeln.
// --pruefen schickt den Aufruf mit validateOnly=true (der Server prueft, aendert nichts)
// und kontrolliert anschliessend per etag, dass die Instanz unveraendert ist.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROJEKT = 'markendetektive-895f7';
const API = 'https://firebaseextensions.googleapis.com/v1beta';
const GCF = 'https://cloudfunctions.googleapis.com/v1';
const EXT_REF = 'algolia/firestore-algolia-search';
const ERLAUBTE_ZIELE = new Set(['1.3.0', '1.2.10']);
const ERWARTETE_LAUFZEIT = { '1.3.0': 'nodejs22', '1.2.10': 'nodejs20' };
// Die neun Instanzen, Stand 01.10.2026 — kein Tippfehler soll eine fremde Instanz treffen.
const INSTANZEN = new Set([
  'firestore-algolia-search', 'firestore-algolia-search-trzv', 'firestore-algolia-search-v50j',
  'firestore-algolia-search-vatb', 'firestore-algolia-search-fll2', 'firestore-algolia-search-iyqn',
  'firestore-algolia-search-ly0q', 'firestore-algolia-search-oaz3', 'firestore-algolia-search-t542',
]);
const PFLICHT_PARAMS = ['ALGOLIA_API_KEY', 'ALGOLIA_APP_ID', 'ALGOLIA_INDEX_NAME', 'COLLECTION_PATH', 'DATABASE_ID', 'LOCATION', 'DO_FULL_INDEXING'];

function fehler(msg) { console.error(`ABBRUCH: ${msg}`); process.exit(2); }

// Versionen, die an diesen Instanzen ueberhaupt vorkommen koennen (Tippfehlerschutz).
const BEKANNTE_VERSIONEN = new Set(['1.2.0', '1.2.10', '1.3.0']);

function argumente(argv) {
  const a = { instanz: argv[0], modus: null, version: '1.3.0', erwarte: null, protokoll: path.join(os.tmpdir(), 'algolia-ext-protokoll'), vollindex: false, ausFehler: false };
  for (let i = 1; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--plan' || x === '--pruefen' || x === '--ausfuehren') { if (a.modus) fehler('nur eines von --plan, --pruefen, --ausfuehren'); a.modus = x.slice(2); }
    else if (x === '--version') a.version = argv[++i];
    else if (x === '--erwarte-version') a.erwarte = argv[++i];
    else if (x === '--protokoll') a.protokoll = argv[++i];
    else if (x === '--vollindex-beibehalten') a.vollindex = true;
    else if (x === '--aus-fehlerzustand') a.ausFehler = true;
    else fehler(`unbekannte Option ${x}`);
  }
  if (!a.instanz || !INSTANZEN.has(a.instanz)) fehler(`Instanz fehlt oder unbekannt: ${a.instanz}. Erlaubt: ${[...INSTANZEN].join(', ')}`);
  if (!a.modus) fehler('--plan, --pruefen oder --ausfuehren angeben');
  if (!ERLAUBTE_ZIELE.has(a.version)) fehler(`Zielversion ${a.version} nicht erlaubt (1.2.0 ist deprecated und laeuft auf nodejs18, das nicht mehr ausrollbar ist)`);
  if (a.modus !== 'plan' && !a.erwarte) fehler(`--${a.modus} verlangt --erwarte-version <Version, die jetzt in der Konfiguration steht>`);
  if (a.ausFehler && a.modus === 'plan') fehler('--aus-fehlerzustand gilt nur fuer --pruefen/--ausfuehren; --plan laeuft ohnehin in jedem Zustand');
  if (a.erwarte != null) {
    a.erwarteListe = a.erwarte.split(',').map((s) => s.trim()).filter(Boolean);
    if (!a.erwarteListe.length) fehler('--erwarte-version ist leer');
    for (const v of a.erwarteListe) if (!BEKANNTE_VERSIONEN.has(v)) fehler(`--erwarte-version ${v} ist keine bekannte Version (${[...BEKANNTE_VERSIONEN].join(', ')})`);
    if (a.erwarteListe.length > 1 && !a.ausFehler) fehler('mehrere Werte in --erwarte-version nur zusammen mit --aus-fehlerzustand');
  }
  return a;
}

function token() {
  return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'x-goog-user-project': PROJEKT, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { roh: text.slice(0, 500) }; }
  return { status: res.status, json };
}

const instanzUrl = (id) => `${API}/projects/${PROJEKT}/instances/${id}`;

async function ladeInstanz(id) {
  const r = await api('GET', instanzUrl(id));
  if (r.status !== 200) fehler(`GET ${id}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
}

function zustandText(inst) {
  const c = inst.config || {};
  const e = inst.errorStatus ? ` | Fehler: ${JSON.stringify(inst.errorStatus).slice(0, 400)}` : '';
  return `Zustand ${inst.state}, Version laut Konfiguration ${c.extensionVersion}, letzte Operation ${inst.lastOperationType || '-'} (${inst.lastOperationName || '-'})${e}`;
}

// Prueft die Instanz vor einem Aufruf. Im Modus "plan" werden Zustand und Version nur
// angezeigt (kein Abbruch) — --plan ist der erste Schritt jedes Rueckwegs.
function pruefeInstanz(inst, a) {
  const c = inst.config || {};
  if (c.extensionRef !== EXT_REF) fehler(`${a.instanz} ist keine ${EXT_REF}-Instanz (${c.extensionRef})`);
  if (a.modus !== 'plan') {
    if (a.ausFehler) {
      if (inst.state !== 'ERRORED') fehler(`--aus-fehlerzustand gilt nur fuer ERRORED, ${a.instanz} ist ${inst.state}. Ohne die Option erneut aufrufen.`);
    } else if (inst.state !== 'ACTIVE') {
      fehler(`${a.instanz} ist nicht ACTIVE (${inst.state})${inst.state === 'ERRORED' ? ' — Rueckweg/Wiederholung nur mit --aus-fehlerzustand, vorher --plan lesen' : ''}`);
    }
  }
  for (const p of PFLICHT_PARAMS) if (!c.params?.[p]) fehler(`Parameter ${p} fehlt an der Instanz`);
  if (!/^projects\/\d+\/secrets\/[^/]+\/versions\/\d+$/.test(c.params.ALGOLIA_API_KEY)) fehler('ALGOLIA_API_KEY ist keine Secret-Version-Referenz');
  if (c.params.ALT_OBJECT_ID) fehler('ALT_OBJECT_ID ist gesetzt — das aendert die objectID. Nicht mit diesem Skript.');
  if (a.erwarteListe && !a.erwarteListe.includes(c.extensionVersion)) fehler(`in der Konfiguration steht ${c.extensionVersion}, erwartet ${a.erwarteListe.join(' oder ')}`);
  const laeuft = inst.lastOperationName && inst.runtimeData?.processingState?.state === 'PROCESSING';
  if (laeuft && a.modus !== 'plan') fehler(`an ${a.instanz} laeuft gerade eine Verarbeitung (${inst.runtimeData.processingState.detailMessage})`);
}

function baueAufruf(inst, a) {
  const c = inst.config;
  const params = { ...c.params };
  if (!a.vollindex) params.DO_FULL_INDEXING = 'false';
  const body = { config: { extensionRef: EXT_REF, extensionVersion: a.version, params, systemParams: c.systemParams || {} } };
  // identisch zu firebase-tools updateInstanceFromRegistry
  const updateMask = 'config.extension_ref,config.extension_version,config.params,config.system_params,config.allowed_event_types,config.eventarc_channel';
  return { body, updateMask };
}

function zeigeDiff(alt, neu) {
  const keys = [...new Set([...Object.keys(alt), ...Object.keys(neu)])].sort();
  for (const k of keys) {
    const tag = alt[k] === neu[k] ? '  ' : '* ';
    console.log(`  ${tag}${k}: ${alt[k] ?? '(leer)'}${alt[k] === neu[k] ? '' : `  ->  ${neu[k] ?? '(leer)'}`}`);
  }
}

async function warteAufOperation(name) {
  const start = Date.now();
  for (;;) {
    const r = await api('GET', `${API}/${name}`);
    if (r.status !== 200) fehler(`Operation ${name}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
    if (r.json.done) return r.json;
    if (Date.now() - start > 20 * 60 * 1000) fehler(`Operation ${name} nach 20 min nicht fertig — Status in der Console pruefen, NICHT erneut starten`);
    process.stdout.write('.');
    await new Promise((res) => setTimeout(res, 10_000));
  }
}

async function funktionen(id) {
  const out = {};
  for (const f of ['executeIndexOperation', 'executeFullIndexOperation']) {
    const r = await api('GET', `${GCF}/projects/${PROJEKT}/locations/us-central1/functions/ext-${id}-${f}`);
    out[f] = r.status === 200 ? { runtime: r.json.runtime, status: r.json.status, updateTime: r.json.updateTime, versionId: r.json.versionId } : { http: r.status };
  }
  return out;
}

async function main() {
  const a = argumente(process.argv.slice(2));
  const stempel = new Date().toISOString().replace(/[:.]/g, '-');
  const vorher = await ladeInstanz(a.instanz);
  console.log(`Instanz ${a.instanz}: ${zustandText(vorher)}`);
  pruefeInstanz(vorher, a);
  const c = vorher.config;
  console.log(`Plan: ${c.extensionVersion} -> ${a.version}  (Index ${c.params.ALGOLIA_INDEX_NAME}, Collection ${c.params.COLLECTION_PATH})`);
  if (vorher.state !== 'ACTIVE') console.log(`!! Instanz ist ${vorher.state}. Rueckweg/Wiederholung nur mit --aus-fehlerzustand und --erwarte-version ${c.extensionVersion} (siehe Deploy-Rezept, Rollback).`);
  // Nur eine GESUNDE Instanz auf Zielstand gilt als erledigt. Eine ERRORED-Instanz kann die
  // Zielversion schon in der Konfiguration tragen, obwohl das Update gescheitert ist.
  if (vorher.state === 'ACTIVE' && c.extensionVersion === a.version && (a.vollindex || c.params.DO_FULL_INDEXING === 'false')) {
    console.log('Bereits auf Zielstand — nichts zu tun.');
    return;
  }
  const { body, updateMask } = baueAufruf(vorher, a);
  console.log('Parameter (* = Aenderung):'); zeigeDiff(c.params, body.config.params);
  console.log('Systemparameter (unveraendert):', JSON.stringify(body.config.systemParams));
  const fVorher = await funktionen(a.instanz);
  console.log('Funktionen vorher:', JSON.stringify(fVorher));
  if (a.modus === 'plan') { console.log('PLAN: nichts gesendet.'); return; }
  fs.mkdirSync(a.protokoll, { recursive: true });
  fs.writeFileSync(path.join(a.protokoll, `${stempel}-${a.instanz}-vorher.json`), JSON.stringify({
    modus: a.modus, ausFehlerzustand: a.ausFehler, zustand: vorher.state, versionInKonfiguration: c.extensionVersion,
    erwartet: a.erwarteListe, ziel: a.version, instanz: vorher, funktionen: fVorher, aufruf: { body, updateMask },
  }, null, 2));

  const url = `${instanzUrl(a.instanz)}?updateMask=${encodeURIComponent(updateMask)}&validateOnly=${a.modus === 'pruefen'}`;
  const r = await api('PATCH', url, body);
  if (r.status !== 200) fehler(`PATCH: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 800)}`);

  if (a.modus === 'pruefen') {
    const danach = await ladeInstanz(a.instanz);
    if (danach.etag !== vorher.etag || danach.config.extensionVersion !== c.extensionVersion) fehler('Instanz hat sich nach validateOnly veraendert — sofort pruefen!');
    console.log('PRUEFUNG OK: Server hat den Aufruf angenommen (validateOnly), Instanz unveraendert (etag gleich).');
    return;
  }

  console.log(`Update gestartet: ${r.json.name}`);
  const op = await warteAufOperation(r.json.name);
  console.log('');
  if (op.error) {
    // Zustand nach dem Fehlschlag festhalten: davon haengt der Rueckweg ab (ERRORED? welche
    // Version steht jetzt in der Konfiguration?). Ein Lesefehler hier darf die Meldung nicht verdecken.
    let danach = null;
    try { const r2 = await api('GET', instanzUrl(a.instanz)); danach = r2.status === 200 ? r2.json : { http: r2.status }; } catch (e) { danach = { lesefehler: e.message }; }
    fs.writeFileSync(path.join(a.protokoll, `${stempel}-${a.instanz}-fehler.json`), JSON.stringify({ operation: op, instanzDanach: danach }, null, 2));
    if (danach?.state) console.error(`Instanz nach dem Fehlschlag: ${zustandText(danach)}`);
    fehler(`Operation fehlgeschlagen: ${JSON.stringify(op.error).slice(0, 800)} — NICHT blind wiederholen; Rueckweg siehe Deploy-Rezept (zuerst --plan)`);
  }
  // Lifecycle-Aufgabe (onUpdate) braucht nach dem Update ein paar Sekunden
  await new Promise((res) => setTimeout(res, 20_000));
  const nachher = await ladeInstanz(a.instanz);
  const fNachher = await funktionen(a.instanz);
  fs.writeFileSync(path.join(a.protokoll, `${stempel}-${a.instanz}-nachher.json`), JSON.stringify({ instanz: nachher, funktionen: fNachher, operation: op }, null, 2));
  const nc = nachher.config;
  console.log(`Version jetzt: ${nc.extensionVersion}, Zustand: ${nachher.state}, DO_FULL_INDEXING=${nc.params.DO_FULL_INDEXING}`);
  console.log('Verarbeitung:', JSON.stringify(nachher.runtimeData?.processingState));
  console.log('Funktionen nachher:', JSON.stringify(fNachher));
  const soll = ERWARTETE_LAUFZEIT[a.version];
  const okLaufzeit = Object.values(fNachher).every((f) => f.runtime === soll && f.status === 'ACTIVE');
  if (nc.extensionVersion !== a.version || nachher.state !== 'ACTIVE' || !okLaufzeit) fehler(`Nachkontrolle nicht gruen (erwartet ${a.version}, ${soll}, ACTIVE)`);
  console.log(`NACHKONTROLLE OK: ${a.version}, beide Funktionen ${soll} + ACTIVE.`);
}

main().catch((e) => fehler(e.stack || e.message));
