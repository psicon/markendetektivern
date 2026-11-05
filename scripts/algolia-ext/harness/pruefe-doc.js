// NACH dem Update: rechnet fuer einzelne Dokumente den erwarteten Datensatz mit dem
// 1.3.0-Code aus Firestore und vergleicht mit dem LIVE-Datensatz in Algolia und mit der
// Vorher-Sicherung (Form: gleiche Felder, gleiche Typen; lastmodified separat). NUR LESEND.
// Entscheidend ist "Inhalt GLEICH": der live geschriebene Datensatz entspricht exakt dem, was
// der 1.3.0-Code (und nachweislich auch der alte Code) aus dem aktuellen Dokument baut. Ein
// Formhinweis gegenueber der Vorher-Sicherung ist dann eine echte Dokumentaenderung (nur Info).
// Alarm: Inhalt UNGLEICH, Datensatz fehlt, oder lastmodified in Objektform (Vollindex-Spur).
// Aufruf: node pruefe-doc.js <instanz> <collection> <index> <docId> [docId...]
// Umgebung:
//   ALGOLIA_EXT_ARBEIT   Arbeitsordner mit ext-1.3.0/functions (baue-ext.sh) — Pflicht
//   ALGOLIA_EXT_VORHER   Sicherung (sicherung.js) von direkt vor dem Update — Pflicht
//   ALGOLIA_EXT_SECRET   "<secret-name>:<version>" der Instanz (nachkontrolle.sh liest es aus
//                        der Instanz-Konfiguration); ohne: Name aus der Instanz-ID, Version latest
// Optional: $ALGOLIA_EXT_ARBEIT/bekannte-abweichungen.json (vor dem Update bestehende
// Abweichungen Live-Algolia vs. Firestore) — wird nur ANGEZEIGT, nicht entschuldigt: ein
// Dokument, das nach dem Update synchronisiert wurde, muss dem Sollwert entsprechen.
const fs = require('fs'); const path = require('path');
const [, , INST, COLL, IDX, ...IDS] = process.argv;
const say = (s) => process.stdout.write(s + '\n');
const ARBEIT = process.env.ALGOLIA_EXT_ARBEIT; const VORHER = process.env.ALGOLIA_EXT_VORHER;
if (!INST || !COLL || !IDX || !IDS.length) { say('Aufruf: node pruefe-doc.js <instanz> <collection> <index> <docId>...'); process.exit(2); }
if (!ARBEIT || !VORHER) { say('ALGOLIA_EXT_ARBEIT und ALGOLIA_EXT_VORHER setzen (siehe Kopf der Datei)'); process.exit(2); }
const base = path.join(ARBEIT, 'ext-1.3.0', 'functions');
if (!fs.existsSync(path.join(base, 'lib', 'extract.js'))) { say(`${base}/lib/extract.js fehlt — erst baue-ext.sh 1.3.0 ausfuehren`); process.exit(2); }
const vorherDatei = path.join(VORHER, IDX, 'records-all.jsonl');
if (!fs.existsSync(vorherDatei)) { say(`${vorherDatei} fehlt`); process.exit(2); }
for (const m of ['log', 'info', 'debug', 'warn', 'error']) console[m] = () => {};
Object.assign(process.env, { PROJECT_ID: 'markendetektive-895f7', LOCATION: 'us-central1', COLLECTION_PATH: COLL, ALGOLIA_INDEX_NAME: IDX, ALGOLIA_APP_ID: 'Y0KKZHT49Q', ALGOLIA_API_KEY: 'unused-local', DATABASE_ID: '(default)', EXT_INSTANCE_ID: INST, GCLOUD_PROJECT: 'markendetektive-895f7' });
delete process.env.TRANSFORM_FUNCTION; // Transform-Ziel ist 404 -> Extension faellt auf den unveraenderten Datensatz zurueck (belegt)
const admin = require(path.join(base, 'node_modules', 'firebase-admin'));
const db = admin.initializeApp({ projectId: 'markendetektive-895f7' }).firestore();
const extract = require(path.join(base, 'lib', 'extract.js')).default;
const { extKey, alg } = require('./keys');
const typ = (v) => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.keys(x).sort().reduce((a, kk) => (a[kk] = x[kk], a), {}) : x);
(async () => {
  let secret = process.env.ALGOLIA_EXT_SECRET;
  if (!secret) secret = `${INST}-ALGOLIA_API_KEY:latest`;
  const [sName, sVer] = secret.split(':');
  const key = extKey(sName, sVer || 'latest');
  let bekannt = {};
  try { bekannt = JSON.parse(fs.readFileSync(path.join(ARBEIT, 'bekannte-abweichungen.json'), 'utf8'))[IDX]?.ids || {}; } catch { /* optional */ }
  const vorher = new Map();
  for (const l of fs.readFileSync(vorherDatei, 'utf8').split('\n')) if (l.trim()) { const r = JSON.parse(l); if (IDS.includes(r.objectID)) vorher.set(r.objectID, r); }
  let ok = true;
  for (const id of IDS) {
    const snap = await db.collection(COLL).doc(id).get();
    const live = await alg(key, 'GET', `/1/indexes/${IDX}/${encodeURIComponent(id)}`);
    if (!snap.exists) { say(`${id}: Firestore-Dokument existiert nicht; Algolia HTTP ${live.status} (erwartet 404 nach Loeschung)`); if (live.status !== 404) ok = false; continue; }
    if (live.status !== 200) { say(`${id}: Algolia HTTP ${live.status} — Datensatz fehlt, obwohl das Dokument existiert`); ok = false; continue; }
    const soll = await extract(snap, 0);
    const sollLm = soll.lastmodified; delete soll.lastmodified; // nur gesetzt, wenn das Dokument selbst ein Feld lastmodified hat
    const ist = { ...live.json }; const lm = ist.lastmodified; delete ist.lastmodified;
    const gleich = stable(soll) === stable(ist);
    const v = vorher.get(id);
    let form = 'kein Vorher-Datensatz (neues Dokument)';
    if (v) { const vv = { ...v }; delete vv.lastmodified; const keys = [...new Set([...Object.keys(vv), ...Object.keys(ist)])]; const fd = keys.filter(k => !(k in vv) || !(k in ist) || typ(vv[k]) !== typ(ist[k])); form = fd.length ? 'Formhinweis (Feld neu/weg/Typ anders als vorher — nur Info, entscheidend ist der Inhalt): ' + fd.join(',') : 'Form gleich wie vorher'; }
    // lastmodified wechselt bei jedem Sync naturgemaess die Form (alter wie neuer Code):
    // FORCE_DATA_SYNC=yes -> saveObject ohne das Feld (undefined); =no -> partialUpdateObject
    // mit IncrementSet (number) bzw. saveObject (undefined). Die Objektform {_operation,value}
    // schreibt NUR ein Vollindex (saveObjects) — taucht sie nach einem Sync auf, ist das der Alarm.
    const lmVorher = v ? typ(v.lastmodified) : '-';
    const lmObjekt = lm !== null && typeof lm === 'object' && !Array.isArray(lm) && '_operation' in lm && stable(lm) !== stable(sollLm);
    const lmText = `lastmodified vorher ${lmVorher} jetzt ${typ(lm)}${lmObjekt ? ' (OBJEKTFORM = Vollindex-Spur!)' : ''}`;
    if (lmObjekt) ok = false;
    const hinweis = bekannt[id] ? ` | war vor dem Update schon abweichend (${bekannt[id].join(',')})` : '';
    say(`${id}: Inhalt ${gleich ? 'GLEICH' : 'UNGLEICH'} dem 1.3.0-Sollwert | ${form} | ${lmText}${hinweis}`);
    if (!gleich) { ok = false; const keys = [...new Set([...Object.keys(soll), ...Object.keys(ist)])]; say('   abweichende Felder: ' + keys.filter(k => stable(soll[k]) !== stable(ist[k])).join(',')); }
  }
  say(ok ? 'ERGEBNIS: OK' : 'ERGEBNIS: AUFFAELLIG'); process.exit(ok ? 0 : 1);
})().catch(e => { process.stdout.write('ERR ' + e.message + '\n'); process.exit(1); });
